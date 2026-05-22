/**
 * Conversation controller orchestrating the LLM tool-call loop.
 *
 * Mirrors ``DataLab/datalab/aiassistant/controller.py``:
 *
 * 1. Append the user message to the history.
 * 2. Send the history + tool schemas to the provider.
 * 3. If the assistant emits tool calls, ask the host to confirm each
 *    mutating call, run them, append the results to the history, loop.
 * 4. Stop when the assistant returns plain prose with no tool calls
 *    (or when ``MAX_ITERATIONS`` is reached as a safety net).
 *
 * The controller is GUI-agnostic: it talks to the UI through a
 * :type:`ControllerListener` and a :type:`ConfirmToolCallback`.
 */

import type { DataLabRuntime } from "../runtime/runtime";
import { chatCompletions } from "./provider";
import { callTool, indexTools } from "./tools";
import type {
  ChatMessage,
  ConfirmToolCallback,
  ControllerListener,
  ProviderSettings,
  TokenUsage,
  Tool,
  ToolCall,
  ToolResult,
} from "./types";

/** Hard cap on the tool-call loop to avoid runaway iterations when a
 *  badly-tuned model keeps requesting tools. */
const MAX_ITERATIONS = 10;

/** Thrown when :meth:`AIController.abort` interrupts the running loop.
 *  Mirrors the browser's ``DOMException("...", "AbortError")`` (also
 *  raised by ``fetch`` when the abort signal fires) so callers can use
 *  a single ``error.name === "AbortError"`` discriminator. */
export class AbortError extends Error {
  constructor(message = "Aborted by user.") {
    super(message);
    this.name = "AbortError";
  }
}

/** True when *err* is an abort (our :class:`AbortError` or the browser's
 *  built-in fetch ``AbortError``). */
export function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "name" in err &&
    (err as { name: unknown }).name === "AbortError"
  );
}

export interface ControllerOptions {
  runtime: DataLabRuntime;
  tools: Tool[];
  systemPrompt: string;
  /** Resolved at request time, so the user can edit settings between
   *  turns and the next call picks them up immediately. */
  getSettings: () => ProviderSettings;
  confirmTool: ConfirmToolCallback;
  listener?: ControllerListener;
}

export class AIController {
  private readonly runtime: DataLabRuntime;
  private readonly tools: Tool[];
  private readonly toolIndex: Map<string, Tool>;
  private readonly getSettings: () => ProviderSettings;
  private readonly confirmTool: ConfirmToolCallback;
  private readonly listener: ControllerListener;
  private readonly history: ChatMessage[];
  /** Set while :meth:`runLoop` is in flight; ``null`` otherwise. */
  private abortController: AbortController | null = null;
  /** Running token-usage total across the conversation. Reset on
   *  :meth:`reset` and :meth:`setMessages`. */
  private cumulativeUsage: TokenUsage = {};

  constructor(opts: ControllerOptions) {
    this.runtime = opts.runtime;
    this.tools = opts.tools;
    this.toolIndex = indexTools(opts.tools);
    this.getSettings = opts.getSettings;
    this.confirmTool = opts.confirmTool;
    this.listener = opts.listener ?? {};
    this.history = [{ role: "system", content: opts.systemPrompt }];
  }

  /** Snapshot of the current transcript (system message included). */
  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  /** Conversation messages, excluding the system prompt — suitable for
   *  persistence (the system prompt is recomputed at load time so any
   *  prompt change between sessions is picked up). */
  getMessages(): ChatMessage[] {
    return this.history.slice(1);
  }

  /** Replace the current history with *messages* (system prompt kept).
   *  Used when restoring a persisted conversation. *initialUsage* seeds
   *  the cumulative counter so a restored conversation displays the
   *  same total it had when it was last saved. */
  setMessages(messages: ChatMessage[], initialUsage?: TokenUsage): void {
    this.history.splice(1);
    for (const msg of messages) {
      if (msg.role === "system") continue;
      this.history.push(msg);
    }
    this.cumulativeUsage = initialUsage ? { ...initialUsage } : {};
  }

  /** Drop every message except the system prompt. */
  reset(): void {
    this.history.splice(1);
    this.cumulativeUsage = {};
  }

  /** Cancel the in-flight ``sendUserMessage`` call (if any). The pending
   *  promise rejects with :class:`AbortError`. Idempotent — a no-op when
   *  the controller is idle. */
  abort(): void {
    this.abortController?.abort();
  }

  /** True while a ``sendUserMessage`` call is in flight. */
  get isRunning(): boolean {
    return this.abortController !== null;
  }

  /** Snapshot of the cumulative token usage across the conversation. */
  getUsage(): TokenUsage {
    return { ...this.cumulativeUsage };
  }

  /** Return the (possibly truncated) message window sent to the
   *  provider on the next request. Mirrors DataLab Qt's
   *  ``_messages_for_provider``: when ``maxHistoryMessages`` is
   *  positive, only the latest N non-system messages are kept, then
   *  leading messages are trimmed so the window always starts on a
   *  ``user`` message — this avoids leaving an orphan ``tool`` reply
   *  or an assistant ``tool_calls`` whose responses were dropped,
   *  which most providers reject. */
  messagesForProvider(cap: number): ChatMessage[] {
    if (cap <= 0) return [...this.history];
    const system = this.history[0];
    const nonSystem = this.history.slice(1);
    let window = nonSystem.slice(-cap);
    while (window.length > 0 && window[0].role !== "user") {
      window = window.slice(1);
    }
    if (window.length === 0) {
      for (let idx = nonSystem.length - 1; idx >= 0; idx -= 1) {
        if (nonSystem[idx].role === "user") {
          window = nonSystem.slice(idx);
          break;
        }
      }
    }
    return system ? [system, ...window] : window;
  }

  /** Push the user message, drive the tool-call loop, return the final
   *  assistant prose. May be ``null`` if the assistant only emitted
   *  tool calls and produced no closing message — rare but possible. */
  async sendUserMessage(text: string): Promise<string | null> {
    const userMessage: ChatMessage = { role: "user", content: text };
    this.appendMessage(userMessage);
    return this.runLoop();
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private appendMessage(message: ChatMessage): void {
    this.history.push(message);
    this.listener.onMessageAppended?.(message);
  }

  private async runLoop(): Promise<string | null> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    try {
      for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
        if (signal.aborted) throw new AbortError();
        const settings = this.getSettings();
        let streamedText = "";
        // Only opt into streaming when the host actually listens for
        // deltas — otherwise the underlying provider stays on the
        // simpler non-streamed path (cheaper, and keeps unit tests that
        // stub the raw ``fetch`` response unaffected).
        const onDelta = this.listener.onAssistantDelta
          ? (delta: { contentDelta?: string }) => {
              if (delta.contentDelta) {
                streamedText += delta.contentDelta;
                this.listener.onAssistantDelta!(
                  delta.contentDelta,
                  streamedText,
                );
              }
            }
          : undefined;
        const response = await chatCompletions(
          settings,
          this.messagesForProvider(settings.maxHistoryMessages ?? 0),
          this.tools,
          { signal, ...(onDelta ? { onDelta } : {}) },
        );
        const assistantMessage: ChatMessage = {
          role: "assistant",
          // OpenAI accepts ``content: null`` only when ``tool_calls`` is
          // also present. Some local servers (LM Studio, llama.cpp) emit
          // ``content: null`` even on plain prose turns — coerce to ""
          // so replaying the transcript against a strict provider works.
          content:
            response.content ?? (response.toolCalls.length > 0 ? null : ""),
          ...(response.toolCalls.length > 0
            ? { tool_calls: response.toolCalls }
            : {}),
        };
        this.appendMessage(assistantMessage);

        if (response.usage) {
          this.cumulativeUsage = sumUsage(this.cumulativeUsage, response.usage);
          this.listener.onUsage?.(response.usage, this.getUsage());
        }

        if (response.toolCalls.length === 0) {
          return response.content;
        }

        for (const call of response.toolCalls) {
          if (signal.aborted) {
            // Keep the transcript valid — every assistant ``tool_calls``
            // entry must have a matching ``role:"tool"`` response, even
            // when the user aborted before we could run the tool.
            this.appendToolResultMessage(call, {
              ok: false,
              error: "Aborted by user.",
            });
            continue;
          }
          await this.handleToolCall(call);
        }
        if (signal.aborted) throw new AbortError();
      }
      const error = new Error(
        `Aborted: more than ${MAX_ITERATIONS} tool-call iterations without ` +
          `a final answer.`,
      );
      this.listener.onError?.(error);
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  private async handleToolCall(call: ToolCall): Promise<void> {
    this.listener.onToolStarted?.(call);
    const tool = this.toolIndex.get(call.function.name);
    let result: ToolResult;
    if (!tool) {
      result = {
        ok: false,
        error: `Unknown tool '${call.function.name}'.`,
      };
    } else {
      let args: Record<string, unknown>;
      try {
        args = call.function.arguments
          ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
          : {};
      } catch (err) {
        result = {
          ok: false,
          error:
            "Failed to parse tool arguments as JSON: " +
            (err instanceof Error ? err.message : String(err)),
        };
        this.appendToolResultMessage(call, result);
        this.listener.onToolFinished?.(call, result);
        return;
      }

      if (!tool.readonly) {
        const approved = await this.confirmTool(tool, args);
        if (!approved) {
          result = {
            ok: false,
            error: "Rejected by user.",
          };
          this.appendToolResultMessage(call, result);
          this.listener.onToolFinished?.(call, result);
          return;
        }
      }

      result = await callTool(tool, this.runtime, args);
    }
    // Mutating tools changed the workspace — broadcast a model-changed
    // event so the React App refreshes the panel tree (parity with the
    // remote-bridge fan-out used by the macro proxy).
    if (tool && !tool.readonly && result.ok) {
      try {
        window.dispatchEvent(
          new CustomEvent("datalab-web:remote-model-changed", {
            detail: { panel: null },
          }),
        );
      } catch {
        // ignore — non-DOM environments (tests) just skip the refresh.
      }
    }
    this.appendToolResultMessage(call, result);
    // Multimodal tools (e.g. ``capture_view``) attach extra messages
    // that must be appended *after* the tool-result message — typically
    // a synthetic ``role:"user"`` message carrying an inline image so
    // vision models can see the captured plot in their next turn.
    if (result.followupMessages) {
      for (const msg of result.followupMessages) {
        this.appendMessage(msg);
      }
    }
    this.listener.onToolFinished?.(call, result);
  }

  private appendToolResultMessage(call: ToolCall, result: ToolResult): void {
    let content: string;
    try {
      content = JSON.stringify(
        result.ok
          ? { ok: true, result: result.data ?? null }
          : { ok: false, error: result.error ?? "unknown error" },
      );
    } catch {
      content = JSON.stringify({
        ok: result.ok,
        error: result.ok ? undefined : (result.error ?? "unknown error"),
        result: result.ok ? String(result.data) : undefined,
      });
    }
    this.appendMessage({
      role: "tool",
      tool_call_id: call.id,
      name: call.function.name,
      content,
    });
  }
}

/** Field-wise sum of two :type:`TokenUsage` records. ``undefined`` +
 *  ``undefined`` stays ``undefined`` so we don't fabricate zeros for
 *  counters the provider never reported. */
function sumUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const add = (
    x: number | undefined,
    y: number | undefined,
  ): number | undefined => {
    if (x === undefined && y === undefined) return undefined;
    return (x ?? 0) + (y ?? 0);
  };
  const out: TokenUsage = {};
  const p = add(a.promptTokens, b.promptTokens);
  const c = add(a.completionTokens, b.completionTokens);
  const t = add(a.totalTokens, b.totalTokens);
  if (p !== undefined) out.promptTokens = p;
  if (c !== undefined) out.completionTokens = c;
  if (t !== undefined) out.totalTokens = t;
  return out;
}
