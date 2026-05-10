/**
 * AISettingsDialog — modal to edit the AI Assistant provider settings
 * (base URL, API key, model, temperature).
 *
 * Mirrors :mod:`DataLab/datalab/aiassistant/widgets/settingsdialog.py`
 * but adapted for the browser: the API key is stored in
 * ``localStorage`` and is therefore visible to any script on the same
 * origin. The dialog tells the user explicitly.
 */

import { useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  fetchDevOpenAIKey,
  loadSettings,
  saveSettings,
} from "../../aiassistant/settings";
import type { ProviderSettings } from "../../aiassistant/types";

interface Props {
  onClose: () => void;
  onSaved?: (settings: ProviderSettings) => void;
}

export function AISettingsDialog({ onClose, onSaved }: Props) {
  const [settings, setSettings] = useState<ProviderSettings>(() =>
    loadSettings(),
  );
  const [devKeyAvailable, setDevKeyAvailable] = useState(false);

  // Probe the dev-only ``/__dev__/openai-key`` endpoint on mount. When
  // it returns a non-empty key AND the dialog field is currently empty,
  // pre-fill the field so the user can save it in one click.
  useEffect(() => {
    let cancelled = false;
    void fetchDevOpenAIKey().then((devKey) => {
      if (cancelled || !devKey) return;
      setDevKeyAvailable(true);
      setSettings((s) => (s.apiKey ? s : { ...s, apiKey: devKey }));
    });
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
  }

  function handleSave() {
    saveSettings(settings);
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
        <h2 id="ai-settings-title">AI Assistant — Settings</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>Base URL</span>
            <input
              type="text"
              value={settings.baseUrl}
              onChange={(e) => update("baseUrl", e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
            <small style={{ color: "var(--text-dim)" }}>
              OpenAI-compatible endpoint. For a local Ollama, run it with
              <code> OLLAMA_ORIGINS=*</code> and use
              <code> http://localhost:11434/v1</code>.
            </small>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>Model</span>
            <input
              type="text"
              value={settings.model}
              onChange={(e) => update("model", e.target.value)}
              placeholder="gpt-4o-mini"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>API key</span>
            <input
              type="password"
              value={settings.apiKey}
              onChange={(e) => update("apiKey", e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
            />
            <small style={{ color: "var(--text-dim)" }}>
              Stored in your browser's <code>localStorage</code> — visible to
              any script running on this origin. Leave blank for local endpoints
              that don't require authentication.
              {devKeyAvailable && (
                <>
                  {" "}
                  <strong>
                    Pre-filled from the <code>OPENAI_API_KEY</code> environment
                    variable detected by the Vite dev server.
                  </strong>
                </>
              )}
            </small>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>Temperature ({settings.temperature.toFixed(2)})</span>
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
        </div>
        <div className="actions" style={{ marginTop: 16 }}>
          <button type="button" onClick={handleReset}>
            Reset to defaults
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
