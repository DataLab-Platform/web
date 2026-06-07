/**
 * Type definitions for the DataLab-Web AI Assistant.
 *
 * Mirrors the OpenAI Chat Completions tool-calling contract so any
 * OpenAI-compatible endpoint (OpenAI itself, local Ollama with the
 * ``/v1`` endpoint, vLLM, …) can be used unchanged. The multimodal
 * extension (``ChatMessageContentPart``) follows OpenAI's
 * ``content: [{type: "text" | "image_url", …}]`` convention used by
 * vision-capable models like ``gpt-4o``.
 *
 * Cross-reference: ``DataLab/datalab/aiassistant/{providers,tools}/`` —
 * this file is the TypeScript port of the dataclasses defined there.
 */

import type { RuntimeApi } from "../runtime/runtime";

/** Multimodal content part — text or inline image (OpenAI vision format). */
export type ChatMessageContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string; detail?: "low" | "high" | "auto" };
    };

/** Either a plain string (the historical OpenAI contract) or a list of
 *  multimodal parts. Provider implementations forward this verbatim. */
export type UserMessageContent = string | ChatMessageContentPart[];

/** A single OpenAI-format chat message stored in the transcript. */
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: UserMessageContent }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ToolCall[];
    }
  | {
      role: "tool";
      tool_call_id: string;
      name: string;
      content: string;
    };

/** Single tool invocation requested by the LLM. */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** Raw JSON string as emitted by the LLM (per OpenAI contract). */
    arguments: string;
  };
}

/** Token-usage breakdown reported by the LLM provider. All fields are
 *  optional because not every provider returns every counter — sum
 *  whichever ones are populated. */
export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** Provider response decoded from one ``/chat/completions`` round-trip. */
export interface ProviderResponse {
  /** ``null`` when the LLM only emits tool calls and no prose. */
  content: string | null;
  toolCalls: ToolCall[];
  /** Token usage for this single round-trip; absent when the provider
   *  did not include a ``usage`` block. */
  usage?: TokenUsage;
}

/** Incremental delta emitted by a streaming provider. Mirrors OpenAI's
 *  SSE ``delta`` shape: each chunk carries either a slice of prose
 *  (``contentDelta``) or a partial tool-call (``toolCallDelta``). Final
 *  aggregation is still returned via :type:`ProviderResponse` so
 *  non-streaming code paths stay unchanged. */
export interface ProviderResponseDelta {
  contentDelta?: string;
  toolCallDelta?: {
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
  };
}

/** Optional streaming hook accepted by :meth:`LLMProvider.chatCompletions`. */
export type ProviderDeltaCallback = (delta: ProviderResponseDelta) => void;

/** Options bag for :meth:`LLMProvider.chatCompletions`. */
export interface ChatCompletionsOptions {
  signal?: AbortSignal;
  /** Invoked for every incremental chunk when the provider streams.
   *  Non-streaming providers simply never call it. */
  onDelta?: ProviderDeltaCallback;
}

/** Outcome of a tool invocation, serialised as the ``content`` of the
 *  ``role:"tool"`` message sent back to the LLM. */
export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  /** Extra messages (typically a ``role:"user"`` carrying an inline
   *  image) appended right after the tool-result message. Used by
   *  multimodal tools (``capture_view``) since OpenAI does not allow
   *  image parts in ``role:"tool"`` messages. Mirrors the Qt
   *  ``ToolResult.followup_messages`` field. */
  followupMessages?: ChatMessage[];
}

/** Declarative tool definition.
 *
 * ``parameters`` is a JSON Schema (OpenAI function-calling format).
 * ``readonly`` tools are auto-approved; mutating tools go through the
 * confirm callback. A handler may return either a plain JSON-friendly
 * payload (wrapped into ``ToolResult.data``) or a fully-formed
 * :type:`ToolResult` — the latter is required for multimodal tools that
 * need to attach ``followupMessages``. */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  readonly: boolean;
  handler: (
    runtime: RuntimeApi,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}

/** Provider kind selectable from the settings dialog. */
export type ProviderKind = "openai" | "mock";

/** OpenAI-compatible provider settings persisted in localStorage. */
export interface ProviderSettings {
  /** Which concrete provider implementation to use. Defaults to
   *  ``"openai"``; ``"mock"`` is a deterministic in-process provider
   *  driven by a script of canned responses (used in tests / demos). */
  provider: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 0..2 (OpenAI scale). */
  temperature: number;
  /** Cap on the number of non-system messages sent to the provider on
   *  each request (0 = no cap). Useful with local models that have a
   *  small context window (e.g. ``n_ctx=4096`` on llama.cpp): if the
   *  conversation grows beyond the model's context, the server returns
   *  HTTP 400. The system prompt and the current user turn are always
   *  preserved. Mirrors DataLab Qt's ``max_history_messages``. */
  maxHistoryMessages: number;
}

/** Abstract LLM provider — one round-trip per ``chatCompletions`` call.
 *
 *  Streaming is opt-in: pass ``options.onDelta`` to receive incremental
 *  chunks; the returned promise still resolves with the fully-assembled
 *  :type:`ProviderResponse` so callers that don't care about streaming
 *  (tests, batch jobs) can stay synchronous in shape. */
export interface LLMProvider {
  readonly kind: ProviderKind;
  /** Optional capability flag exposed for prompt-tuning purposes. */
  readonly supportsVision?: boolean;
  chatCompletions(
    settings: ProviderSettings,
    messages: ChatMessage[],
    tools: Tool[],
    options?: ChatCompletionsOptions,
  ): Promise<ProviderResponse>;
}

/** Asks the user to approve (or reject) a mutating tool call. */
export type ConfirmToolCallback = (
  tool: Tool,
  args: Record<string, unknown>,
) => Promise<boolean>;

/** Notified for every interesting controller event. */
export interface ControllerListener {
  onMessageAppended?: (message: ChatMessage) => void;
  /** Fired for each streamed prose chunk *before* the corresponding
   *  assistant message lands via :meth:`onMessageAppended`. The
   *  cumulative text so far is passed so the UI can render a "typing"
   *  preview without re-assembling chunks itself. */
  onAssistantDelta?: (chunk: string, accumulated: string) => void;
  onToolStarted?: (toolCall: ToolCall) => void;
  onToolFinished?: (toolCall: ToolCall, result: ToolResult) => void;
  onError?: (error: Error) => void;
  /** Fired after each provider round-trip that reports usage. *turn*
   *  is the count for that round-trip; *cumulative* is the running
   *  total across the conversation. */
  onUsage?: (turn: TokenUsage, cumulative: TokenUsage) => void;
}

/** Type guard: is this handler return value already a structured result? */
export function isToolResult(value: unknown): value is ToolResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof (value as { ok: unknown }).ok === "boolean"
  );
}
