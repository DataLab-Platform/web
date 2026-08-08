/**
 * HelpDialog — modal serving informational entries of the "?" / Help menu:
 *
 *   * ``about``      — application name, version, links and credits.
 *   * ``shortcuts``  — list of recognised keyboard shortcuts.
 *   * ``console``    — live view of the in-browser console buffer
 *                      (see :mod:`utils/consoleLog`).
 *   * ``environment`` — installation and browser diagnostics.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import logoUrl from "../assets/DataLab.svg";
import { getEditIconUrl } from "../assets/editIcons";
import { t } from "../i18n/translate";
import type { RuntimeApi } from "../runtime/RuntimeApi";
import {
  collectEnvironmentReport,
  formatEnvironmentReportMarkdown,
  type EnvironmentReport,
  type EnvironmentRuntimeStatus,
} from "../utils/environmentReport";
import {
  clearConsoleEntries,
  getConsoleEntries,
  subscribeConsole,
  type ConsoleEntry,
} from "../utils/consoleLog";

export type HelpView = "about" | "shortcuts" | "console" | "environment";

interface Props {
  view: HelpView;
  onClose: () => void;
  /** App version (defaults to ``import.meta.env.VITE_APP_VERSION`` when
   *  injected, otherwise the placeholder ``"dev"``). */
  appVersion?: string;
  runtime?: RuntimeApi | null;
  runtimeStatus?: EnvironmentRuntimeStatus;
}

const DEFAULT_VERSION =
  (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? "dev";

export function HelpDialog({
  view,
  onClose,
  appVersion,
  runtime = null,
  runtimeStatus = runtime ? "ready" : "loading",
}: Props) {
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
      <div
        className={`card help-dialog${view === "environment" ? " help-dialog-environment" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="help-dialog-title">{titleFor(view)}</h2>
        <div
          className={`help-dialog-body${view === "environment" ? " help-dialog-body-environment" : ""}`}
        >
          {view === "about" && (
            <AboutView version={appVersion ?? DEFAULT_VERSION} />
          )}
          {view === "shortcuts" && <ShortcutsView />}
          {view === "console" && <ConsoleView />}
          {view === "environment" && (
            <EnvironmentView
              runtime={runtime}
              runtimeStatus={runtimeStatus}
              appVersion={appVersion ?? DEFAULT_VERSION}
            />
          )}
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
    case "environment":
      return t("Installation and configuration");
  }
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

function AboutView({ version }: { version: string }) {
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

// ---------------------------------------------------------------------------
// Installation and configuration
// ---------------------------------------------------------------------------

const COPY_REPORT_ICON = getEditIconUrl("copy_titles.svg");

function DetailRows({
  rows,
}: {
  rows: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <dl className="help-environment-details">
      {rows.map(([label, value]) => (
        <div className="help-environment-detail" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function available(value: string | null | undefined): string {
  return value || t("Unavailable");
}

function EnvironmentView({
  runtime,
  runtimeStatus,
  appVersion,
}: {
  runtime: RuntimeApi | null;
  runtimeStatus: EnvironmentRuntimeStatus;
  appVersion: string;
}) {
  const [report, setReport] = useState<EnvironmentReport | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setCopyState("idle");
    void collectEnvironmentReport({
      runtime,
      runtimeStatus,
      appVersion,
    }).then((nextReport) => {
      if (!cancelled) setReport(nextReport);
    });
    return () => {
      cancelled = true;
    };
  }, [appVersion, runtime, runtimeStatus]);

  const handleCopy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(
        formatEnvironmentReportMarkdown(report),
      );
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const copyFeedback =
    copyState === "copied"
      ? t("Copied!")
      : copyState === "error"
        ? t("Clipboard access was denied.")
        : "";

  return (
    <div className="help-environment">
      <div className="help-environment-toolbar">
        <p>
          {t(
            "This diagnostic snapshot contains no workspace data and is ready to paste into a bug report.",
          )}
        </p>
        <div className="help-environment-copy-area">
          <button
            type="button"
            className="help-environment-copy"
            onClick={handleCopy}
            disabled={!report}
          >
            {COPY_REPORT_ICON && (
              <img src={COPY_REPORT_ICON} alt="" aria-hidden="true" />
            )}
            <span>{t("Copy report")}</span>
          </button>
          <span
            className={`help-environment-copy-feedback help-environment-copy-${copyState}`}
            role="status"
            aria-live="polite"
          >
            {copyFeedback}
          </span>
        </div>
      </div>

      <div className="help-environment-content">
        {!report ? (
          <div className="help-environment-pending">
            {t("Collecting environment information…")}
          </div>
        ) : (
          <>
            <p className="help-environment-captured">
              {t("Snapshot captured {date}", {
                date: new Date(report.capturedAt).toLocaleString(),
              })}
            </p>

            <section>
              <h3>{t("Application")}</h3>
              <DetailRows
                rows={[
                  ["DataLab Web", report.application.version],
                  [t("Build mode"), report.application.buildMode],
                  [
                    t("Runtime mode"),
                    report.application.runtimeMode === "worker"
                      ? t("Web Worker")
                      : t("Main thread"),
                  ],
                  [
                    t("Storage mode"),
                    report.application.storageMode === "disk"
                      ? t("Browser storage (OPFS)")
                      : report.application.storageMode === "ram"
                        ? t("Memory (RAM)")
                        : t("Unavailable"),
                  ],
                  [
                    t("OPFS availability"),
                    report.application.opfsSupported
                      ? t("Available")
                      : t("Unavailable"),
                  ],
                ]}
              />
            </section>

            <section>
              <h3>{t("Python and Pyodide")}</h3>
              {report.python.status === "ready" ? (
                <DetailRows
                  rows={[
                    [t("Python version"), report.python.info.pythonVersion],
                    [
                      t("Implementation"),
                      available(report.python.info.pythonImplementation),
                    ],
                    [
                      t("Python platform"),
                      available(report.python.info.pythonPlatform),
                    ],
                    [t("Platform"), available(report.python.info.platform)],
                    [t("Machine"), available(report.python.info.machine)],
                    ["Pyodide", available(report.python.info.pyodideVersion)],
                  ]}
                />
              ) : (
                <div
                  className={`help-environment-runtime-state help-environment-runtime-${report.python.status}`}
                  role="status"
                >
                  {report.python.reason === "runtime-loading"
                    ? t(
                        "The Python runtime is still loading. Browser information is already available.",
                      )
                    : report.python.reason === "collection-failed"
                      ? t(
                          "Python environment information could not be collected.",
                        )
                      : t("The Python runtime is unavailable.")}
                </div>
              )}
            </section>

            <section>
              <h3>{t("Web environment")}</h3>
              <DetailRows
                rows={[
                  [t("User agent"), available(report.browser.userAgent)],
                  [t("Platform"), available(report.browser.platform)],
                  [t("Browser language"), available(report.browser.language)],
                  [t("Interface language"), report.browser.activeLocale],
                  [
                    "WebAssembly",
                    report.browser.webAssemblySupported
                      ? t("Available")
                      : t("Unavailable"),
                  ],
                ]}
              />
            </section>

            {report.python.status === "ready" && (
              <section className="help-environment-packages">
                <h3>
                  {t("Python distributions ({count})", {
                    count: report.python.info.packages.length,
                  })}
                </h3>
                <div
                  className="help-environment-package-table-wrap"
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{t("Package")}</th>
                        <th scope="col">{t("Version")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.python.info.packages.map((entry) => (
                        <tr key={`${entry.name}:${entry.version}`}>
                          <td>{entry.name}</td>
                          <td>{entry.version}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
