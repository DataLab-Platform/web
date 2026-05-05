/**
 * Macro panel — top-level UI for editing & running macros.
 *
 * Layout mirrors DataLab Qt's :class:`MacroPanel`:
 *   ┌──────────────────────────────────────┐
 *   │ Toolbar (Run/Stop/New/...)           │
 *   │ ┌──────────────────────────────────┐ │
 *   │ │ Editor tabs (CodeMirror)         │ │
 *   │ ├──────────────────────────────────┤ │
 *   │ │ Output console                   │ │
 *   │ └──────────────────────────────────┘ │
 *   └──────────────────────────────────────┘
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  MacroMeta,
  MacroRecord,
  DataLabRuntime,
} from "../runtime/runtime";
import { MacroRuntime } from "../runtime/MacroRuntime";
import { MacroEditorTabs, type MacroTab } from "./MacroEditorTabs";
import { MacroConsole, type MacroConsoleHandle } from "./MacroConsole";
import { Splitter } from "./Splitter";
import simpleTemplate from "../macros/templates/simple_macro.py?raw";
import imageprocTemplate from "../macros/templates/imageproc_macro.py?raw";
import callMethodTemplate from "../macros/templates/call_method_macro.py?raw";
import {
  listRecent,
  recordRecent,
  removeRecent,
} from "../storage/recentStore";

const FILE_HEADER_LINES = [
  "# -*- coding: utf-8 -*-",
  "",
  '"""',
  'DataLab Macro: "%TITLE%"',
  "-------------",
  "",
  "This file is a DataLab macro. It can be executed from DataLab's Macro Panel.",
  '"""',
  "",
  "",
];

function makeFileHeader(title: string): string {
  return FILE_HEADER_LINES.join("\n").replace("%TITLE%", title);
}

function parseImportedMacro(
  filename: string,
  text: string,
): { title: string; code: string } {
  const lines = text.split(/\r?\n/);
  let title = filename.replace(/\.py$/i, "");
  for (const line of lines) {
    const m = line.match(/^DataLab Macro:\s*"(.*)"\s*$/);
    if (m) {
      title = m[1];
      break;
    }
  }
  const header = makeFileHeader(title).trimEnd();
  let code = text.trimStart();
  if (code.startsWith(header)) {
    code = code.slice(header.length).trimStart();
  }
  return { title, code };
}

const TEMPLATES: Array<{ label: string; code: string }> = [
  { label: "Simple example", code: simpleTemplate },
  { label: "Image processing", code: imageprocTemplate },
  { label: "Call methods", code: callMethodTemplate },
];

const LS_LAST_ACTIVE = "datalab-web.macros.activeId";
const LS_OPEN_TABS = "datalab-web.macros.openTabIds";
const LS_EDITOR_HEIGHT = "datalab-web.macros.editorHeight";

interface Props {
  runtime: DataLabRuntime;
  /** Called by ``proxy.set_current_panel`` so the host can switch tabs. */
  onSetCurrentPanel: (panel: string) => void;
  getSelection: () => string[];
  getCurrentPanel: () => string;
  selectObjects: (ids: string[], panel: string | null) => void;
  /** Called whenever a macro mutates the model (so trees can refresh). */
  onModelChanged: (panel: string | null) => void;
  /**
   * Convert the current macro to a notebook and open it in the
   * Notebook panel. The host wires this to
   * :meth:`NotebookPanelHandle.importMacroAsNotebook`.
   */
  onConvertToNotebook?: (title: string, code: string) => void;
  /**
   * Notify the host whenever the number of loaded macros changes,
   * so workspace-level gating (e.g. "Save HDF5 workspace…") can
   * react. Fires once on mount with the initial count.
   */
  onCountChanged?: (count: number) => void;
  /** "light"|"dark" — pulled from the host theme. */
  theme: "light" | "dark";
}

interface MacroState extends MacroMeta {
  /** Loaded code (``null`` ⇒ not yet fetched). */
  code: string | null;
  /** Last code persisted to the Python store — used to flag dirtiness. */
  saved: string;
}

/**
 * Imperative handle exposed by :class:`MacroPanel` so external UI
 * (notebook → macro conversion, future menu actions) can inject a
 * ready-made macro into the panel without having to be visible.
 */
export interface MacroPanelHandle {
  /** Persist a fresh macro and open it as the active tab. */
  importMacro: (title: string, code: string) => Promise<string>;
}

export const MacroPanel = forwardRef<MacroPanelHandle, Props>(
  function MacroPanel(
    {
      runtime,
      onSetCurrentPanel,
      getSelection,
      getCurrentPanel,
      selectObjects,
      onModelChanged,
      onConvertToNotebook,
      onCountChanged,
      theme,
    }: Props,
    ref,
  ) {
    const [macros, setMacros] = useState<MacroState[]>([]);
    const [openIds, setOpenIds] = useState<string[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState<string>("");

    // Notify the host when the macro count changes so workspace-level
    // gating (e.g. "Save HDF5 workspace…") can react.
    useEffect(() => {
      onCountChanged?.(macros.length);
    }, [macros.length, onCountChanged]);
    /** ``true`` once the initial load effect has hydrated state from
     *  Python + localStorage.  Used to gate persistence effects so they
     *  don't overwrite saved state with the empty initial values during
     *  the first render. */
    const [loaded, setLoaded] = useState(false);
    const consoleRef = useRef<MacroConsoleHandle>(null);
    const macroRtRef = useRef<MacroRuntime | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const newMenuRef = useRef<HTMLDivElement>(null);
    const [newMenuOpen, setNewMenuOpen] = useState(false);
    const [editorHeight, setEditorHeight] = useState<number>(() => {
      try {
        const raw = window.localStorage.getItem(LS_EDITOR_HEIGHT);
        const v = raw ? parseFloat(raw) : NaN;
        return Number.isFinite(v) && v > 100 ? v : 380;
      } catch {
        return 380;
      }
    });

    // ---------------------------------------------------------------------
    // MacroRuntime lifecycle
    // ---------------------------------------------------------------------

    useEffect(() => {
      const rt = new MacroRuntime(runtime);
      rt.externalCallbacks = {
        getSelection,
        getCurrentPanel,
        setCurrentPanel: (panel) => onSetCurrentPanel(panel),
        selectObjects,
        onModelChanged,
      };
      macroRtRef.current = rt;
      void rt.preload();
      return () => {
        rt.dispose();
        macroRtRef.current = null;
      };
    }, [
      runtime,
      onSetCurrentPanel,
      getSelection,
      getCurrentPanel,
      selectObjects,
      onModelChanged,
    ]);

    // ---------------------------------------------------------------------
    // Initial load: ask Python for macros; if empty try localStorage mirror;
    // if still empty, create a default sample macro.
    // ---------------------------------------------------------------------

    useEffect(() => {
      let cancelled = false;
      (async () => {
        let metas = await runtime.listMacros();
        if (metas.length === 0) {
          // Workspace has no macros yet — try to recover anything from
          // the unified IndexedDB recent cache (macros that survived a
          // workspace switch). The cache only feeds the fallback; once
          // the user is in a workspace, Python is the source of truth.
          try {
            const recent = await listRecent("macro");
            if (recent.length > 0) {
              const records: MacroRecord[] = recent.map((e) => ({
                id: e.id,
                title: e.title,
                code: e.content,
              }));
              await runtime.replaceMacros(records);
              metas = await runtime.listMacros();
            }
          } catch {
            /* ignore cache errors */
          }
        }
        if (metas.length === 0) {
          await runtime.createMacro();
          metas = await runtime.listMacros();
        }
        if (cancelled) return;
        // Hydrate code lazily — fetch all up front so dirty/save logic works.
        const full = await Promise.all(
          metas.map((m) => runtime.getMacro(m.id)),
        );
        if (cancelled) return;
        setMacros(
          full.map((m) => ({
            id: m.id,
            title: m.title,
            code: m.code,
            saved: m.code,
          })),
        );
        // Restore previously open tabs / active id.
        const savedActive = window.localStorage.getItem(LS_LAST_ACTIVE);
        const savedOpen = window.localStorage.getItem(LS_OPEN_TABS);
        const ids = full.map((m) => m.id);
        let open: string[];
        try {
          const parsed = savedOpen ? (JSON.parse(savedOpen) as string[]) : [];
          open = parsed.filter((id) => ids.includes(id));
        } catch {
          open = [];
        }
        // localStorage stores titles as a fallback; if no overlap, open the
        // first macro by default.
        if (open.length === 0 && ids.length > 0) open = [ids[0]];
        setOpenIds(open);
        const active =
          savedActive && open.includes(savedActive)
            ? savedActive
            : (open[0] ?? null);
        setActiveId(active);
        setLoaded(true);
      })();
      return () => {
        cancelled = true;
      };
    }, [runtime]);

    // ---------------------------------------------------------------------
    // Persistence helpers
    // ---------------------------------------------------------------------

    const persistMirror = useCallback((next: MacroState[]) => {
      // Push every macro into the unified IndexedDB recent cache so
      // they survive workspace switches and can be re-opened from a
      // future "Open recent…" UI. Fire-and-forget: cache failures
      // never block the UI.
      for (const m of next) {
        void recordRecent("macro", {
          id: m.id,
          title: m.title,
          content: m.code ?? m.saved,
        }).catch(() => undefined);
      }
    }, []);

    useEffect(() => {
      if (!loaded) return;
      if (activeId) window.localStorage.setItem(LS_LAST_ACTIVE, activeId);
    }, [activeId, loaded]);
    useEffect(() => {
      if (!loaded) return;
      window.localStorage.setItem(LS_OPEN_TABS, JSON.stringify(openIds));
    }, [openIds, loaded]);
    useEffect(() => {
      try {
        window.localStorage.setItem(LS_EDITOR_HEIGHT, String(editorHeight));
      } catch {
        /* ignore */
      }
    }, [editorHeight]);

    // ---------------------------------------------------------------------
    // Editor change handler — debounced auto-save to Python + mirror.
    // ---------------------------------------------------------------------

    const saveTimers = useRef<Map<string, number>>(new Map());

    const handleCodeChange = useCallback(
      (id: string, code: string) => {
        setMacros((prev) => {
          const next = prev.map((m) => (m.id === id ? { ...m, code } : m));
          persistMirror(next);
          return next;
        });
        const existing = saveTimers.current.get(id);
        if (existing) window.clearTimeout(existing);
        const handle = window.setTimeout(() => {
          runtime.setMacroCode(id, code).catch((err) => {
            console.error("Failed to save macro:", err);
          });
          setMacros((prev) =>
            prev.map((m) => (m.id === id ? { ...m, saved: code } : m)),
          );
          saveTimers.current.delete(id);
        }, 500);
        saveTimers.current.set(id, handle);
      },
      [runtime, persistMirror],
    );

    // ---------------------------------------------------------------------
    // Tab management
    // ---------------------------------------------------------------------

    const openMacro = useCallback((id: string) => {
      setOpenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setActiveId(id);
    }, []);

    const closeTab = useCallback((id: string) => {
      setOpenIds((prev) => {
        const idx = prev.indexOf(id);
        if (idx < 0) return prev;
        const next = prev.filter((x) => x !== id);
        // Pick a neighbour as new active if we closed the active one.
        setActiveId((cur) => {
          if (cur !== id) return cur;
          const fallback = next[idx] ?? next[idx - 1] ?? next[0] ?? null;
          return fallback;
        });
        return next;
      });
    }, []);

    // ---------------------------------------------------------------------
    // Toolbar actions
    // ---------------------------------------------------------------------

    const handleNew = useCallback(
      async (templateCode?: string) => {
        const rec = await runtime.createMacro(
          undefined,
          templateCode ?? undefined,
        );
        const code = rec.code ?? "";
        setMacros((prev) => {
          const next = [
            ...prev,
            { id: rec.id, title: rec.title, code, saved: code },
          ];
          persistMirror(next);
          return next;
        });
        openMacro(rec.id);
        setNewMenuOpen(false);
      },
      [runtime, openMacro, persistMirror],
    );

    const handleRename = useCallback(
      (id: string) => {
        const m = macros.find((x) => x.id === id);
        if (!m) return;
        // Make sure the tab is visible & active before entering rename mode.
        setOpenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setActiveId(id);
        setRenameDraft(m.title);
        setRenamingId(id);
      },
      [macros],
    );

    const commitRename = useCallback(() => {
      const id = renamingId;
      if (id == null) return;
      const trimmed = renameDraft.trim() || "Untitled";
      setRenamingId(null);
      const current = macros.find((x) => x.id === id);
      if (!current || current.title === trimmed) return;
      runtime.renameMacro(id, trimmed).catch((err) => {
        console.error("Failed to rename macro:", err);
      });
      setMacros((prev) => {
        const updated = prev.map((x) =>
          x.id === id ? { ...x, title: trimmed } : x,
        );
        persistMirror(updated);
        return updated;
      });
    }, [renamingId, renameDraft, macros, runtime, persistMirror]);

    const cancelRename = useCallback(() => {
      setRenamingId(null);
    }, []);

    const handleDuplicate = useCallback(async () => {
      if (!activeId) return;
      const rec = await runtime.duplicateMacro(activeId);
      const code = rec.code ?? "";
      setMacros((prev) => {
        const next = [
          ...prev,
          { id: rec.id, title: rec.title, code, saved: code },
        ];
        persistMirror(next);
        return next;
      });
      openMacro(rec.id);
    }, [activeId, runtime, openMacro, persistMirror]);

    const handleDelete = useCallback(async () => {
      if (!activeId) return;
      const m = macros.find((x) => x.id === activeId);
      if (!m) return;
      if (!window.confirm(`Delete macro "${m.title}"?`)) return;
      await runtime.deleteMacro(activeId);
      await removeRecent("macro", activeId).catch(() => undefined);
      setMacros((prev) => {
        const next = prev.filter((x) => x.id !== activeId);
        persistMirror(next);
        return next;
      });
      closeTab(activeId);
    }, [activeId, macros, runtime, persistMirror, closeTab]);

    const handleImport = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    const handleFileSelected = useCallback(
      async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        const text = await file.text();
        const { title, code } = parseImportedMacro(file.name, text);
        const rec = await runtime.createMacro(title, code);
        setMacros((prev) => {
          const next = [
            ...prev,
            { id: rec.id, title: rec.title, code, saved: code },
          ];
          persistMirror(next);
          return next;
        });
        openMacro(rec.id);
        // Reset the input so re-importing the same file works.
        event.target.value = "";
      },
      [runtime, openMacro, persistMirror],
    );

    const handleExport = useCallback(() => {
      if (!activeId) return;
      const m = macros.find((x) => x.id === activeId);
      if (!m) return;
      const text = makeFileHeader(m.title) + (m.code ?? "");
      const blob = new Blob([text], { type: "text/x-python;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = m.title.replace(/[^-A-Za-z0-9_.() ]+/g, "_");
      a.download = `${safe}.py`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, [activeId, macros]);

    const handleRun = useCallback(async () => {
      const rt = macroRtRef.current;
      if (!rt || !activeId) return;
      const m = macros.find((x) => x.id === activeId);
      if (!m) return;
      setRunning(true);
      // Flush any pending debounced save before running.
      const pending = saveTimers.current.get(activeId);
      if (pending) {
        window.clearTimeout(pending);
        saveTimers.current.delete(activeId);
        await runtime.setMacroCode(activeId, m.code ?? "");
      }
      try {
        await rt.run(m.code ?? "", m.title, {
          onStream: (kind, text) => consoleRef.current?.append(kind, text),
          onFinished: () => setRunning(false),
        });
      } catch (err) {
        consoleRef.current?.append(
          "stderr",
          (err instanceof Error ? err.message : String(err)) + "\n",
        );
        setRunning(false);
      }
    }, [activeId, macros, runtime]);

    const handleStop = useCallback(() => {
      macroRtRef.current?.stop();
      setRunning(false);
    }, []);

    const handleConvertToNotebook = useCallback(() => {
      if (!activeId || !onConvertToNotebook) return;
      const m = macros.find((x) => x.id === activeId);
      if (!m) return;
      onConvertToNotebook(m.title, m.code ?? "");
    }, [activeId, macros, onConvertToNotebook]);

    // ---------------------------------------------------------------------
    // Imperative handle (notebook → macro conversion, etc.)
    // ---------------------------------------------------------------------

    const importMacro = useCallback(
      async (title: string, code: string): Promise<string> => {
        const rec = await runtime.createMacro(title, code);
        const safe = rec.code ?? "";
        setMacros((prev) => {
          const next = [
            ...prev,
            { id: rec.id, title: rec.title, code: safe, saved: safe },
          ];
          persistMirror(next);
          return next;
        });
        openMacro(rec.id);
        return rec.id;
      },
      [runtime, openMacro, persistMirror],
    );

    useImperativeHandle(ref, () => ({ importMacro }), [importMacro]);

    // Close New ▾ menu on outside click.
    useEffect(() => {
      if (!newMenuOpen) return;
      const onDoc = (e: MouseEvent) => {
        if (!newMenuRef.current?.contains(e.target as Node))
          setNewMenuOpen(false);
      };
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }, [newMenuOpen]);

    // ---------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------

    const tabs: MacroTab[] = useMemo(
      () =>
        openIds
          .map((id) => macros.find((m) => m.id === id))
          .filter((m): m is MacroState => Boolean(m))
          .map((m) => ({
            id: m.id,
            title: m.title,
            code: m.code ?? "",
            dirty: (m.code ?? "") !== m.saved,
          })),
      [openIds, macros],
    );

    // Macros not currently shown as tabs, so the user can re-open them.
    const closedMacros = useMemo(
      () => macros.filter((m) => !openIds.includes(m.id)),
      [macros, openIds],
    );

    return (
      <div className="macro-panel">
        <div className="macro-toolbar">
          <button
            type="button"
            className="macro-btn primary"
            onClick={handleRun}
            disabled={running || !activeId}
            title="Run current macro (Ctrl+Enter)"
          >
            ▶ Run
          </button>
          <button
            type="button"
            className="macro-btn"
            onClick={handleStop}
            disabled={!running}
            title="Stop current macro"
          >
            ■ Stop
          </button>
          <span className="macro-toolbar-sep" />
          <div className="macro-new-wrapper" ref={newMenuRef}>
            <button
              type="button"
              className="macro-btn"
              onClick={() => setNewMenuOpen((o) => !o)}
              title="New macro"
            >
              New ▾
            </button>
            {newMenuOpen && (
              <ul className="macro-new-menu" role="menu">
                <li role="menuitem" onClick={() => handleNew()}>
                  Blank macro
                </li>
                {TEMPLATES.map((t) => (
                  <li
                    key={t.label}
                    role="menuitem"
                    onClick={() => handleNew(t.code)}
                  >
                    From template: {t.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="macro-btn"
            onClick={() => activeId && handleRename(activeId)}
            disabled={!activeId}
          >
            Rename
          </button>
          <button
            type="button"
            className="macro-btn"
            onClick={handleDuplicate}
            disabled={!activeId}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="macro-btn"
            onClick={handleDelete}
            disabled={!activeId}
          >
            Delete
          </button>
          <span className="macro-toolbar-sep" />
          <button type="button" className="macro-btn" onClick={handleImport}>
            Import…
          </button>
          <button
            type="button"
            className="macro-btn"
            onClick={handleExport}
            disabled={!activeId}
          >
            Export…
          </button>
          {onConvertToNotebook && (
            <button
              type="button"
              className="macro-btn"
              onClick={handleConvertToNotebook}
              disabled={!activeId}
              title="Open this macro as a new notebook (cells split on # %% markers)"
            >
              Convert to notebook
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".py,text/x-python,text/plain"
            style={{ display: "none" }}
            onChange={handleFileSelected}
          />
          {closedMacros.length > 0 && (
            <>
              <span className="macro-toolbar-sep" />
              <select
                className="macro-reopen"
                value=""
                onChange={(e) => {
                  if (e.target.value) openMacro(e.target.value);
                }}
              >
                <option value="">Open closed macro…</option>
                {closedMacros.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <div className="macro-body">
          <div className="macro-editor-wrap" style={{ height: editorHeight }}>
            <MacroEditorTabs
              tabs={tabs}
              activeId={activeId}
              onChange={handleCodeChange}
              onActivate={setActiveId}
              onClose={closeTab}
              onRenameRequest={handleRename}
              renamingId={renamingId}
              renameDraft={renameDraft}
              onRenameDraftChange={setRenameDraft}
              onCommitRename={commitRename}
              onCancelRename={cancelRename}
              theme={theme}
            />
          </div>
          <Splitter
            side="bottom"
            value={editorHeight}
            min={150}
            max={800}
            onChange={setEditorHeight}
            ariaLabel="Resize macro editor"
          />
          <div className="macro-console-wrap">
            <MacroConsole ref={consoleRef} />
          </div>
        </div>
      </div>
    );
  },
);
