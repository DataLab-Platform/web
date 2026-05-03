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
  Tool,
  ToolCall,
  ToolResult,
} from "./types";

/** Hard cap on the tool-call loop to avoid runaway iterations when a
 *  badly-tuned model keeps requesting tools. */
const MAX_ITERATIONS = 10;

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

  /** Drop every message except the system prompt. */
  reset(): void {
    this.history.splice(1);
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
    for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
      const settings = this.getSettings();
      const response = await chatCompletions(
        settings,
        this.history,
        this.tools,
      );
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: response.content,
        ...(response.toolCalls.length > 0
          ? { tool_calls: response.toolCalls }
          : {}),
      };
      this.appendMessage(assistantMessage);

      if (response.toolCalls.length === 0) {
        return response.content;
      }

      for (const call of response.toolCalls) {
        await this.handleToolCall(call);
      }
    }
    const error = new Error(
      `Aborted: more than ${MAX_ITERATIONS} tool-call iterations without ` +
        `a final answer.`,
    );
    this.listener.onError?.(error);
    throw error;
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
    if (!tool.readonly && result.ok) {
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
