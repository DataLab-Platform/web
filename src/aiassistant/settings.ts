/**
 * Persistent settings for the AI Assistant provider.
 *
 * Non-secret fields (``provider``, ``baseUrl``, ``model``,
 * ``temperature``) live in ``localStorage`` under a single namespaced
 * key. The ``apiKey`` field is **never** written to ``localStorage``;
 * it is encrypted at rest in IndexedDB by :mod:`./secureStorage` (AES-
 * GCM with a non-extractable wrapping ``CryptoKey``). See that module
 * for the threat-model caveats.
 *
 * The synchronous :func:`loadSettings` therefore returns
 * ``apiKey: ""`` and the caller must hydrate the key separately via
 * :func:`loadApiKey`. A best-effort migration silently encrypts any
 * pre-existing plaintext key found in ``localStorage`` and strips it
 * from the JSON payload.
 */

import { saveApiKey } from "./secureStorage";
import type { ProviderKind, ProviderSettings } from "./types";
import { t } from "../i18n/translate";

const STORAGE_KEY = "datalab-web.aiassistant.settings";

export const DEFAULT_SETTINGS: ProviderSettings = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.2,
  maxHistoryMessages: 0,
};

function normaliseProvider(value: unknown): ProviderKind {
  return value === "mock" ? "mock" : "openai";
}

// Guards the one-shot plaintext→encrypted API-key migration so it runs at
// most once per session even if ``loadSettings`` is called repeatedly
// before it completes. Reset to ``null`` on failure to allow a retry.
let legacyKeyMigration: Promise<void> | null = null;

function migrateLegacyPlaintextKey(legacyKey: string): Promise<void> {
  if (legacyKeyMigration) return legacyKeyMigration;
  legacyKeyMigration = saveApiKey(legacyKey)
    .then(() => {
      try {
        const current = window.localStorage.getItem(STORAGE_KEY);
        if (!current) return;
        const obj = JSON.parse(current) as Record<string, unknown>;
        if (obj && "apiKey" in obj) {
          delete obj.apiKey;
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
        }
      } catch {
        /* ignore */
      }
    })
    .catch(() => {
      // Encrypted write failed — allow a later load to retry the migration.
      legacyKeyMigration = null;
    });
  return legacyKeyMigration;
}

/** Read non-secret settings from ``localStorage``. The returned
 *  ``apiKey`` is always empty — call :func:`loadApiKey` to fetch the
 *  encrypted value from IndexedDB. */
export function loadSettings(): ProviderSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ProviderSettings> & {
      apiKey?: string;
    };
    // Migration: a previous version of DataLab-Web persisted the API
    // key in plaintext alongside the other fields. If we see one,
    // encrypt it and strip the plaintext from the on-disk record. The
    // migration is deduplicated so repeated ``loadSettings`` calls don't
    // race each other.
    if (typeof parsed.apiKey === "string" && parsed.apiKey) {
      void migrateLegacyPlaintextKey(parsed.apiKey);
    }
    return {
      provider: normaliseProvider(parsed.provider),
      baseUrl: parsed.baseUrl ?? DEFAULT_SETTINGS.baseUrl,
      // Never echo the legacy plaintext key back synchronously — the
      // caller must use ``loadApiKey()``.
      apiKey: "",
      model: parsed.model ?? DEFAULT_SETTINGS.model,
      temperature:
        typeof parsed.temperature === "number"
          ? parsed.temperature
          : DEFAULT_SETTINGS.temperature,
      maxHistoryMessages:
        typeof parsed.maxHistoryMessages === "number" &&
        parsed.maxHistoryMessages >= 0
          ? Math.floor(parsed.maxHistoryMessages)
          : DEFAULT_SETTINGS.maxHistoryMessages,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persist non-secret settings to ``localStorage``. The ``apiKey``
 *  field is intentionally stripped — encrypted persistence happens via
 *  :func:`saveApiKey` (called separately by the caller). */
export function saveSettings(settings: ProviderSettings): void {
  try {
    const { apiKey: _omit, ...rest } = settings;
    void _omit;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch {
    /* ignore quota / disabled storage */
  }
}

/** Re-export the secure-storage primitives so callers don't need to
 *  reach into a second module just to handle the API key. */
export {
  clearApiKey,
  hasStoredApiKey,
  loadApiKey,
  saveApiKey,
} from "./secureStorage";

/** True when the provider is configured well enough to issue a request.
 *  Local endpoints (Ollama / vLLM) typically don't require an API key,
 *  so we only enforce ``baseUrl`` + ``model`` here. The mock provider
 *  is always considered configured (no network call). */
export function isConfigured(settings: ProviderSettings): boolean {
  if (settings.provider === "mock") return true;
  return Boolean(settings.baseUrl.trim() && settings.model.trim());
}

/** Best-effort fetch of the dev-only ``/__dev__/openai-key`` endpoint
 *  (registered by the Vite plugin in ``build-plugins/vite-plugin-openai-key-dev.ts``).
 *
 *  Returns the developer's shell ``OPENAI_API_KEY`` when running under
 *  ``npm run dev``, or an empty string otherwise (production build, no
 *  variable defined, or endpoint unreachable). The endpoint never ships
 *  with the production bundle, so this is a no-op outside dev. */
export async function fetchDevOpenAIKey(): Promise<string> {
  try {
    const response = await fetch("/__dev__/openai-key", {
      cache: "no-store",
    });
    if (!response.ok) return "";
    const payload = (await response.json()) as { apiKey?: string };
    return typeof payload.apiKey === "string" ? payload.apiKey : "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Base-URL presets — pure UI helper (no schema change to ``ProviderSettings``).
// ---------------------------------------------------------------------------

/** One entry of the "preset" dropdown in :class:`AISettingsDialog`. */
export interface BaseUrlPreset {
  /** Stable id used as the ``<option value>``. */
  id: string;
  /** Human label shown in the dropdown. */
  label: string;
  /** Filled into the ``baseUrl`` field when selected; ``null`` for
   *  the "Custom" entry which leaves the existing value untouched. */
  baseUrl: string | null;
  /** Default model name to suggest alongside the URL. */
  defaultModel?: string;
  /** True when the server typically runs on the user's machine — used
   *  to tailor error hints (CORS, ``OLLAMA_ORIGINS``, …). */
  isLocal: boolean;
  /** One-line instruction for enabling cross-origin access. */
  corsHint?: string;
}

export const BASE_URL_PRESETS: BaseUrlPreset[] = [
  {
    id: "openai",
    label: t("OpenAI (cloud)"),
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    isLocal: false,
  },
  {
    id: "ollama",
    label: t("Ollama (local)"),
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.2:3b",
    isLocal: true,
    corsHint: t(
      "Start ollama with OLLAMA_ORIGINS=* (env var) so the browser can connect.",
    ),
  },
  {
    id: "lmstudio",
    label: t("LM Studio (local)"),
    baseUrl: "http://localhost:1234/v1",
    defaultModel: "local-model",
    isLocal: true,
    corsHint: t(
      "In LM Studio → Developer → Server Settings, enable CORS, then set Model to the loaded model's API identifier (e.g. 'google/gemma-4-e4b').",
    ),
  },
  {
    id: "llamacpp",
    label: t("llama.cpp server (local)"),
    baseUrl: "http://localhost:8080/v1",
    defaultModel: "local-model",
    isLocal: true,
    corsHint: t(
      "Run llama-server with --api-key-allow-empty and the default CORS headers (built-in).",
    ),
  },
  {
    id: "vllm",
    label: t("vLLM (local)"),
    baseUrl: "http://localhost:8000/v1",
    defaultModel: "local-model",
    isLocal: true,
    corsHint: t(
      "Start vllm with --allowed-origins '*' so the browser can reach /v1/*.",
    ),
  },
  {
    id: "custom",
    label: t("Custom…"),
    baseUrl: null,
    isLocal: false,
  },
];

/** Return the preset that matches *baseUrl* exactly, or ``"custom"``. */
export function detectPreset(baseUrl: string): BaseUrlPreset {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  for (const p of BASE_URL_PRESETS) {
    if (p.baseUrl && p.baseUrl.replace(/\/+$/, "") === trimmed) return p;
  }
  return BASE_URL_PRESETS[BASE_URL_PRESETS.length - 1];
}

// ---------------------------------------------------------------------------
// Connection probe (Test Connection button).
// ---------------------------------------------------------------------------

/** Outcome of :func:`testConnection`. */
export interface ConnectionProbeResult {
  ok: boolean;
  /** Human-readable summary suitable for display next to the button. */
  message: string;
  /** ``true`` when the failure looks like a CORS / network reachability
   *  issue against a local server — caller may surface the
   *  preset-specific :attr:`BaseUrlPreset.corsHint`. */
  likelyCors?: boolean;
  /** Round-trip latency in milliseconds when the probe succeeded. */
  latencyMs?: number;
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}

/** Send a minimal request to ``${baseUrl}/models`` to verify reachability,
 *  authentication and CORS.
 *
 *  Uses ``GET /models`` rather than a full chat completion because every
 *  OpenAI-compatible server implements it and it carries no token cost.
 */
export async function testConnection(
  baseUrl: string,
  apiKey: string,
  options: { signal?: AbortSignal } = {},
): Promise<ConnectionProbeResult> {
  const trimmedUrl = baseUrl.trim();
  if (!trimmedUrl) {
    return { ok: false, message: t("Base URL is empty.") };
  }
  const headers: Record<string, string> = {};
  if (apiKey.trim()) headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(joinUrl(trimmedUrl, "/models"), {
      method: "GET",
      headers,
      signal: options.signal,
    });
  } catch (err) {
    // ``fetch`` rejects with a generic ``TypeError`` on network errors —
    // including CORS rejections, DNS failures and connection refused.
    // Heuristic: if the URL targets a local host, suggest CORS.
    const message = err instanceof Error ? err.message : String(err);
    const likelyCors = /^https?:\/\/(localhost|127\.|\[::1\])/i.test(
      trimmedUrl,
    );
    return {
      ok: false,
      message: t("Cannot reach {url} — {message}", {
        url: trimmedUrl,
        message,
      }),
      likelyCors,
    };
  }
  const latencyMs = Math.round(performance.now() - started);
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      message: `HTTP ${response.status} ${response.statusText}${
        detail ? ` — ${detail}` : ""
      }`,
      latencyMs,
    };
  }
  let modelCount: number | null = null;
  try {
    const payload = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };
    if (Array.isArray(payload.data)) modelCount = payload.data.length;
  } catch {
    /* not JSON — still consider the probe successful */
  }
  return {
    ok: true,
    latencyMs,
    message:
      modelCount !== null
        ? t("Connected — {count} models ({latency} ms)", {
            count: modelCount,
            latency: latencyMs,
          })
        : t("Connected ({latency} ms)", { latency: latencyMs }),
  };
}
