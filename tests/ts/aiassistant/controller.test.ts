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
    vi.stubGlobal(
      "fetch",
      makeFetch([{ content: "hello", toolCalls: [] }]),
    );
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
      .find((m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool");
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
      .find((m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool");
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
});
