import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  DEFAULT_SETTINGS,
  fetchDevOpenAIKey,
  isConfigured,
  loadApiKey,
  loadSettings,
  saveSettings,
} from "../../../src/aiassistant/settings";
import { _resetSecureStorageForTests } from "../../../src/aiassistant/secureStorage";

beforeEach(() => {
  // Fresh in-memory IDB per test so the migration test sees a clean
  // secure store.
  globalThis.indexedDB = new IDBFactory();
  _resetSecureStorageForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aiassistant/settings", () => {
  it("returns defaults when nothing is stored", () => {
    window.localStorage.clear();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("never persists the API key in localStorage", () => {
    window.localStorage.clear();
    saveSettings({
      provider: "openai",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "sk-secret",
      model: "llama3",
      temperature: 0.7,
    });
    const raw = window.localStorage.getItem(
      "datalab-web.aiassistant.settings",
    );
    expect(raw).not.toBeNull();
    expect(raw!).not.toContain("sk-secret");
    const reloaded = loadSettings();
    expect(reloaded.apiKey).toBe("");
    expect(reloaded.baseUrl).toBe("http://localhost:11434/v1");
    expect(reloaded.model).toBe("llama3");
    expect(reloaded.temperature).toBeCloseTo(0.7);
  });

  it("migrates a legacy plaintext apiKey out of localStorage", async () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "datalab-web.aiassistant.settings",
      JSON.stringify({
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-legacy",
        model: "gpt-4o-mini",
        temperature: 0.2,
      }),
    );
    // First load triggers the migration (fire-and-forget).
    const loaded = loadSettings();
    expect(loaded.apiKey).toBe("");
    // Poll for the async re-encryption + localStorage rewrite.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const raw = window.localStorage.getItem(
        "datalab-web.aiassistant.settings",
      );
      if (raw && !raw.includes("sk-legacy")) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const raw = window.localStorage.getItem(
      "datalab-web.aiassistant.settings",
    )!;
    expect(raw).not.toContain("sk-legacy");
    const recovered = await loadApiKey();
    expect(recovered).toBe("sk-legacy");
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
    window.localStorage.setItem("datalab-web.aiassistant.settings", "not json");
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
