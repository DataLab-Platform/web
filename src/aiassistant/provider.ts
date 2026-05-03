/**
 * OpenAI-compatible Chat Completions client.
 *
 * Pure ``fetch()`` against ``${baseUrl}/chat/completions``. Works with
 * OpenAI itself, local Ollama (run with ``OLLAMA_ORIGINS=*`` to allow
 * the browser), vLLM, and any other endpoint that exposes the
 * Chat Completions schema.
 *
 * One-shot only — no streaming in v1 (keeps tool-call assembly simple).
 *
 * Cross-reference: ``DataLab/datalab/aiassistant/providers/openai.py``.
 */

import type {
  ChatMessage,
  ProviderResponse,
  ProviderSettings,
  Tool,
  ToolCall,
} from "./types";

interface RawChoiceMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
}

interface RawChatCompletion {
  choices: Array<{
    message: RawChoiceMessage;
    finish_reason: string;
  }>;
  error?: { message?: string };
}

/** Strip a trailing ``/`` from the base URL before appending the route. */
function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}

/** OpenAI tool schema entry. */
function toolToSchema(tool: Tool): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/** Send one Chat Completions request and decode the assistant message. */
export async function chatCompletions(
  settings: ProviderSettings,
  messages: ChatMessage[],
  tools: Tool[],
  signal?: AbortSignal,
): Promise<ProviderResponse> {
  const url = joinUrl(settings.baseUrl, "/chat/completions");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (settings.apiKey.trim()) {
    headers["Authorization"] = `Bearer ${settings.apiKey.trim()}`;
  }
  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    temperature: settings.temperature,
  };
  if (tools.length > 0) {
    body.tools = tools.map(toolToSchema);
    body.tool_choice = "auto";
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let detail: string;
    try {
      const errPayload = (await response.json()) as RawChatCompletion;
      detail = errPayload.error?.message ?? "";
    } catch {
      try {
        detail = await response.text();
      } catch {
        detail = "";
      }
    }
    throw new Error(
      `LLM request failed (${response.status} ${response.statusText})` +
        (detail ? `: ${detail}` : ""),
    );
  }
  const payload = (await response.json()) as RawChatCompletion;
  const choice = payload.choices?.[0];
  if (!choice) {
    throw new Error("LLM response contains no choices.");
  }
  const message = choice.message;
  return {
    content: typeof message.content === "string" ? message.content : null,
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
  };
}
