/**
 * OpenAI-compatible Chat Completions client.
 *
 * Pure ``fetch()`` against ``${baseUrl}/chat/completions``. Works with
 * OpenAI itself, local Ollama (run with ``OLLAMA_ORIGINS=*`` to allow
 * the browser), vLLM, and any other endpoint that exposes the
 * Chat Completions schema. Multimodal user messages (image_url parts)
 * are forwarded verbatim — vision-capable models (gpt-4o family,
 * Llava, …) consume them directly.
 *
 * One-shot only — no streaming in v1 (keeps tool-call assembly simple).
 *
 * Cross-reference: ``DataLab/datalab/aiassistant/providers/openai.py``.
 */

import type {
  ChatMessage,
  LLMProvider,
  ProviderResponse,
  ProviderSettings,
  TokenUsage,
  Tool,
  ToolCall,
} from "../types";

interface RawChoiceMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
}

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface RawChatCompletion {
  choices: Array<{
    message: RawChoiceMessage;
    finish_reason: string;
  }>;
  usage?: RawUsage;
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
export async function openAiChatCompletions(
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
  const usage = mapUsage(payload.usage);
  return {
    content: typeof message.content === "string" ? message.content : null,
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    ...(usage ? { usage } : {}),
  };
}

/** Translate an OpenAI ``usage`` block (snake_case) to our camelCase
 *  :type:`TokenUsage`. Returns ``undefined`` when the block is missing
 *  or empty. */
function mapUsage(raw: RawUsage | undefined): TokenUsage | undefined {
  if (!raw) return undefined;
  const out: TokenUsage = {};
  if (typeof raw.prompt_tokens === "number") {
    out.promptTokens = raw.prompt_tokens;
  }
  if (typeof raw.completion_tokens === "number") {
    out.completionTokens = raw.completion_tokens;
  }
  if (typeof raw.total_tokens === "number") {
    out.totalTokens = raw.total_tokens;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Concrete :type:`LLMProvider` for OpenAI / OpenAI-compatible endpoints. */
export const OPENAI_PROVIDER: LLMProvider = {
  kind: "openai",
  supportsVision: true,
  chatCompletions: openAiChatCompletions,
};
