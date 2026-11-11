/**
 * Replayed AI Assistant session for the showcase (W4).
 *
 * :class:`ReplayProvider` answers the AI Assistant with scripted turns
 * (prose streamed word by word, tool calls), routed through
 * :func:`setProviderOverride`: in memory only, so the user's AI settings
 * (provider, model, API key) are never read, changed or persisted, and no
 * request leaves the browser. Turns may depend on the conversation (e.g.
 * quote the output of a macro that really ran).
 *
 * :class:`AIAssistantStateGuard` keeps the rest of the user's AI Assistant
 * state as it was: the panel visibility, the input history and the
 * conversation history (the replayed conversation is deleted afterwards).
 */

import {
  deleteConversation,
  getMaxConversations,
  listConversations,
  setMaxConversations,
} from "../../aiassistant/conversationStore";
import type {
  ChatCompletionsOptions,
  ChatMessage,
  LLMProvider,
  ProviderResponse,
  ProviderSettings,
  Tool,
  ToolCall,
} from "../../aiassistant/types";
import type { PauseController } from "../pause";

/** One scripted assistant turn. */
export interface ReplayTurn {
  /** "Thinking…" delay before the answer (ms at speed 1). */
  thinkMs?: number;
  /** Prose, possibly built from the conversation so far. */
  content?: string | ((messages: ChatMessage[]) => string) | null;
  /** Tool calls, possibly built from the conversation so far (e.g. with
   *  an object id returned by a previous tool). */
  toolCalls?:
    ReplayToolCall[] | ((messages: ChatMessage[]) => ReplayToolCall[]);
}

export interface ReplayToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** Pace of the replay (the showcase context provides it). */
export interface ReplayTiming {
  speed: number;
  check: boolean;
  pause: PauseController;
}

/** Delay between two streamed words (ms at speed 1). */
const WORD_MS = 110;

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

/** Scripted LLM provider of a replayed session. */
export class ReplayProvider implements LLMProvider {
  readonly kind = "mock" as const;
  readonly supportsVision = false;
  private index = 0;
  private calls = 0;

  constructor(
    private readonly turns: ReplayTurn[],
    private readonly timing: ReplayTiming,
  ) {}

  /** Number of scripted turns answered so far. */
  get answered(): number {
    return this.index;
  }

  async chatCompletions(
    _settings: ProviderSettings,
    messages: ChatMessage[],
    _tools: Tool[],
    options?: ChatCompletionsOptions,
  ): Promise<ProviderResponse> {
    const signal = options?.signal;
    const turn = this.turns[this.index];
    if (!turn) return { content: "", toolCalls: [] };
    this.index += 1;
    await this.wait(turn.thinkMs ?? 0, signal);
    const content =
      typeof turn.content === "function"
        ? turn.content(messages)
        : (turn.content ?? null);
    if (content && options?.onDelta) {
      for (const word of content.match(/\S+\s*/g) ?? [content]) {
        if (signal?.aborted) throw abortError();
        options.onDelta({ contentDelta: word });
        await this.wait(WORD_MS, signal);
      }
    }
    const calls =
      typeof turn.toolCalls === "function"
        ? turn.toolCalls(messages)
        : (turn.toolCalls ?? []);
    const toolCalls: ToolCall[] = calls.map((call) => ({
      id: `replay-call-${++this.calls}`,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    }));
    return { content, toolCalls };
  }

  /** Readable delay, frozen by the operator pause (none in check mode). */
  private async wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError();
    if (this.timing.check || ms <= 0) return;
    try {
      await this.timing.pause.hold(ms * this.timing.speed, signal);
    } catch (error) {
      if (signal?.aborted) throw abortError();
      throw error;
    }
  }
}

/** Result of the last tool call of ``messages`` (``undefined`` when it
 *  failed or when there is none). */
export function lastToolResult(messages: ChatMessage[]): unknown {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "tool") continue;
    try {
      const parsed = JSON.parse(message.content as string) as {
        ok?: boolean;
        result?: unknown;
      };
      return parsed.ok ? parsed.result : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Text output of the last tool call of ``messages`` (stdout of a macro). */
export function lastToolOutput(messages: ChatMessage[]): string {
  const result = lastToolResult(messages) as { stdout?: unknown } | undefined;
  return typeof result?.stdout === "string" ? result.stdout : "";
}

// -- User state ------------------------------------------------------------------

/** ``localStorage`` keys of the AI Assistant user state. */
const STORAGE_KEYS = [
  "datalab-web.aiassistant.settings",
  "datalab-web.aiassistant.inputHistory",
  "datalab-web.aiPanelVisible",
  "datalab-web.aiPanelCollapsed",
  "datalab-web.aiPanelFloating",
];

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Snapshot of the user's AI Assistant state, restored exactly by
 * :meth:`restore`: ``localStorage`` values (settings, input history, panel
 * state and position) and the stored conversations (the conversations
 * recorded meanwhile are deleted; the history cap is raised meanwhile so
 * that no user conversation is evicted).
 */
export class AIAssistantStateGuard {
  private constructor(
    private readonly storage: Map<string, string | null>,
    private readonly conversations: Set<string> | null,
    private readonly maxConversations: number,
  ) {}

  static async capture(): Promise<AIAssistantStateGuard> {
    const storage = new Map(STORAGE_KEYS.map((key) => [key, readStorage(key)]));
    let conversations: Set<string> | null = null;
    try {
      conversations = new Set((await listConversations()).map((c) => c.id));
    } catch (error) {
      console.warn("[showcase:w4] conversation history unavailable", error);
    }
    const guard = new AIAssistantStateGuard(
      storage,
      conversations,
      getMaxConversations(),
    );
    setMaxConversations(guard.maxConversations + 20);
    return guard;
  }

  /** Whether the user had the AI Assistant panel shown (or as a pill). */
  get panelVisible(): boolean {
    return this.storage.get("datalab-web.aiPanelVisible") === "true";
  }

  get panelCollapsed(): boolean {
    return this.storage.get("datalab-web.aiPanelCollapsed") === "true";
  }

  /** Whether the user has stored conversations (restored by the panel). */
  get hasConversations(): boolean {
    return (this.conversations?.size ?? 0) > 0;
  }

  /** Ids of the conversations recorded since :meth:`capture`. */
  async newConversations(): Promise<string[]> {
    const known = this.conversations;
    if (!known) return [];
    try {
      return (await listConversations())
        .map((c) => c.id)
        .filter((id) => !known.has(id));
    } catch {
      return [];
    }
  }

  /** Delete the conversations recorded since :meth:`capture`. */
  async deleteNewConversations(): Promise<void> {
    for (const id of await this.newConversations()) {
      await deleteConversation(id).catch((error: unknown) =>
        console.warn("[showcase:w4] conversation clean-up failed", error),
      );
    }
  }

  /** Put the ``localStorage`` values back, byte for byte. */
  restoreStorage(): void {
    for (const [key, value] of this.storage) {
      try {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
      } catch {
        // Storage unavailable: nothing was persisted either.
      }
    }
  }

  async restore(): Promise<void> {
    await this.deleteNewConversations();
    setMaxConversations(this.maxConversations);
    this.restoreStorage();
  }
}
