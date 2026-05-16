import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIController } from "../../../src/aiassistant/controller";
import type { DataLabRuntime } from "../../../src/runtime/runtime";
import type {
  ChatMessage,
  ProviderResponse,
  ProviderSettings,
  Tool,
} from "../../../src/aiassistant/types";

const settings: ProviderSettings = {
  provider: "openai",
  baseUrl: "http://localhost:11434/v1",
  apiKey: "",
  model: "fake",
  temperature: 0,
};

function makeFetch(responses: ProviderResponse[]) {
  let i = 0;
  return vi.fn(async () => {
    const next = responses[i++];
    if (!next) throw new Error("ran out of canned responses");
    const payload = {
      choices: [
        {
          message: {
            role: "assistant",
            content: next.content,
            tool_calls: next.toolCalls.length ? next.toolCalls : undefined,
          },
          finish_reason: next.toolCalls.length ? "tool_calls" : "stop",
        },
      ],
      ...(next.usage
        ? {
            usage: {
              prompt_tokens: next.usage.promptTokens,
              completion_tokens: next.usage.completionTokens,
              total_tokens: next.usage.totalTokens,
            },
          }
        : {}),
    };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function makeReadonlyTool(name: string, handler: () => unknown): Tool {
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readonly: true,
    handler: async () => handler(),
  };
}

function makeMutatingTool(name: string, handler: () => unknown): Tool {
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readonly: false,
    handler: async () => handler(),
  };
}

const fakeRuntime = {} as DataLabRuntime;

beforeEach(() => {
  vi.stubGlobal("fetch", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AIController", () => {
  it("returns assistant text on a one-shot reply with no tool calls", async () => {
    vi.stubGlobal("fetch", makeFetch([{ content: "hello", toolCalls: [] }]));
    const ctrl = new AIController({
      runtime: fakeRuntime,
      tools: [],
      systemPrompt: "system",
      getSettings: () => settings,
      confirmTool: async () => true,
    });
    const text = await ctrl.sendUserMessage("hi");
    expect(text).toBe("hello");
    const history = ctrl.getHistory();
    expect(history[0]).toEqual({ role: "system", content: "system" });
    expect(history[1]).toEqual({ role: "user", content: "hi" });
    expect(history[2]?.role).toBe("assistant");
  });

  it("auto-approves readonly tool calls and loops until prose", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch([
        {
          content: null,
          toolCalls: [
            {
              id: "c1",
              type: "function",
              function: { name: "ping", arguments: "{}" },
            },
          ],
        },
        { content: "done", toolCalls: [] },
      ]),
    );
    const confirm = vi.fn(async () => true);
    const ctrl = new AIController({
      runtime: fakeRuntime,
      tools: [makeReadonlyTool("ping", () => "pong")],
      systemPrompt: "s",
      getSettings: () => settings,
      confirmTool: confirm,
    });
    const text = await ctrl.sendUserMessage("ping it");
    expect(text).toBe("done");
    expect(confirm).not.toHaveBeenCalled();
    const toolMsg = ctrl
      .getHistory()
      .find(
        (m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool",
      );
    expect(toolMsg).toBeDefined();
    expect(JSON.parse(toolMsg!.content)).toEqual({ ok: true, result: "pong" });
  });

  it("requires confirmation for mutating tools and records rejection", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch([
        {
          content: null,
          toolCalls: [
            {
              id: "c1",
              type: "function",
              function: { name: "do_it", arguments: "{}" },
            },
          ],
        },
        { content: "ok", toolCalls: [] },
      ]),
    );
    const handler = vi.fn(() => "should-not-run");
    const ctrl = new AIController({
      runtime: fakeRuntime,
      tools: [makeMutatingTool("do_it", handler)],
      systemPrompt: "s",
      getSettings: () => settings,
      confirmTool: async () => false,
    });
    const text = await ctrl.sendUserMessage("go");
    expect(text).toBe("ok");
    expect(handler).not.toHaveBeenCalled();
    const toolMsg = ctrl
      .getHistory()
      .find(
        (m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool",
      );
    expect(JSON.parse(toolMsg!.content)).toEqual({
      ok: false,
      error: "Rejected by user.",
    });
  });

  it("propagates HTTP errors from the provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "no key" } }), {
            status: 401,
            statusText: "Unauthorized",
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const ctrl = new AIController({
      runtime: fakeRuntime,
      tools: [],
      systemPrompt: "s",
      getSettings: () => settings,
      confirmTool: async () => true,
    });
    await expect(ctrl.sendUserMessage("hi")).rejects.toThrow(/401/);
  });

  it("reset clears history but keeps the system prompt", async () => {
    vi.stubGlobal("fetch", makeFetch([{ content: "hi", toolCalls: [] }]));
    const ctrl = new AIController({
      runtime: fakeRuntime,
      tools: [],
      systemPrompt: "stay",
      getSettings: () => settings,
      confirmTool: async () => true,
    });
    await ctrl.sendUserMessage("first");
    expect(ctrl.getHistory().length).toBeGreaterThan(1);
    ctrl.reset();
    expect(ctrl.getHistory()).toEqual([{ role: "system", content: "stay" }]);
  });

  it("abort() interrupts an in-flight provider call with AbortError", async () => {
    // ``fetch`` mock that resolves only when the abort signal fires, so
    // we deterministically exercise the Stop button path.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            const sig = init?.signal as AbortSignal | undefined;
            if (sig?.aborted) {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
              return;
            }
            sig?.addEventListener("abort", () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      ),
    );
    const ctrl = new AIController({
      runtime: fakeRuntime,
      tools: [],
      systemPrompt: "s",
      getSettings: () => settings,
      confirmTool: async () => true,
    });
    const pending = ctrl.sendUserMessage("hang");
    // Yield once so the provider call is in flight before we abort.
    await Promise.resolve();
    expect(ctrl.isRunning).toBe(true);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(ctrl.isRunning).toBe(false);
    // The user message must remain in the transcript so the next send
    // doesn't drop context.
    const user = ctrl.getHistory().find((m) => m.role === "user");
    expect(user).toEqual({ role: "user", content: "hang" });
  });

  it("abort() between tool calls leaves a valid transcript", async () => {
    // Two tool calls in one assistant turn; the second one is aborted
    // before its handler runs. We must still emit a tool result for it
    // so the transcript stays balanced.
    let firstCallStarted = false;
    const ctrl = new AIController({
      runtime: fakeRuntime,
      tools: [
        makeReadonlyTool("first", () => {
          firstCallStarted = true;
          // Abort right when the first tool runs; the loop check before
          // dispatching the second call should skip it.
          ctrl.abort();
          return "ok";
        }),
        makeReadonlyTool("second", () => "should-not-run"),
      ],
      systemPrompt: "s",
      getSettings: () => settings,
      confirmTool: async () => true,
    });
    vi.stubGlobal(
      "fetch",
      makeFetch([
        {
          content: null,
          toolCalls: [
            {
              id: "a",
              type: "function",
              function: { name: "first", arguments: "{}" },
            },
            {
              id: "b",
              type: "function",
              function: { name: "second", arguments: "{}" },
            },
          ],
        },
      ]),
    );
    await expect(ctrl.sendUserMessage("go")).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(firstCallStarted).toBe(true);
    const toolMsgs = ctrl
      .getHistory()
      .filter(
        (m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool",
      );
    // One result per assistant tool_call, even the aborted one.
    expect(toolMsgs).toHaveLength(2);
    expect(JSON.parse(toolMsgs[1]!.content)).toEqual({
      ok: false,
      error: "Aborted by user.",
    });
  });

  it("accumulates token usage across turns and notifies the listener", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch([
        {
          content: null,
          toolCalls: [
            {
              id: "c1",
              type: "function",
              function: { name: "ping", arguments: "{}" },
            },
          ],
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
        },
        {
          content: "done",
          toolCalls: [],
          usage: {
            promptTokens: 30,
            completionTokens: 7,
            totalTokens: 37,
          },
        },
      ]),
    );
    const usageEvents: Array<{ turn: number; cum: number }> = [];
    const ctrl = new AIController({
      runtime: fakeRuntime,
      tools: [makeReadonlyTool("ping", () => "pong")],
      systemPrompt: "s",
      getSettings: () => settings,
      confirmTool: async () => true,
      listener: {
        onUsage: (turn, cumulative) => {
          usageEvents.push({
            turn: turn.totalTokens ?? 0,
            cum: cumulative.totalTokens ?? 0,
          });
        },
      },
    });
    await ctrl.sendUserMessage("hi");
    expect(usageEvents).toEqual([
      { turn: 15, cum: 15 },
      { turn: 37, cum: 52 },
    ]);
    expect(ctrl.getUsage()).toEqual({
      promptTokens: 40,
      completionTokens: 12,
      totalTokens: 52,
    });
  });

  it("setMessages seeds the cumulative usage from a restored conversation", async () => {
    const ctrl = new AIController({
      runtime: fakeRuntime,
      tools: [],
      systemPrompt: "s",
      getSettings: () => settings,
      confirmTool: async () => true,
    });
    ctrl.setMessages([{ role: "user", content: "old" }], {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    expect(ctrl.getUsage()).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    ctrl.reset();
    expect(ctrl.getUsage()).toEqual({});
  });
});
