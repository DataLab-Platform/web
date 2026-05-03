/**
 * Persistent settings for the AI Assistant provider.
 *
 * Stored in ``localStorage`` under a single namespaced key so the user
 * keeps base URL / model / API key / temperature across reloads.
 *
 * Security note: the API key is visible to any script running on the
 * same origin. The settings dialog must say so explicitly.
 */

import type { ProviderSettings } from "./types";

const STORAGE_KEY = "datalab-web.aiassistant.settings";

export const DEFAULT_SETTINGS: ProviderSettings = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.2,
};

/** Read settings from ``localStorage`` (falls back to defaults). */
export function loadSettings(): ProviderSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ProviderSettings>;
    return {
      baseUrl: parsed.baseUrl ?? DEFAULT_SETTINGS.baseUrl,
      apiKey: parsed.apiKey ?? DEFAULT_SETTINGS.apiKey,
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

/** Persist settings to ``localStorage`` (best-effort). */
export function saveSettings(settings: ProviderSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore quota / disabled storage */
  }
}

/** True when the provider is configured well enough to issue a request.
 *  Local endpoints (Ollama / vLLM) typically don't require an API key,
 *  so we only enforce ``baseUrl`` + ``model`` here. */
export function isConfigured(settings: ProviderSettings): boolean {
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
