/**
 * Tests for the provider override of the AI Assistant facade (used by the
 * showcase to replay a scripted session without touching the settings).
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  chatCompletions,
  getProvider,
  hasProviderOverride,
  setProviderOverride,
} from "../../../src/aiassistant/provider";
import { MOCK_PROVIDER } from "../../../src/aiassistant/providers/mock";
import { OPENAI_PROVIDER } from "../../../src/aiassistant/providers/openai";
import {
  DEFAULT_SETTINGS,
  isConfigured,
} from "../../../src/aiassistant/settings";
import type { LLMProvider } from "../../../src/aiassistant/types";

const replay: LLMProvider = {
  kind: "mock",
  chatCompletions: async () => ({ content: "replayed", toolCalls: [] }),
};

afterEach(() => {
  setProviderOverride(null);
});

describe("provider override", () => {
  it("resolves the configured provider by default", () => {
    expect(hasProviderOverride()).toBe(false);
    expect(getProvider(DEFAULT_SETTINGS)).toBe(OPENAI_PROVIDER);
    expect(getProvider({ ...DEFAULT_SETTINGS, provider: "mock" })).toBe(
      MOCK_PROVIDER,
    );
  });

  it("routes every request to the override, whatever the settings", async () => {
    setProviderOverride(replay);
    expect(hasProviderOverride()).toBe(true);
    expect(getProvider(DEFAULT_SETTINGS)).toBe(replay);
    const response = await chatCompletions(DEFAULT_SETTINGS, [], []);
    expect(response.content).toBe("replayed");
    setProviderOverride(null);
    expect(getProvider(DEFAULT_SETTINGS)).toBe(OPENAI_PROVIDER);
  });

  it("makes incomplete settings usable while it is active", () => {
    const unconfigured = { ...DEFAULT_SETTINGS, baseUrl: "", model: "" };
    expect(isConfigured(unconfigured)).toBe(false);
    setProviderOverride(replay);
    expect(isConfigured(unconfigured)).toBe(true);
  });
});
