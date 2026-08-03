/**
 * HelpDialog — modal serving the four entries of the "?" / Help menu:
 *
 *   * ``about``      — application name, version, links and credits.
 *   * ``shortcuts``  — list of recognised keyboard shortcuts.
 *   * ``console``    — live view of the in-browser console buffer
 *                      (see :mod:`utils/consoleLog`).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import logoUrl from "../assets/DataLab.svg";
import { t } from "../i18n/translate";
import type { RuntimeApi } from "../runtime/runtime";
import {
  loadRuntimeConfig,
  type ResolvedRuntimeConfig,
} from "../runtime/runtimeConfig";
import { getRuntimeMode, type RuntimeMode } from "../runtime/runtimeMode";
import {
  clearConsoleEntries,
  getConsoleEntries,
  subscribeConsole,
  type ConsoleEntry,
} from "../utils/consoleLog";

export type HelpView = "about" | "shortcuts" | "console";

interface Props {
  view: HelpView;
  onClose: () => void;
  /** App version (defaults to ``import.meta.env.VITE_APP_VERSION`` when
   *  injected, otherwise the placeholder ``"dev"``). */
  appVersion?: string;
  runtime?: RuntimeApi;
}

const DEFAULT_VERSION =
  (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? "dev";

export function HelpDialog({ view, onClose, appVersion, runtime }: Props) {
  // Esc closes the dialog.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-dialog-title"
      onClick={onClose}
    >
      <div className="card help-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 id="help-dialog-title">{titleFor(view)}</h2>
        <div className="help-dialog-body">
          {view === "about" && (
            <AboutView
              version={appVersion ?? DEFAULT_VERSION}
              runtime={runtime}
            />
          )}
          {view === "shortcuts" && <ShortcutsView />}
          {view === "console" && <ConsoleView />}
        </div>
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t("Close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function titleFor(view: HelpView): string {
  switch (view) {
    case "about":
      return t("About DataLab Web");
    case "shortcuts":
      return t("Keyboard shortcuts");
    case "console":
      return t("Browser console log");
  }
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

interface RuntimeVersions {
  python: string;
  numpy: string;
  scipy: string;
  skimage: string;
  sigima: string;
  guidata: string;
  h5py: string;
  tifffile: string;
}

interface RuntimeDiagnostics {
  config: ResolvedRuntimeConfig;
  versions: RuntimeVersions | null;
  runtimeMode: RuntimeMode;
  opfs: boolean;
  storageMode: "ram" | "disk" | null;
  spilledCount: number;
  diskStoreBytes: number;
}

function AboutView({
  version,
  runtime,
}: {
  version: string;
  runtime?: RuntimeApi;
}) {
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void loadRuntimeConfig()
      .then(async (config) => {
        let versions: RuntimeVersions | null = null;
        if (runtime) {
          const raw = await runtime.runPython(`
import json
import sys
import guidata
import numpy
import scipy
import sigima
import skimage
import h5py
import tifffile
json.dumps({
    "python": sys.version.split()[0],
    "numpy": numpy.__version__,
    "scipy": scipy.__version__,
    "skimage": skimage.__version__,
    "sigima": sigima.__version__,
    "guidata": guidata.__version__,
    "h5py": h5py.__version__,
    "tifffile": tifffile.__version__,
})
`);
          if (typeof raw === "string") {
            versions = JSON.parse(raw) as RuntimeVersions;
          }
        }
        if (!cancelled) {
          setDiagnostics({
            config,
            versions,
            runtimeMode: getRuntimeMode(),
            opfs:
              window.isSecureContext &&
              typeof navigator.storage?.getDirectory === "function",
            storageMode: runtime?.getStorageMode() ?? null,
            spilledCount: runtime?.getSpilledCount() ?? 0,
            diskStoreBytes: runtime?.getDiskStoreBytes() ?? 0,
          });
        }
      })
      .catch((error) => {
        console.warn("[diagnostics] unable to collect runtime versions", error);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  return (
    <div className="help-about">
      <div className="help-about-header">
        <img src={logoUrl} alt="" className="help-about-logo" />
        <div>
          <div className="help-about-name">DataLab Web</div>
          <div className="help-about-version">
            {t("version {version}", { version })}
          </div>
        </div>
      </div>
      <div className="help-about-experimental" role="note">
        <strong>{t("Beta software.")}</strong>{" "}
        {t(
          "DataLab-Web is under active development and some features may still be incomplete or behave unexpectedly. If you run into an issue, please report it on the",
        )}{" "}
        <a
          href="https://github.com/DataLab-Platform/web/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("GitHub issue tracker")}
        </a>
        . {t("Contributions are welcome — see")}{" "}
        <a
          href="https://github.com/DataLab-Platform/web/blob/main/CONTRIBUTING.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          CONTRIBUTING.md
        </a>
        .
      </div>
      <p>
        {t(
          "Browser-native sibling of the DataLab desktop application. The Sigima computation engine runs entirely client-side via Pyodide (CPython compiled to WebAssembly); no data leaves your browser.",
        )}
      </p>
      <div className="help-about-doc-scope" role="note">
        <strong>{t("About the online documentation.")}</strong> {t("The")}{" "}
        <a
          href="https://datalab-platform.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("DataLab project website")}
        </a>{" "}
        {t(
          "is centred on the desktop application. Because DataLab-Web shares the same computation engine (Sigima) and the same processing catalog, most of that content remains directly relevant. Web-specific differences (in-browser execution via Pyodide, persistence, plugins, macros, notebooks) are not covered there.",
        )}
      </div>
      <ul className="help-about-links">
        <li>
          <a
            href="https://datalab-platform.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("DataLab project website")}
          </a>{" "}
          <span
            className="help-about-link-tag"
            title={t("Centred on the DataLab desktop application")}
          >
            {t("desktop-focused")}
          </span>
        </li>
        <li>
          <a
            href="https://github.com/DataLab-Platform/web"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("DataLab-Web on GitHub")}
          </a>
        </li>
        <li>
          <a
            href="https://github.com/DataLab-Platform/Sigima"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("Sigima computation engine")}
          </a>
        </li>
        <li>
          <a
            href="https://pyodide.org/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Pyodide
          </a>
        </li>
      </ul>
      <p className="help-about-credits">
        {t("Created by Pierre Raybaut")}
        <br />
        {t("Developed and maintained by DataLab Web open-source project team")}
        <br />
        {t("Copyright © 2026 DataLab Platform Developers")}
      </p>
      <p className="help-about-license">
        {t("Released under the BSD 3-Clause License.")}
      </p>
      <section className="help-runtime-diagnostics">
        <h3>{t("Runtime diagnostics")}</h3>
        {diagnostics ? (
          <dl>
            <dt>{t("Distribution")}</dt>
            <dd>{diagnostics.config.distribution}</dd>
            <dt>Pyodide</dt>
            <dd>{diagnostics.config.pyodideVersion}</dd>
            <dt>{t("Runtime base URL")}</dt>
            <dd>{diagnostics.config.deploymentRootUrl}</dd>
            <dt>{t("Runtime mode")}</dt>
            <dd>{diagnostics.runtimeMode}</dd>
            {diagnostics.versions && (
              <>
                <dt>Python</dt>
                <dd>{diagnostics.versions.python}</dd>
                <dt>Sigima</dt>
                <dd>{diagnostics.versions.sigima}</dd>
                <dt>guidata</dt>
                <dd>{diagnostics.versions.guidata}</dd>
                <dt>NumPy</dt>
                <dd>{diagnostics.versions.numpy}</dd>
                <dt>SciPy</dt>
                <dd>{diagnostics.versions.scipy}</dd>
                <dt>scikit-image</dt>
                <dd>{diagnostics.versions.skimage}</dd>
                <dt>h5py</dt>
                <dd>{diagnostics.versions.h5py}</dd>
                <dt>tifffile</dt>
                <dd>{diagnostics.versions.tifffile}</dd>
              </>
            )}
            <dt>OPFS</dt>
            <dd>{diagnostics.opfs ? t("Available") : t("Unavailable")}</dd>
            <dt>{t("Data storage")}</dt>
            <dd>{diagnostics.storageMode ?? t("Unavailable")}</dd>
            <dt>{t("Objects stored on disk")}</dt>
            <dd>{diagnostics.spilledCount}</dd>
            <dt>{t("OPFS bytes")}</dt>
            <dd>{diagnostics.diskStoreBytes}</dd>
          </dl>
        ) : (
          <p>{t("Collecting runtime versions…")}</p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

interface Shortcut {
  keys: string;
  action: string;
}

const SHORTCUTS: { group: string; entries: Shortcut[] }[] = [
  {
    group: "Side panel (parameter form)",
    entries: [
      {
        keys: "Ctrl+Enter",
        action: "Apply pending changes (also Cmd+Enter on macOS)",
      },
    ],
  },
  {
    group: "Macros & Notebook",
    entries: [
      {
        keys: "Ctrl+Enter",
        action: "Run current macro / active notebook cell",
      },
    ],
  },
  {
    group: "Object tree",
    entries: [
      { keys: "Enter", action: "Confirm rename of the edited item" },
      { keys: "Esc", action: "Cancel rename of the edited item" },
    ],
  },
  {
    group: "Dialogs",
    entries: [
      { keys: "Esc", action: "Close / cancel the active dialog" },
      {
        keys: "Enter",
        action: "Dismiss message dialogs and submit forms",
      },
    ],
  },
  {
    group: "Plot area",
    entries: [
      {
        keys: "Mouse wheel",
        action: "Zoom in / out around the cursor (Plotly default)",
      },
      { keys: "Drag", action: "Pan or define a zoom rectangle" },
      { keys: "Double-click", action: "Reset axes to autoscale" },
    ],
  },
];

function ShortcutsView() {
  return (
    <div className="help-shortcuts">
      {SHORTCUTS.map((group) => (
        <section key={group.group}>
          <h3>{t(group.group)}</h3>
          <table>
            <tbody>
              {group.entries.map((s) => (
                <tr key={s.keys + s.action}>
                  <td>
                    <kbd>{s.keys}</kbd>
                  </td>
                  <td>{t(s.action)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Console log
// ---------------------------------------------------------------------------

const LEVEL_FILTERS: { id: "all" | ConsoleEntry["level"]; label: string }[] = [
  { id: "all", label: "All" },
  { id: "log", label: "log" },
  { id: "info", label: "info" },
  { id: "warn", label: "warn" },
  { id: "error", label: "error" },
];

function ConsoleView() {
  const [, setTick] = useState(0);
  const [filter, setFilter] =
    useState<(typeof LEVEL_FILTERS)[number]["id"]>("all");
  const listRef = useRef<HTMLDivElement | null>(null);

  // Subscribe to live updates from the buffer.
  useEffect(() => {
    return subscribeConsole(() => setTick((n) => n + 1));
  }, []);

  const entries = useMemo(() => {
    const all = getConsoleEntries();
    if (filter === "all") return all;
    return all.filter((e) => e.level === filter);
  }, [filter /* recompute when buffer changes via tick */]);

  // Auto-scroll to bottom on new entry.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const handleCopy = async () => {
    const text = entries
      .map(
        (e) =>
          `[${e.time.toISOString()}] ${e.level.toUpperCase()}  ${e.message}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore clipboard failures (permission denied, etc.)
    }
  };

  return (
    <div className="help-console">
      <div className="help-console-toolbar">
        <label>
          {t("Level:")}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            {LEVEL_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.id === "all" ? t(f.label) : f.label}
              </option>
            ))}
          </select>
        </label>
        <span className="help-console-count">
          {t("{count} entries", { count: entries.length })}
        </span>
        <div className="help-console-buttons">
          <button type="button" onClick={handleCopy}>
            {t("Copy")}
          </button>
          <button type="button" onClick={clearConsoleEntries}>
            {t("Clear")}
          </button>
        </div>
      </div>
      <div className="help-console-list" ref={listRef}>
        {entries.length === 0 ? (
          <div className="help-console-empty">
            {t("No console output captured yet.")}
          </div>
        ) : (
          entries.map((e) => (
            <div
              key={e.id}
              className={`help-console-line help-console-${e.level}`}
            >
              <span className="help-console-time">
                {e.time.toLocaleTimeString()}
              </span>
              <span className="help-console-level">
                {e.level.toUpperCase()}
              </span>
              <span className="help-console-msg">{e.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
