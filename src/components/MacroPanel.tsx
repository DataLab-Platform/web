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
import type { MacroMeta, RuntimeApi } from "../runtime/runtime";
import { MacroRuntime } from "../runtime/MacroRuntime";
import {
  MacroEditorTabs,
  type MacroTab,
  type MacroNewMenuEntry,
} from "./MacroEditorTabs";
import { MacroConsole, type MacroConsoleHandle } from "./MacroConsole";
import { Splitter } from "./Splitter";
import { useConfirm } from "./ConfirmDialog";
import { t } from "../i18n/translate";
import simpleTemplate from "../macros/templates/simple_macro.py?raw";
import imageprocTemplate from "../macros/templates/imageproc_macro.py?raw";
import callMethodTemplate from "../macros/templates/call_method_macro.py?raw";
import {
  clearRecent,
  getRecent,
  listRecent,
  recordRecent,
  removeRecent,
  type RecentEntry,
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

const TEMPLATES: Array<{ label: string; description: string; code: string }> = [
  {
    label: "Simple example",
    description: "Minimal print + sip math example",
    code: simpleTemplate,
  },
  {
    label: "Image processing",
    description: "Read/write images, basic filters",
    code: imageprocTemplate,
  },
  {
    label: "Call methods",
    description: "Drive DataLab through proxy.call_method()",
    code: callMethodTemplate,
  },
];

const LS_LAST_ACTIVE = "datalab-web.macros.activeId";
const LS_OPEN_TABS = "datalab-web.macros.openTabIds";
const LS_EDITOR_HEIGHT = "datalab-web.macros.editorHeight";

interface Props {
  runtime: RuntimeApi;
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
  /** Current placement of this panel (``"tab"`` ⇒ central tab,
   *  ``"floating"`` ⇒ right-side overlay).  Optional; when omitted
   *  the placement toggle button is hidden. */
  placement?: "tab" | "floating";
  /** Toggle the placement.  When omitted, no toggle button is
   *  rendered. */
  onTogglePlacement?: () => void;
}

interface MacroState extends MacroMeta {
  /** Loaded code (``null`` ⇒ not yet fetched). */
  code: string | null;
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
      placement,
      onTogglePlacement,
    }: Props,
    ref,
  ) {
    const confirm = useConfirm();
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
    /** Cross-workspace recent-macro cache (mirrors notebook "Recent…"). */
    const [recentList, setRecentList] = useState<RecentEntry[]>([]);
    const [recentMenuOpen, setRecentMenuOpen] = useState(false);
    const recentMenuRef = useRef<HTMLDivElement>(null);
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

    // Keep the latest host callbacks in a ref so the MacroRuntime lifecycle
    // effect below only depends on ``runtime``. Otherwise every render of
    // ``App`` (e.g. after a macro mutates the model via ``onModelChanged``
    // → ``refresh()`` → state update) would dispose the warm worker and
    // spawn a fresh one — making the *next* macro run wait several seconds
    // for Pyodide + Sigima to install again in the new worker.
    const callbacksRef = useRef({
      getSelection,
      getCurrentPanel,
      onSetCurrentPanel,
      selectObjects,
      onModelChanged,
    });
    callbacksRef.current = {
      getSelection,
      getCurrentPanel,
      onSetCurrentPanel,
      selectObjects,
      onModelChanged,
    };

    useEffect(() => {
      const rt = new MacroRuntime(runtime);
      rt.externalCallbacks = {
        getSelection: () => callbacksRef.current.getSelection(),
        getCurrentPanel: () => callbacksRef.current.getCurrentPanel(),
        setCurrentPanel: (panel) =>
          callbacksRef.current.onSetCurrentPanel(panel),
        selectObjects: (ids, panel) =>
          callbacksRef.current.selectObjects(ids, panel),
        onModelChanged: (panel) => callbacksRef.current.onModelChanged(panel),
      };
      macroRtRef.current = rt;
      void rt.preload();
      return () => {
        rt.dispose();
        macroRtRef.current = null;
      };
    }, [runtime]);

    // ---------------------------------------------------------------------
    // Initial load: ask Python for macros; if empty try localStorage mirror;
    // if still empty, create a default sample macro.
    // ---------------------------------------------------------------------

    useEffect(() => {
      let cancelled = false;
      (async () => {
        // Initial hydration must not flag the workspace as dirty
        // (seeding a default macro is not a user edit): the mutating
        // call below is issued with ``{ silent: true }``.
        //
        // Macros are NOT silently bulk-restored from the IndexedDB
        // recent cache anymore (symmetry with notebooks): the cache is
        // a roll-over of the documents the user actually *edited*,
        // surfaced only through the "Recent…" menu. The workspace HDF5
        // is the single durable source of truth.
        let metas = await runtime.listMacros();
        if (metas.length === 0) {
          await runtime.createMacro(undefined, undefined, { silent: true });
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
          })),
        );
        // Hydration never seeds the recent cache: only documents the
        // user actually edits (see ``touchedIdsRef`` / ``persistMirror``)
        // are cached and surfaced through the "Recent…" menu.
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

    // Ids of macros the user has actually touched this session (edited,
    // renamed, imported, duplicated, opened from Recent… or created by
    // the AI assistant). Only these are mirrored into the IndexedDB
    // recent cache, so pristine auto-created sample macros never
    // pollute it (option C).
    const touchedIdsRef = useRef<Set<string>>(new Set());

    const persistMirror = useCallback((next: MacroState[]) => {
      // Mirror only *touched* macros into the unified IndexedDB recent
      // cache so they survive workspace switches and can be re-opened
      // from the "Recent…" menu. Fire-and-forget: cache failures never
      // block the UI.
      for (const m of next) {
        if (!touchedIdsRef.current.has(m.id)) continue;
        void recordRecent("macro", {
          id: m.id,
          title: m.title,
          content: m.code ?? "",
        }).catch(() => undefined);
      }
    }, []);

    // ---------------------------------------------------------------------
    // External macro events: re-load when something outside the panel
    // (currently the AI Assistant's ``create_and_run_macro`` tool)
    // creates a macro behind our back. We refresh the full list rather
    // than blindly appending to keep title/code in sync if Python
    // mutated existing entries too.
    // ---------------------------------------------------------------------
    useEffect(() => {
      if (!loaded) return;
      const handler = async (event: Event) => {
        try {
          const metas = await runtime.listMacros();
          const full = await Promise.all(
            metas.map((m) => runtime.getMacro(m.id)),
          );
          setMacros(
            full.map((m) => ({ id: m.id, title: m.title, code: m.code })),
          );
          // Open and focus the freshly created macro if the event
          // carries an id; otherwise leave the active tab alone.
          const detail = (event as CustomEvent).detail as
            | { id?: string }
            | undefined;
          const newId = detail?.id;
          if (newId && full.some((m) => m.id === newId)) {
            // Macros created behind our back (AI assistant) carry real
            // content — surface them through the "Recent…" menu too.
            touchedIdsRef.current.add(newId);
            const created = full.find((m) => m.id === newId);
            if (created) {
              void recordRecent("macro", {
                id: created.id,
                title: created.title,
                content: created.code,
              }).catch(() => undefined);
            }
            setOpenIds((prev) =>
              prev.includes(newId) ? prev : [...prev, newId],
            );
            setActiveId(newId);
          }
        } catch (err) {
          console.error("Failed to refresh macros after external change:", err);
        }
      };
      window.addEventListener("dlw:macros-changed", handler);
      return () => window.removeEventListener("dlw:macros-changed", handler);
    }, [loaded, runtime]);

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
        touchedIdsRef.current.add(id);
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

    /**
     * Close a macro tab in the panel **without** deleting the macro
     * from the workspace. The macro stays in the Python store and is
     * still listed in the cross-workspace recent cache, so the user
     * can re-open it from "Recent…". A confirmation dialog matches
     * the notebook close-tab semantics.
     */
    const closeTab = useCallback(
      async (id: string) => {
        const macro = macros.find((m) => m.id === id);
        const label = macro?.title ?? t("this macro");
        if (
          !(await confirm({
            title: t("Close macro"),
            message: t(
              'Close macro "{label}"? It will stay in the workspace and the recent cache.',
              { label },
            ),
            confirmLabel: t("Close"),
          }))
        ) {
          return;
        }
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
      },
      [macros, confirm],
    );

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
          const next = [...prev, { id: rec.id, title: rec.title, code }];
          persistMirror(next);
          return next;
        });
        openMacro(rec.id);
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
      const trimmed = renameDraft.trim() || t("Untitled");
      setRenamingId(null);
      const current = macros.find((x) => x.id === id);
      if (!current || current.title === trimmed) return;
      touchedIdsRef.current.add(id);
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
      touchedIdsRef.current.add(rec.id);
      setMacros((prev) => {
        const next = [...prev, { id: rec.id, title: rec.title, code }];
        persistMirror(next);
        return next;
      });
      openMacro(rec.id);
    }, [activeId, runtime, openMacro, persistMirror]);

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
        touchedIdsRef.current.add(rec.id);
        setMacros((prev) => {
          const next = [...prev, { id: rec.id, title: rec.title, code }];
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

    /**
     * Flush any pending debounced save for *macroId* so subsequent
     * Python-side operations (run, lint, ...) see the user's latest edits.
     */
    const flushPendingSave = useCallback(
      async (macroId: string, code: string) => {
        const pending = saveTimers.current.get(macroId);
        if (pending) {
          window.clearTimeout(pending);
          saveTimers.current.delete(macroId);
          await runtime.setMacroCode(macroId, code);
        }
      },
      [runtime],
    );

    /**
     * Lint *code* and surface any issues through the console.
     *
     * Returns ``true`` when the macro is safe to run. ``announceSuccess``
     * controls whether a "✓ Validation passed" line is emitted when there
     * are no issues — true for the Validate button, false for the
     * pre-Run check (which would be noise on every Run).
     */
    const lintAndReport = useCallback(
      async (code: string, announceSuccess: boolean): Promise<boolean> => {
        const cons = consoleRef.current;
        try {
          const res = await runtime.lintMacro(code);
          if (res.syntax_error) {
            const e = res.syntax_error;
            cons?.append(
              "stderr",
              t("✗ Syntax error at line {line}, col {col}: {message}", {
                line: e.line,
                col: e.col + 1,
                message: e.message,
              }) + "\n",
            );
            return false;
          }
          for (const u of res.unknown_methods) {
            cons?.append(
              "stderr",
              t('✗ Unknown proxy method "{name}" at line {line}, col {col}', {
                name: u.name,
                line: u.line,
                col: u.col + 1,
              }) + "\n",
            );
          }
          for (const m2 of res.missing_await) {
            cons?.append(
              "stderr",
              t(
                '✗ Missing "await" before proxy.{name}(...) at line {line}, col {col}',
                {
                  name: m2.name,
                  line: m2.line,
                  col: m2.col + 1,
                },
              ) + "\n",
            );
          }
          if (res.ok && announceSuccess) {
            const n = res.proxy_calls.length;
            cons?.append(
              "stdout",
              (n === 1
                ? t("✓ Validation passed (1 proxy call)")
                : t("✓ Validation passed ({count} proxy calls)", {
                    count: n,
                  })) + "\n",
            );
          }
          return res.ok;
        } catch (err) {
          cons?.append(
            "stderr",
            t("✗ Validation failed: {error}", {
              error: err instanceof Error ? err.message : String(err),
            }) + "\n",
          );
          return false;
        }
      },
      [runtime],
    );

    const handleRun = useCallback(async () => {
      const rt = macroRtRef.current;
      if (!rt || !activeId) return;
      const m = macros.find((x) => x.id === activeId);
      if (!m) return;
      const code = m.code ?? "";
      await flushPendingSave(activeId, code);
      // Pre-Run lint: abort silently-on-success, loudly-on-failure so
      // the user gets actionable feedback instead of a confusing Python
      // traceback (or — worse — a half-applied workspace mutation).
      const ok = await lintAndReport(code, false);
      if (!ok) {
        consoleRef.current?.append(
          "stderr",
          t(
            "✗ Macro not started: fix the issues above (or press ✓ Validate to re-check).",
          ) + "\n",
        );
        return;
      }
      setRunning(true);
      try {
        await rt.run(code, m.title, {
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
    }, [activeId, macros, flushPendingSave, lintAndReport]);

    const handleStop = useCallback(() => {
      macroRtRef.current?.stop();
      setRunning(false);
    }, []);

    const handleValidate = useCallback(async () => {
      if (!activeId) return;
      const m = macros.find((x) => x.id === activeId);
      if (!m) return;
      const code = m.code ?? "";
      await flushPendingSave(activeId, code);
      await lintAndReport(code, true);
    }, [activeId, macros, flushPendingSave, lintAndReport]);

    const handleConvertToNotebook = useCallback(() => {
      if (!activeId || !onConvertToNotebook) return;
      const m = macros.find((x) => x.id === activeId);
      if (!m) return;
      onConvertToNotebook(m.title, m.code ?? "");
    }, [activeId, macros, onConvertToNotebook]);

    // ---------------------------------------------------------------------
    // Recent… dropdown (cross-workspace cache, mirrors NotebookPanel).
    // ---------------------------------------------------------------------

    /**
     * Open a macro from the cross-workspace recent cache.
     *
     * If the entry is already loaded in the current workspace, just
     * focus its tab. Otherwise re-import the cached source code into
     * Python via :meth:`runtime.createMacro` and open the new tab.
     */
    const handleOpenRecent = useCallback(
      async (id: string) => {
        setRecentMenuOpen(false);
        const existing = macros.find((m) => m.id === id);
        if (existing) {
          openMacro(id);
          return;
        }
        const cached = await getRecent("macro", id).catch(() => null);
        if (!cached) return;
        const rec = await runtime.createMacro(cached.title, cached.content);
        const code = rec.code ?? cached.content;
        touchedIdsRef.current.add(rec.id);
        setMacros((prev) => {
          const next = [...prev, { id: rec.id, title: rec.title, code }];
          persistMirror(next);
          return next;
        });
        openMacro(rec.id);
      },
      [macros, openMacro, persistMirror, runtime],
    );

    const handleDeleteRecent = useCallback(
      async (id: string) => {
        const meta = recentList.find((m) => m.id === id);
        if (!meta) return;
        if (
          !(await confirm({
            title: t("Remove from recent"),
            message: t('Remove macro "{title}" from recent cache?', {
              title: meta.title,
            }),
            confirmLabel: t("Remove"),
            destructive: true,
          }))
        ) {
          return;
        }
        await removeRecent("macro", id).catch(() => undefined);
        setRecentList(await listRecent("macro").catch(() => []));
      },
      [recentList, confirm],
    );

    const handleClearRecent = useCallback(async () => {
      if (recentList.length === 0) return;
      if (
        !(await confirm({
          title: t("Clear recent cache"),
          message: t("Remove all {count} macros from the recent cache?", {
            count: recentList.length,
          }),
          confirmLabel: t("Remove all"),
          destructive: true,
        }))
      ) {
        return;
      }
      await clearRecent("macro").catch(() => undefined);
      setRecentList(await listRecent("macro").catch(() => []));
      setRecentMenuOpen(false);
    }, [recentList, confirm]);

    // ---------------------------------------------------------------------
    // Imperative handle (notebook → macro conversion, etc.)
    // ---------------------------------------------------------------------

    const importMacro = useCallback(
      async (title: string, code: string): Promise<string> => {
        const rec = await runtime.createMacro(title, code);
        const safe = rec.code ?? "";
        touchedIdsRef.current.add(rec.id);
        setMacros((prev) => {
          const next = [...prev, { id: rec.id, title: rec.title, code: safe }];
          persistMirror(next);
          return next;
        });
        openMacro(rec.id);
        return rec.id;
      },
      [runtime, openMacro, persistMirror],
    );

    useImperativeHandle(ref, () => ({ importMacro }), [importMacro]);

    // Close Recent… menu on outside click.
    useEffect(() => {
      if (!recentMenuOpen) return;
      const onDoc = (e: MouseEvent) => {
        if (!recentMenuRef.current?.contains(e.target as Node))
          setRecentMenuOpen(false);
      };
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }, [recentMenuOpen]);

    // Refresh the cross-workspace recent cache list whenever macros change.
    useEffect(() => {
      let cancelled = false;
      listRecent("macro")
        .then((entries) => {
          if (!cancelled) setRecentList(entries);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [macros]);

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
          })),
      [openIds, macros],
    );

    const newMenuEntries: MacroNewMenuEntry[] = useMemo(
      () => [
        { label: t("Blank macro"), description: t("Start from scratch") },
        ...TEMPLATES.map((tpl) => ({
          label: t("From template: {label}", { label: t(tpl.label) }),
          description: t(tpl.description),
          templateCode: tpl.code,
        })),
      ],
      [],
    );

    const openIdsSet = useMemo(() => new Set(openIds), [openIds]);
    const runStatusLabel = running ? t("● Macro running") : t("○ Idle");

    return (
      <div className="macro-panel">
        <div className="macro-toolbar">
          <button
            type="button"
            className="macro-btn primary"
            onClick={handleRun}
            disabled={running || !activeId}
            title={t("Run current macro (Ctrl+Enter)")}
          >
            ▶ {t("Run")}
          </button>
          <button
            type="button"
            className="macro-btn"
            onClick={handleStop}
            disabled={!running}
            title={t("Stop current macro")}
          >
            ■ {t("Stop")}
          </button>
          <button
            type="button"
            className="macro-btn"
            onClick={handleValidate}
            disabled={!activeId}
            title={t(
              "Statically lint current macro (syntax, proxy API, missing await)",
            )}
          >
            ✓ {t("Validate")}
          </button>
          <span className="macro-toolbar-sep" />
          <button
            type="button"
            className="macro-btn"
            onClick={handleDuplicate}
            disabled={!activeId}
            title={t("Duplicate current macro")}
          >
            ⧉ {t("Duplicate")}
          </button>
          <span className="macro-toolbar-sep" />
          <button
            type="button"
            className="macro-btn"
            onClick={handleImport}
            title={t("Import .py file from disk")}
          >
            {t("Import…")}
          </button>
          <div className="macro-recent-wrapper" ref={recentMenuRef}>
            <button
              type="button"
              className="macro-btn"
              onClick={() => setRecentMenuOpen((o) => !o)}
              disabled={recentList.length === 0}
              title={t("Open macro from recent cache")}
            >
              {t("Recent… ({count})", { count: recentList.length })}
            </button>
            {recentMenuOpen && (
              <div className="macro-recent-menu" role="menu">
                {recentList.length === 0 && (
                  <div className="macro-recent-menu-empty">
                    {t("No macros in recent cache.")}
                  </div>
                )}
                {recentList.map((m) => {
                  const alreadyOpen = openIdsSet.has(m.id);
                  const when = new Date(m.lastSeen).toLocaleString();
                  return (
                    <div
                      key={m.id}
                      className={`macro-recent-menu-item${
                        alreadyOpen ? " macro-recent-menu-item-open" : ""
                      }`}
                    >
                      <button
                        type="button"
                        className="macro-recent-menu-name"
                        onClick={() => handleOpenRecent(m.id)}
                        title={
                          alreadyOpen
                            ? t(
                                "Already open — click to focus tab (last seen {when})",
                                { when },
                              )
                            : t("Last seen {when}", { when })
                        }
                      >
                        <span className="macro-recent-menu-name-text">
                          {m.title}
                          {alreadyOpen ? t(" (open)") : ""}
                        </span>
                        <span className="macro-recent-menu-name-when">
                          {when}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="macro-recent-menu-delete"
                        onClick={() => handleDeleteRecent(m.id)}
                        title={t("Remove from recent cache")}
                        aria-label={t("Remove {title} from recent cache", {
                          title: m.title,
                        })}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                {recentList.length > 0 && (
                  <button
                    type="button"
                    className="macro-recent-menu-clear"
                    onClick={handleClearRecent}
                  >
                    {t("Clear all")}
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            className="macro-btn"
            onClick={handleExport}
            disabled={!activeId}
            title={t("Export current macro as .py")}
          >
            {t("Export…")}
          </button>
          {onConvertToNotebook && (
            <button
              type="button"
              className="macro-btn"
              onClick={handleConvertToNotebook}
              disabled={!activeId}
              title={t(
                "Open this macro as a new notebook (cells split on # %% markers)",
              )}
            >
              {t("Convert to notebook")}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".py,text/x-python,text/plain"
            style={{ display: "none" }}
            onChange={handleFileSelected}
          />
          <span className="macro-toolbar-spacer" />
          <span className="macro-toolbar-status">{runStatusLabel}</span>
          {onTogglePlacement && (
            <button
              type="button"
              className="macro-btn panel-placement-toggle"
              onClick={onTogglePlacement}
              title={
                placement === "floating"
                  ? t("Dock this panel as a central tab")
                  : t("Detach this panel as a floating overlay")
              }
              aria-label={
                placement === "floating" ? t("Dock Macros") : t("Detach Macros")
              }
            >
              {placement === "floating" ? t("↙ Dock") : t("↗ Detach")}
            </button>
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
              onNew={handleNew}
              newMenuEntries={newMenuEntries}
              theme={theme}
            />
          </div>
          <Splitter
            side="top"
            value={editorHeight}
            min={150}
            max={800}
            onChange={setEditorHeight}
            ariaLabel={t("Resize macro editor")}
          />
          <div className="macro-console-wrap">
            <MacroConsole ref={consoleRef} />
          </div>
        </div>
      </div>
    );
  },
);
