/**
 * AISettingsDialog — modal to edit the AI Assistant provider settings
 * (base URL, API key, model, temperature).
 *
 * Mirrors :mod:`DataLab/datalab/aiassistant/widgets/settingsdialog.py`
 * but adapted for the browser: non-secret fields live in
 * ``localStorage`` and the API key is encrypted at rest in IndexedDB
 * via :mod:`../../aiassistant/secureStorage`. The dialog tells the
 * user about the residual XSS risk explicitly.
 */

import { useEffect, useState } from "react";
import {
  BASE_URL_PRESETS,
  DEFAULT_SETTINGS,
  detectPreset,
  fetchDevOpenAIKey,
  loadApiKey,
  loadSettings,
  saveApiKey,
  saveSettings,
  testConnection,
  type ConnectionProbeResult,
} from "../../aiassistant/settings";
import type { ProviderSettings } from "../../aiassistant/types";
import { t } from "../../i18n/translate";

interface Props {
  onClose: () => void;
  onSaved?: (settings: ProviderSettings) => void;
}

export function AISettingsDialog({ onClose, onSaved }: Props) {
  const [settings, setSettings] = useState<ProviderSettings>(() =>
    loadSettings(),
  );
  const [devKeyAvailable, setDevKeyAvailable] = useState(false);
  const [probe, setProbe] = useState<ConnectionProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const activePreset = detectPreset(settings.baseUrl);

  // Hydrate the (encrypted) API key from secure storage, then probe the
  // dev-only ``/__dev__/openai-key`` endpoint. The dev key only wins
  // when no key is currently stored.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadApiKey();
      if (cancelled) return;
      if (stored) {
        setSettings((s) => ({ ...s, apiKey: stored }));
        return;
      }
      const devKey = await fetchDevOpenAIKey();
      if (cancelled || !devKey) return;
      setDevKeyAvailable(true);
      setSettings((s) => (s.apiKey ? s : { ...s, apiKey: devKey }));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function update<K extends keyof ProviderSettings>(
    key: K,
    value: ProviderSettings[K],
  ) {
    setSettings((s) => ({ ...s, [key]: value }));
    // The probe result becomes stale as soon as ``baseUrl`` / ``apiKey``
    // change — clear it to avoid showing a misleading green check.
    if (key === "baseUrl" || key === "apiKey") setProbe(null);
  }

  function handlePresetChange(presetId: string) {
    const preset = BASE_URL_PRESETS.find((p) => p.id === presetId);
    if (!preset || preset.baseUrl === null) return;
    setSettings((s) => ({
      ...s,
      baseUrl: preset.baseUrl as string,
      // Only overwrite the model when the user hasn't customised it.
      model:
        s.model && s.model !== DEFAULT_SETTINGS.model
          ? s.model
          : (preset.defaultModel ?? s.model),
    }));
    setProbe(null);
  }

  async function handleTestConnection() {
    setProbing(true);
    try {
      const result = await testConnection(settings.baseUrl, settings.apiKey);
      setProbe(result);
    } finally {
      setProbing(false);
    }
  }

  function handleSave() {
    saveSettings(settings);
    void saveApiKey(settings.apiKey);
    onSaved?.(settings);
    onClose();
  }

  function handleReset() {
    setSettings({ ...DEFAULT_SETTINGS });
  }

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-settings-title"
      onClick={onClose}
    >
      <div
        className="card ai-settings-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 480, maxWidth: "90vw" }}
      >
        <h2 id="ai-settings-title">{t("AI Assistant — Settings")}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>{t("Provider")}</span>
            <select
              value={settings.provider}
              onChange={(e) =>
                update(
                  "provider",
                  e.target.value as ProviderSettings["provider"],
                )
              }
            >
              <option value="openai">{t("OpenAI-compatible (network)")}</option>
              <option value="mock">
                {t("Mock provider (deterministic, no network)")}
              </option>
            </select>
            <small style={{ color: "var(--text-dim)" }}>
              {t(
                "The mock provider replays a scripted set of responses — used by tests and demos, never reaches out to the network.",
              )}
            </small>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>{t("Endpoint preset")}</span>
            <select
              value={activePreset.id}
              onChange={(e) => handlePresetChange(e.target.value)}
              disabled={settings.provider === "mock"}
            >
              {BASE_URL_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {activePreset.isLocal && activePreset.corsHint && (
              <small style={{ color: "var(--text-dim)" }}>
                {activePreset.corsHint}
              </small>
            )}
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>{t("Base URL")}</span>
            <input
              type="text"
              value={settings.baseUrl}
              onChange={(e) => update("baseUrl", e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
            <small style={{ color: "var(--text-dim)" }}>
              {t(
                "OpenAI-compatible endpoint. Pick a preset above for a one-click local setup (Ollama, LM Studio, llama.cpp, vLLM).",
              )}
            </small>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>{t("Model")}</span>
            <input
              type="text"
              value={settings.model}
              onChange={(e) => update("model", e.target.value)}
              placeholder="gpt-4o-mini"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>{t("API key")}</span>
            <input
              type="password"
              value={settings.apiKey}
              onChange={(e) => update("apiKey", e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
            />
            <small style={{ color: "var(--text-dim)" }}>
              {t(
                "Encrypted at rest in this browser (AES-GCM, non-extractable key in IndexedDB). This protects against passive disk reads but not against malicious code running in this page. Leave blank for local endpoints that don't require authentication.",
              )}
              {devKeyAvailable && (
                <>
                  {" "}
                  <strong>
                    {t(
                      "Pre-filled from the OPENAI_API_KEY environment variable detected by the Vite dev server.",
                    )}
                  </strong>
                </>
              )}
            </small>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>
              {t("Temperature ({value})", {
                value: settings.temperature.toFixed(2),
              })}
            </span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={settings.temperature}
              onChange={(e) =>
                update("temperature", Number.parseFloat(e.target.value))
              }
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>{t("Max history messages (0 = unlimited)")}</span>
            <input
              type="number"
              min={0}
              max={1024}
              step={1}
              value={settings.maxHistoryMessages}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                update(
                  "maxHistoryMessages",
                  Number.isFinite(n) && n >= 0 ? n : 0,
                );
              }}
            />
            <small style={{ color: "var(--text-dim)" }}>
              {t(
                "Cap the number of past messages (user + assistant + tool) sent to the provider on each request. Useful with local models that have a small context window (e.g. n_ctx=4096 on llama.cpp): if the conversation grows beyond the model's context, the server returns HTTP 400. Set to 0 to disable the cap. The system prompt and the current user turn are always preserved.",
              )}
            </small>
          </label>
          {settings.provider === "openai" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                marginTop: 4,
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={probing || !settings.baseUrl.trim()}
                >
                  {probing ? t("Testing…") : t("Test connection")}
                </button>
                {probe && (
                  <span
                    style={{
                      color: probe.ok
                        ? "var(--text-success, #2a8a2a)"
                        : "var(--text-danger, #c33)",
                    }}
                  >
                    {probe.ok ? "✓ " : "✗ "}
                    {probe.message}
                  </span>
                )}
              </div>
              {probe &&
                !probe.ok &&
                probe.likelyCors &&
                activePreset.corsHint && (
                  <small style={{ color: "var(--text-danger, #c33)" }}>
                    {activePreset.corsHint}
                  </small>
                )}
            </div>
          )}
        </div>
        <div className="actions" style={{ marginTop: 16 }}>
          <button type="button" onClick={handleReset}>
            {t("Reset to defaults")}
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="button" onClick={handleSave}>
            {t("Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
