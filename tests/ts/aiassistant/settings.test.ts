import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  fetchDevOpenAIKey,
  isConfigured,
  loadSettings,
  saveSettings,
} from "../../../src/aiassistant/settings";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aiassistant/settings", () => {
  it("returns defaults when nothing is stored", () => {
    window.localStorage.clear();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips a complete settings object", () => {
    window.localStorage.clear();
    const settings = {
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
      model: "llama3",
      temperature: 0.7,
    };
    saveSettings(settings);
    expect(loadSettings()).toEqual(settings);
  });

  it("merges partial stored payloads with defaults", () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "datalab-web.aiassistant.settings",
      JSON.stringify({ model: "gpt-4o" }),
    );
    const loaded = loadSettings();
    expect(loaded.model).toBe("gpt-4o");
    expect(loaded.baseUrl).toBe(DEFAULT_SETTINGS.baseUrl);
    expect(loaded.temperature).toBe(DEFAULT_SETTINGS.temperature);
  });

  it("ignores corrupted JSON", () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "datalab-web.aiassistant.settings",
      "not json",
    );
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("flags missing baseUrl/model as not-configured", () => {
    expect(isConfigured({ ...DEFAULT_SETTINGS, baseUrl: "" })).toBe(false);
    expect(isConfigured({ ...DEFAULT_SETTINGS, model: "" })).toBe(false);
    expect(isConfigured(DEFAULT_SETTINGS)).toBe(true);
  });

  it("fetchDevOpenAIKey reads the dev endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ apiKey: "sk-dev" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    expect(await fetchDevOpenAIKey()).toBe("sk-dev");
  });

  it("fetchDevOpenAIKey returns '' when the endpoint errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    expect(await fetchDevOpenAIKey()).toBe("");
  });

  it("fetchDevOpenAIKey returns '' on non-200 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("nope", {
            status: 404,
          }),
      ),
    );
    expect(await fetchDevOpenAIKey()).toBe("");
  });
});
