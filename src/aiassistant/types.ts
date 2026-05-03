/**
 * Type definitions for the DataLab-Web AI Assistant.
 *
 * Mirrors the OpenAI Chat Completions tool-calling contract so any
 * OpenAI-compatible endpoint (OpenAI itself, local Ollama with the
 * ``/v1`` endpoint, vLLM, …) can be used unchanged.
 *
 * Cross-reference: ``DataLab/datalab/aiassistant/{providers,tools}/`` —
 * this file is the TypeScript port of the dataclasses defined there.
 */

import type { DataLabRuntime } from "../runtime/runtime";

/** A single OpenAI-format chat message stored in the transcript. */
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
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

/** Provider response decoded from one ``/chat/completions`` round-trip. */
export interface ProviderResponse {
  /** ``null`` when the LLM only emits tool calls and no prose. */
  content: string | null;
  toolCalls: ToolCall[];
}

/** Outcome of a tool invocation, serialised as the ``content`` of the
 *  ``role:"tool"`` message sent back to the LLM. */
export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** Declarative tool definition.
 *
 * ``parameters`` is a JSON Schema (OpenAI function-calling format).
 * ``readonly`` tools are auto-approved; mutating tools go through the
 * confirm callback. */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  readonly: boolean;
  handler: (
    runtime: DataLabRuntime,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}

/** OpenAI-compatible provider settings persisted in localStorage. */
export interface ProviderSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 0..2 (OpenAI scale). */
  temperature: number;
}

/** Asks the user to approve (or reject) a mutating tool call. */
export type ConfirmToolCallback = (
  tool: Tool,
  args: Record<string, unknown>,
) => Promise<boolean>;

/** Notified for every interesting controller event. */
export interface ControllerListener {
  onMessageAppended?: (message: ChatMessage) => void;
  onToolStarted?: (toolCall: ToolCall) => void;
  onToolFinished?: (toolCall: ToolCall, result: ToolResult) => void;
  onError?: (error: Error) => void;
}
