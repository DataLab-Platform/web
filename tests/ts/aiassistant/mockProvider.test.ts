/**
 * Tests for the deterministic Mock provider used in tests and demos.
 *
 * Verifies the script cursor advances per call, requests are recorded
 * verbatim (so tests can assert on the messages the controller sent),
 * and ``reset`` rewinds everything cleanly.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  getMockRequests,
  MOCK_PROVIDER,
  resetMockProvider,
  setMockScript,
} from "../../../src/aiassistant/providers/mock";
import type { ProviderSettings } from "../../../src/aiassistant/types";

const settings: ProviderSettings = {
  provider: "mock",
  baseUrl: "",
  apiKey: "",
  model: "mock",
  temperature: 0,
  maxHistoryMessages: 0,
};

afterEach(() => {
  resetMockProvider();
});

describe("MockProvider", () => {
  it("returns scripted turns in order and records each request", async () => {
    setMockScript([
      { content: null, toolCalls: [{ name: "list_signals", arguments: {} }] },
      { content: "done" },
    ]);
    const r1 = await MOCK_PROVIDER.chatCompletions(
      settings,
      [{ role: "user", content: "hi" }],
      [],
    );
    expect(r1.content).toBeNull();
    expect(r1.toolCalls).toHaveLength(1);
    expect(r1.toolCalls[0]?.function.name).toBe("list_signals");
    const r2 = await MOCK_PROVIDER.chatCompletions(settings, [], []);
    expect(r2.content).toBe("done");
    expect(r2.toolCalls).toHaveLength(0);
    expect(getMockRequests()).toHaveLength(2);
  });

  it("falls back to a stop turn once the script is exhausted", async () => {
    setMockScript([{ content: "hi" }]);
    await MOCK_PROVIDER.chatCompletions(settings, [], []);
    const overflow = await MOCK_PROVIDER.chatCompletions(settings, [], []);
    expect(overflow.toolCalls).toEqual([]);
    expect(typeof overflow.content).toBe("string");
  });

  it("reset clears script and recorded requests", async () => {
    setMockScript([{ content: "x" }]);
    await MOCK_PROVIDER.chatCompletions(settings, [], []);
    resetMockProvider();
    expect(getMockRequests()).toHaveLength(0);
  });
});
