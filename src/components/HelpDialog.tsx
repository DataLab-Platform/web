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
}

const DEFAULT_VERSION =
  (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? "dev";

export function HelpDialog({ view, onClose, appVersion }: Props) {
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
            <AboutView version={appVersion ?? DEFAULT_VERSION} />
          )}
          {view === "shortcuts" && <ShortcutsView />}
          {view === "console" && <ConsoleView />}
        </div>
        <div className="actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function titleFor(view: HelpView): string {
  switch (view) {
    case "about":
      return "About DataLab Web";
    case "shortcuts":
      return "Keyboard shortcuts";
    case "console":
      return "Browser console log";
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
          <div className="help-about-version">version {version}</div>
        </div>
      </div>
      <div className="help-about-experimental" role="note">
        <strong>Beta software.</strong> DataLab-Web is under active development
        and some features may still be incomplete or behave unexpectedly. If you
        run into an issue, please report it on the{" "}
        <a
          href="https://github.com/DataLab-Platform/DataLab-Web/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub issue tracker
        </a>
        . Contributions are welcome — see{" "}
        <a
          href="https://github.com/DataLab-Platform/DataLab-Web/blob/main/CONTRIBUTING.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          CONTRIBUTING.md
        </a>
        .
      </div>
      <p>
        Browser-native sibling of the DataLab desktop application. The Sigima
        computation engine runs entirely client-side via Pyodide (CPython
        compiled to WebAssembly); no data leaves your browser.
      </p>
      <ul className="help-about-links">
        <li>
          <a
            href="https://datalab-platform.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            DataLab project website
          </a>
        </li>
        <li>
          <a
            href="https://github.com/DataLab-Platform/DataLab-Web"
            target="_blank"
            rel="noopener noreferrer"
          >
            DataLab-Web on GitHub
          </a>
        </li>
        <li>
          <a
            href="https://github.com/DataLab-Platform/Sigima"
            target="_blank"
            rel="noopener noreferrer"
          >
            Sigima computation engine
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
        Created by Pierre Raybaut
        <br />
        Developed and maintained by DataLab Web open-source project team
        <br />
        Copyright © 2026 DataLab Platform Developers
      </p>
      <p className="help-about-license">
        Released under the BSD 3-Clause License.
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
          <h3>{group.group}</h3>
          <table>
            <tbody>
              {group.entries.map((s) => (
                <tr key={s.keys + s.action}>
                  <td>
                    <kbd>{s.keys}</kbd>
                  </td>
                  <td>{s.action}</td>
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
          Level:
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            {LEVEL_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <span className="help-console-count">{entries.length} entries</span>
        <div className="help-console-buttons">
          <button type="button" onClick={handleCopy}>
            Copy
          </button>
          <button type="button" onClick={clearConsoleEntries}>
            Clear
          </button>
        </div>
      </div>
      <div className="help-console-list" ref={listRef}>
        {entries.length === 0 ? (
          <div className="help-console-empty">
            No console output captured yet.
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
