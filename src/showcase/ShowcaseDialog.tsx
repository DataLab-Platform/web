/**
 * "Showcase mode" dialog (Help > Showcase mode…): choose the demos, loop,
 * pace and full screen, then start the showcase. Part of the lazily loaded
 * showcase chunk.
 */

import { useEffect, useState } from "react";
import { t } from "../i18n/translate";
import { ShowcaseContext, type ShowcaseScenario } from "./engine";
import "./i18n";
import { getShowcaseScenarios, NATIVE_SCENARIOS } from "./index";
import type { ShowcaseHost } from "./launch";
import {
  DEFAULT_RELOAD_EVERY,
  PACE_SPEED,
  type ShowcaseOptions,
  type ShowcasePace,
} from "./options";
import "./showcase.css";

interface Props {
  /** Showcase host, ``null`` while the runtime is not ready. */
  getHost: () => ShowcaseHost | null;
  /** The workspace holds unsaved changes (the showcase clears it). */
  unsavedChanges: boolean;
  onStart: (options: ShowcaseOptions) => void;
  onClose: () => void;
}

export function ShowcaseDialog({
  getHost,
  unsavedChanges,
  onStart,
  onClose,
}: Props) {
  const [host] = useState(getHost);
  const [scenarios, setScenarios] =
    useState<ShowcaseScenario[]>(NATIVE_SCENARIOS);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(NATIVE_SCENARIOS.map((scenario) => scenario.id)),
  );
  const [searching, setSearching] = useState(host !== null);
  const [loop, setLoop] = useState(false);
  const [pace, setPace] = useState<ShowcasePace>("normal");
  const [fullScreen, setFullScreen] = useState(true);

  // Application scenarios depend on the loaded plugins.
  useEffect(() => {
    if (!host) return;
    let cancelled = false;
    getShowcaseScenarios(new ShowcaseContext(host, { speed: 1 }))
      .then((all) => {
        if (cancelled) return;
        setScenarios(all);
        setSelected((previous) => {
          const next = new Set(previous);
          for (const scenario of all) {
            if (!NATIVE_SCENARIOS.includes(scenario)) next.add(scenario.id);
          }
          return next;
        });
      })
      .catch((error) => console.warn("[showcase] scenario listing", error))
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [host]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const start = () => {
    // Must run within the click handler (user gesture).
    if (fullScreen && !document.fullscreenElement) {
      void document.documentElement
        .requestFullscreen?.()
        .catch(() => undefined);
    }
    onStart({
      ids: scenarios
        .filter((scenario) => selected.has(scenario.id))
        .map((scenario) => scenario.id),
      loop,
      speed: PACE_SPEED[pace],
      check: false,
      reloadEvery: DEFAULT_RELOAD_EVERY,
      fromUrl: false,
      close: false,
    });
  };

  const count = scenarios.filter((s) => selected.has(s.id)).length;
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("Showcase mode")}
    >
      <div className="card showcase-dialog">
        <h2>{t("Showcase mode")}</h2>
        <p className="showcase-dialog-intro">
          {t(
            "Play automated live demos of DataLab Web, for example on a conference booth screen.",
          )}
        </p>
        <fieldset className="showcase-dialog-list">
          <legend>{t("Demos")}</legend>
          {scenarios.map((scenario) => (
            <label key={scenario.id}>
              <input
                type="checkbox"
                checked={selected.has(scenario.id)}
                onChange={() => toggle(scenario.id)}
              />
              <span>{scenario.title()}</span>
              <span className="showcase-dialog-id">{scenario.id}</span>
            </label>
          ))}
          {searching && (
            <p className="showcase-dialog-hint">
              {t("Looking for application plugins…")}
            </p>
          )}
        </fieldset>
        <div className="showcase-dialog-options">
          <label>
            <input
              type="checkbox"
              checked={loop}
              onChange={(event) => setLoop(event.target.checked)}
            />
            {t("Loop")}
          </label>
          <label>
            {t("Pace")}
            <select
              value={pace}
              onChange={(event) => setPace(event.target.value as ShowcasePace)}
            >
              <option value="slow">{t("Slow")}</option>
              <option value="normal">{t("Normal")}</option>
              <option value="fast">{t("Fast")}</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={fullScreen}
              onChange={(event) => setFullScreen(event.target.checked)}
            />
            {t("Full screen")}
          </label>
        </div>
        <p className="showcase-dialog-hint">
          {t(
            "While the demos play: F9 pauses or resumes, Shift+F12 stops after the current demo (press it again to resume), Esc quits.",
          )}
        </p>
        {unsavedChanges && (
          <p className="showcase-dialog-warning">
            {t(
              "The showcase clears the workspace: unsaved signals, images, macros and notebooks will be lost.",
            )}
          </p>
        )}
        {!host && (
          <p className="showcase-dialog-warning">
            {t("Please wait until the Python runtime is ready.")}
          </p>
        )}
        <div className="actions">
          <button onClick={onClose}>{t("Cancel")}</button>
          <button onClick={start} disabled={!host || count === 0} autoFocus>
            {t("Start")}
          </button>
        </div>
      </div>
    </div>
  );
}
