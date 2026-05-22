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
 * Streams when the caller passes ``options.onDelta`` (SSE,
 * ``stream: true``); otherwise falls back to a single non-streamed
 * round-trip so older code paths and unit tests stay unchanged.
 *
 * Cross-reference: ``DataLab/datalab/aiassistant/providers/openai.py``.
 */

import type {
  ChatCompletionsOptions,
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

/** One SSE ``data:`` event from a streamed /chat/completions response. */
interface RawStreamChunk {
  choices?: Array<{
    delta?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: RawUsage;
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
  options?: ChatCompletionsOptions,
): Promise<ProviderResponse> {
  const signal = options?.signal;
  const onDelta = options?.onDelta;
  const streaming = typeof onDelta === "function";
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
  if (streaming) {
    body.stream = true;
    // Ask OpenAI/Ollama/vLLM to include the usage block in the final
    // chunk — without this flag the streamed response omits it.
    body.stream_options = { include_usage: true };
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
  if (streaming && response.body) {
    // Some endpoints (or test stubs) honour ``stream: true`` only
    // partially and return a regular JSON body. Detect that case via
    // the Content-Type header and fall back to the non-streamed path
    // so ``onDelta`` simply never fires.
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("event-stream")) {
      return readStream(response.body, onDelta!);
    }
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

/** Aggregate the SSE stream into a final :type:`ProviderResponse`, firing
 *  ``onDelta`` for every prose and tool-call delta. */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onDelta: NonNullable<ChatCompletionsOptions["onDelta"]>,
): Promise<ProviderResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolCallsByIndex = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();
  let usage: TokenUsage | undefined;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by blank lines (``\n\n``); within an
      // event each line is prefixed with ``data: ``.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let chunk: RawStreamChunk;
          try {
            chunk = JSON.parse(payload) as RawStreamChunk;
          } catch {
            continue;
          }
          const choice = chunk.choices?.[0];
          const delta = choice?.delta;
          if (delta?.content) {
            content += delta.content;
            onDelta({ contentDelta: delta.content });
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const slot = toolCallsByIndex.get(tc.index) ?? {
                id: "",
                name: "",
                arguments: "",
              };
              if (tc.id) slot.id = tc.id;
              if (tc.function?.name) slot.name = tc.function.name;
              if (tc.function?.arguments)
                slot.arguments += tc.function.arguments;
              toolCallsByIndex.set(tc.index, slot);
              onDelta({
                toolCallDelta: {
                  index: tc.index,
                  ...(tc.id ? { id: tc.id } : {}),
                  ...(tc.function?.name ? { name: tc.function.name } : {}),
                  ...(tc.function?.arguments
                    ? { argumentsDelta: tc.function.arguments }
                    : {}),
                },
              });
            }
          }
          if (chunk.usage) {
            usage = mapUsage(chunk.usage);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  const toolCalls: ToolCall[] = [...toolCallsByIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, slot]) => ({
      id: slot.id,
      type: "function",
      function: { name: slot.name, arguments: slot.arguments },
    }));
  return {
    content: content.length > 0 ? content : null,
    toolCalls,
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
