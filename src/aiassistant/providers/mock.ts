/**
 * Deterministic in-process provider for tests, demos and Playwright
 * specs that need to exercise the AI Assistant without a real OpenAI
 * (or Ollama) endpoint.
 *
 * The provider is driven by a global script of "scripted turns" — each
 * turn either returns prose or requests one or more tool calls. The
 * controller's tool-call loop drives the script forward exactly as it
 * would with a real model.
 *
 * Cross-reference: ``DataLab/datalab/aiassistant/providers/mock.py``.
 */

import type {
  ChatMessage,
  LLMProvider,
  ProviderResponse,
  ProviderSettings,
  Tool,
  ToolCall,
} from "../types";

/** One scripted assistant turn. */
export interface MockTurn {
  /** Optional prose returned by the assistant for this round-trip. */
  content?: string | null;
  /** Tool calls the assistant requests; the controller will execute
   *  them and feed the results back, then call us again for the next
   *  turn. */
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
    /** Optional explicit id; auto-generated when omitted. */
    id?: string;
  }>;
}

/** Mutable script + read cursor exposed via the global handle. */
interface MockScriptState {
  turns: MockTurn[];
  index: number;
  /** Records every (messages, tools) request seen — useful for
   *  assertions in tests. */
  requests: Array<{
    settings: ProviderSettings;
    messages: ChatMessage[];
    tools: Tool[];
  }>;
}

const STATE: MockScriptState = { turns: [], index: 0, requests: [] };

/** Replace the canned script and rewind the cursor. Called by tests
 *  and by the in-app demo button. */
export function setMockScript(turns: MockTurn[]): void {
  STATE.turns = turns.slice();
  STATE.index = 0;
  STATE.requests = [];
}

/** Snapshot of every request the controller issued — for assertions. */
export function getMockRequests(): MockScriptState["requests"] {
  return STATE.requests.slice();
}

/** Reset everything (script + recorded requests). Used by ``afterEach``. */
export function resetMockProvider(): void {
  STATE.turns = [];
  STATE.index = 0;
  STATE.requests = [];
}

let toolCallCounter = 0;
function nextToolCallId(): string {
  toolCallCounter += 1;
  return `mock-call-${toolCallCounter}`;
}

/** Pop the next scripted turn and translate it to a provider response. */
export async function mockChatCompletions(
  settings: ProviderSettings,
  messages: ChatMessage[],
  tools: Tool[],
  _signal?: AbortSignal,
): Promise<ProviderResponse> {
  STATE.requests.push({ settings, messages, tools: tools.slice() });
  if (STATE.index >= STATE.turns.length) {
    // No more scripted turns: behave like a model that decided to stop
    // talking. The controller treats this as the end of the loop.
    return { content: "(mock provider exhausted)", toolCalls: [] };
  }
  const turn = STATE.turns[STATE.index]!;
  STATE.index += 1;
  const toolCalls: ToolCall[] = (turn.toolCalls ?? []).map((tc) => ({
    id: tc.id ?? nextToolCallId(),
    type: "function",
    function: {
      name: tc.name,
      arguments: JSON.stringify(tc.arguments ?? {}),
    },
  }));
  return {
    content: turn.content ?? null,
    toolCalls,
  };
}

/** Concrete :type:`LLMProvider` driven by the global script. */
export const MOCK_PROVIDER: LLMProvider = {
  kind: "mock",
  supportsVision: true,
  chatCompletions: mockChatCompletions,
};

// Expose a small handle on ``window`` so Playwright specs can drive the
// script from the test harness without bundling test code into the app.
if (typeof window !== "undefined") {
  (window as unknown as { __dlwAIMock?: unknown }).__dlwAIMock = {
    setScript: setMockScript,
    getRequests: getMockRequests,
    reset: resetMockProvider,
  };
}
