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

const STORAGE_KEY = "datalab-web.aiassistant.settings";

export const DEFAULT_SETTINGS: ProviderSettings = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.2,
};

function normaliseProvider(value: unknown): ProviderKind {
  return value === "mock" ? "mock" : "openai";
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
    // fire-and-forget an encrypted copy and strip the plaintext from
    // the on-disk record.
    if (typeof parsed.apiKey === "string" && parsed.apiKey) {
      const legacyKey = parsed.apiKey;
      void saveApiKey(legacyKey).then(() => {
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
      });
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
 *  (registered by the Vite plugin in ``plugins/vite-plugin-openai-key-dev.ts``).
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
