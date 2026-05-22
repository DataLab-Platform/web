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
  BASE_URL_PRESETS,
  detectPreset,
  testConnection,
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
      maxHistoryMessages: 0,
    });
    const raw = window.localStorage.getItem("datalab-web.aiassistant.settings");
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

describe("aiassistant/settings — presets", () => {
  it("exposes OpenAI + local presets and a Custom entry", () => {
    const ids = BASE_URL_PRESETS.map((p) => p.id);
    expect(ids).toContain("openai");
    expect(ids).toContain("ollama");
    expect(ids).toContain("lmstudio");
    expect(ids).toContain("custom");
    expect(BASE_URL_PRESETS[BASE_URL_PRESETS.length - 1].id).toBe("custom");
  });

  it("detectPreset matches a canonical local URL", () => {
    expect(detectPreset("http://localhost:11434/v1").id).toBe("ollama");
    // Trailing slash should not matter.
    expect(detectPreset("http://localhost:11434/v1/").id).toBe("ollama");
  });

  it("detectPreset falls back to 'custom' for unknown URLs", () => {
    expect(detectPreset("https://my-private-proxy.example.com/v1").id).toBe(
      "custom",
    );
  });
});

describe("aiassistant/settings — testConnection", () => {
  it("returns ok with model count on a successful GET /models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ data: [{ id: "llama3" }, { id: "qwen" }] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const res = await testConnection("http://localhost:11434/v1", "");
    expect(res.ok).toBe(true);
    expect(res.message).toContain("2 models");
    expect(typeof res.latencyMs).toBe("number");
  });

  it("omits Authorization when apiKey is empty", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await testConnection("http://localhost:11434/v1", "");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toEqual({});
  });

  it("sets Authorization: Bearer when apiKey is provided", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await testConnection("https://api.openai.com/v1", "sk-abc");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toEqual({ Authorization: "Bearer sk-abc" });
  });

  it("reports HTTP error responses with status + detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    const res = await testConnection("https://api.openai.com/v1", "bad");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/401/);
  });

  it("flags likelyCors when fetch throws against a localhost URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const res = await testConnection("http://localhost:11434/v1", "");
    expect(res.ok).toBe(false);
    expect(res.likelyCors).toBe(true);
  });

  it("does not flag likelyCors for a remote URL failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const res = await testConnection("https://api.openai.com/v1", "sk-x");
    expect(res.ok).toBe(false);
    expect(res.likelyCors).toBeFalsy();
  });

  it("rejects an empty base URL early", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await testConnection("", "");
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
