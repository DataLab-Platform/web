/**
 * Top-level UI for the Notebook tab.
 *
 * Layout:
 *
 *   ┌───────────────────────────────────────────────────────┐
 *   │ Tabs row   │ Notebook A │ Notebook B │ Notebook C │ + │
 *   ├───────────────────────────────────────────────────────┤
 *   │ Toolbar (Run / Run-all / Restart / + / Open / Save)   │
 *   ├───────────────────────────────────────────────────────┤
 *   │ Cell 1                                                │
 *   │ Cell 2                                                │
 *   │ …                                                     │
 *   └───────────────────────────────────────────────────────┘
 *
 * Multi-notebook semantics (Phase 3 MVP):
 *   * Each open notebook keeps its own in-memory model (cells, outputs,
 *     execution counts).
 *   * **All notebooks share a single kernel** (Pyodide worker). Variables
 *     defined in one notebook are visible in another. This is intentional
 *     for the MVP — per-notebook kernel isolation can come later.
 *   * Autosave to IndexedDB on every model change (debounced 600 ms).
 *   * Open/Save .ipynb buttons read/write nbformat v4.5.
 */

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
} from "react";
import type { DataLabRuntime } from "../../runtime/runtime";
import { NotebookRuntime } from "../../notebook/NotebookRuntime";
import {
  emptyCodeCell,
  emptyMarkdownCell,
  emptyNotebook,
  type CellModel,
  type CellOutput,
  type NotebookModel,
} from "../../notebook/types";
import { jsonStringToNotebook, notebookToJsonString } from "../../notebook/nbformat";
import { buildQuickstartNotebook } from "../../notebook/templates/quickstart";
import { notebookToMacro } from "../../notebook/notebookToMacro";
import { macroToNotebook } from "../../macros/macroToNotebook";
import {
  getRecent,
  listRecent,
  recordRecent,
  removeRecent,
  type RecentEntry,
} from "../../storage/recentStore";
import { Cell } from "./Cell";

interface NotebookPanelProps {
  runtime: DataLabRuntime;
  theme: "light" | "dark";
  onSetCurrentPanel: (panel: string) => void;
  getSelection: () => string[];
  getCurrentPanel: () => string;
  selectObjects: (ids: string[], panel: string | null) => void;
  onModelChanged: (panel: string | null) => void;
  /**
   * Convert the current notebook to a DataLab macro and open it in
   * the Macro panel. The host wires this to
   * :meth:`MacroPanelHandle.importMacro`.
   */
  onConvertToMacro?: (title: string, code: string) => void;
  /**
   * Notify the host whenever the number of open notebooks changes,
   * so global state (e.g. the "Save HDF5 workspace…" enabled
   * predicate) can react. Fires once on mount with the initial count.
   */
  onCountChanged?: (count: number) => void;
}

/**
 * Imperative handle exposed by :class:`NotebookPanel` so external
 * UI (the application menu bar) can trigger File-menu actions without
 * the panel needing to be visible.
 */
export interface NotebookPanelHandle {
  newNotebook: () => void;
  newFromQuickstart: () => void;
  openFromDisk: () => void;
  saveActiveAsIpynb: () => void;
  renameActive: () => void;
  hasActiveNotebook: () => boolean;
  /** Open *(title, source)* (a DataLab macro) as a fresh notebook. */
  importMacroAsNotebook: (title: string, source: string) => void;
}

const LS_OPEN_NB_IDS = "datalab-web.notebooks.openIds";
const LS_ACTIVE_NB_ID = "datalab-web.notebooks.activeId";
const AUTOSAVE_DELAY_MS = 600;

/**
 * Trigger a browser download for *nb* as ``<safeName>.ipynb``.
 *
 * Inlined here (was previously exported by ``notebookStore``) since
 * the IndexedDB-as-source-of-truth helper module has been retired.
 */
function downloadNotebookAsIpynb(nb: NotebookModel): void {
  const text = notebookToJsonString(nb);
  const blob = new Blob([text], {
    type: "application/x-ipynb+json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = nb.name.replace(/[^-A-Za-z0-9_.() ]+/g, "_") || "notebook";
  a.download = `${safe}.ipynb`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const NotebookPanel = forwardRef<
  NotebookPanelHandle,
  NotebookPanelProps
>(function NotebookPanel(
  {
    runtime,
    theme,
    onSetCurrentPanel,
    getSelection,
    getCurrentPanel,
    selectObjects,
    onModelChanged,
    onConvertToMacro,
    onCountChanged,
  },
  ref,
) {
  // -- Open notebooks (in-memory) --------------------------------------
  const [notebooks, setNotebooks] = useState<NotebookModel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [kernelStatus, setKernelStatus] = useState<
    "idle" | "loading" | "running" | "stopping"
  >("idle");
  const [storedList, setStoredList] = useState<RecentEntry[]>([]);
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [newMenuAnchor, setNewMenuAnchor] = useState<{
    left: number;
    top: number;
  } | null>(null);
  // When non-null, the matching tab title is shown as an inline
  // editable input. We use this instead of ``window.prompt`` because
  // the latter is blocked by some embedded browsers (notably VS Code's
  // Simple Browser webview).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // True once the async restore-from-IndexedDB has settled. We must
  // *not* write the open-tabs / active-id to localStorage before that,
  // otherwise the very first render (with empty ``notebooks``) would
  // clobber the persisted state we are about to read back.
  const [restored, setRestored] = useState(false);

  const notebooksRef = useRef(notebooks);
  notebooksRef.current = notebooks;

  // Notify host when the count changes so it can drive workspace-level
  // gating (e.g. enabling "Save HDF5 workspace…" for notebook-only
  // workspaces).
  useEffect(() => {
    onCountChanged?.(notebooks.length);
  }, [notebooks.length, onCountChanged]);

  // -- One NotebookRuntime instance shared across notebooks ------------
  const ntbRuntimeRef = useRef<NotebookRuntime | null>(null);
  const getNbRuntime = useCallback((): NotebookRuntime => {
    if (!ntbRuntimeRef.current) {
      const r = new NotebookRuntime(runtime);
      r.externalCallbacks = {
        getSelection,
        getCurrentPanel,
        setCurrentPanel: onSetCurrentPanel,
        selectObjects,
        onModelChanged,
        callMethod: async () => {
          throw new Error("call_method bridge not wired in notebook MVP");
        },
      };
      ntbRuntimeRef.current = r;
    }
    return ntbRuntimeRef.current;
  }, [
    runtime,
    getSelection,
    getCurrentPanel,
    onSetCurrentPanel,
    selectObjects,
    onModelChanged,
  ]);

  // Preload kernel + restore last-open notebooks on first mount.
  // Guarded with a ref so React 18 StrictMode (which runs effects twice
  // in dev) doesn't race two async restores against each other and
  // accidentally spawn a fresh empty notebook that wins the setState.
  const initStartedRef = useRef(false);
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    const r = getNbRuntime();
    setKernelStatus("loading");
    r.preload()
      .then(() => setKernelStatus(r.getStatus()))
      .catch((err) => {
        console.error("Notebook kernel preload failed:", err);
        setKernelStatus("idle");
      });

    void (async () => {
      // Workspace notebooks live in the Python ``_NOTEBOOKS`` store
      // (and are serialised to the workspace HDF5). IndexedDB is only
      // a roll-over cache surfaced through the "Recent…" menu.
      const recent = await listRecent("notebook").catch(() => []);
      setStoredList(recent);

      const metas = await runtime.listNotebooks().catch(() => []);
      const restoredNbs: NotebookModel[] = [];
      for (const meta of metas) {
        try {
          const rec = await runtime.getNotebook(meta.id);
          let nb: NotebookModel;
          if (rec.content && rec.content.length > 0) {
            nb = jsonStringToNotebook(rec.content, rec.title);
          } else {
            nb = emptyNotebook(rec.title);
          }
          // Force the Python id so saves round-trip without dupes.
          nb.id = rec.id;
          nb.name = rec.title;
          restoredNbs.push(nb);
        } catch (err) {
          console.error("Failed to load notebook", meta, err);
        }
      }

      const openIdsRaw = localStorage.getItem(LS_OPEN_NB_IDS);
      const activeIdRaw = localStorage.getItem(LS_ACTIVE_NB_ID);
      let wantedOpen: string[];
      try {
        wantedOpen = openIdsRaw ? (JSON.parse(openIdsRaw) as string[]) : [];
      } catch {
        wantedOpen = [];
      }
      // Filter to ids we actually loaded; fall back to "all" if the
      // session record is empty/stale.
      const idSet = new Set(restoredNbs.map((n) => n.id));
      const openIds = wantedOpen.filter((id) => idSet.has(id));
      const ordered =
        openIds.length > 0
          ? openIds
              .map((id) => restoredNbs.find((n) => n.id === id))
              .filter((n): n is NotebookModel => Boolean(n))
          : restoredNbs;

      if (ordered.length === 0) {
        // Empty workspace — open one blank notebook (or the bundled
        // Quickstart on first boot) and persist it eagerly so the
        // workspace HDF5 reflects the open tab.
        const isFirstBoot =
          metas.length === 0 && openIdsRaw === null && recent.length === 0;
        let nb: NotebookModel;
        if (isFirstBoot) {
          try {
            nb = buildQuickstartNotebook();
          } catch (err) {
            console.error("Failed to load quickstart template:", err);
            nb = emptyNotebook();
          }
        } else {
          nb = emptyNotebook();
        }
        try {
          const rec = await runtime.createNotebook(
            nb.name,
            notebookToJsonString(nb),
          );
          nb.id = rec.id;
          await recordRecent("notebook", {
            id: rec.id,
            title: rec.title,
            content: rec.content,
          }).catch(() => undefined);
        } catch (err) {
          console.error("Failed to create initial notebook:", err);
        }
        ordered.push(nb);
      }

      setNotebooks(ordered);
      const wantedActive = ordered.find((n) => n.id === activeIdRaw);
      const initialActive = wantedActive ?? ordered[0];
      setActiveId(initialActive.id);
      setActiveCellId(initialActive.cells[0]?.id ?? null);
      setStoredList(await listRecent("notebook").catch(() => []));
      setRestored(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist open-tabs / active id to localStorage. Skip writes until
  // the async restore has finished; otherwise the empty initial state
  // would clobber the very keys we just read.
  useEffect(() => {
    if (!restored) return;
    localStorage.setItem(
      LS_OPEN_NB_IDS,
      JSON.stringify(notebooks.map((n) => n.id)),
    );
  }, [notebooks, restored]);
  useEffect(() => {
    if (!restored) return;
    if (activeId) localStorage.setItem(LS_ACTIVE_NB_ID, activeId);
  }, [activeId, restored]);

  // -- Active notebook ------------------------------------------------
  const activeNotebook = useMemo(
    () => notebooks.find((n) => n.id === activeId) ?? null,
    [notebooks, activeId],
  );

  // -- Autosave (debounced per notebook) -----------------------------
  // A notebook counts as "touched" once the user typed something or
  // ran a cell. We don't bother re-saving pristine empties.
  const isNotebookTouched = useCallback((nb: NotebookModel): boolean => {
    if (nb.cells.length > 1) return true;
    return nb.cells.some(
      (c) =>
        c.source.trim().length > 0 ||
        c.outputs.length > 0 ||
        c.execCount != null,
    );
  }, []);
  const saveTimers = useRef<Map<string, number>>(new Map());
  const scheduleSave = useCallback(
    (nb: NotebookModel) => {
      if (!isNotebookTouched(nb)) return;
      const prev = saveTimers.current.get(nb.id);
      if (prev) window.clearTimeout(prev);
      const handle = window.setTimeout(() => {
        saveTimers.current.delete(nb.id);
        const json = notebookToJsonString(nb);
        void runtime
          .setNotebookContent(nb.id, json)
          .then(() =>
            recordRecent("notebook", {
              id: nb.id,
              title: nb.name,
              content: json,
            }),
          )
          .then(() => listRecent("notebook"))
          .then(setStoredList)
          .catch((err) => console.error("Notebook autosave failed:", err));
      }, AUTOSAVE_DELAY_MS);
      saveTimers.current.set(nb.id, handle);
    },
    [isNotebookTouched, runtime],
  );

  // -- Mutation helpers ----------------------------------------------
  const updateActiveNotebook = useCallback(
    (patch: (n: NotebookModel) => NotebookModel) => {
      setNotebooks((prev) =>
        prev.map((n) => {
          if (n.id !== activeId) return n;
          const next = patch(n);
          scheduleSave(next);
          return next;
        }),
      );
    },
    [activeId, scheduleSave],
  );

  const updateCell = useCallback(
    (cellId: string, patch: (c: CellModel) => CellModel) => {
      updateActiveNotebook((nb) => ({
        ...nb,
        cells: nb.cells.map((c) => (c.id === cellId ? patch(c) : c)),
      }));
    },
    [updateActiveNotebook],
  );

  const handleCellChange = useCallback(
    (id: string, source: string) => {
      updateCell(id, (c) => ({ ...c, source }));
    },
    [updateCell],
  );

  const handleInsertBelow = useCallback(
    (afterId: string | null) => {
      const cell = emptyCodeCell();
      updateActiveNotebook((nb) => {
        const idx =
          afterId == null
            ? nb.cells.length - 1
            : nb.cells.findIndex((c) => c.id === afterId);
        const cells = nb.cells.slice();
        cells.splice(idx + 1, 0, cell);
        return { ...nb, cells };
      });
      setActiveCellId(cell.id);
    },
    [updateActiveNotebook],
  );

  const handleInsertMarkdownBelow = useCallback(
    (afterId: string | null) => {
      const cell = emptyMarkdownCell();
      updateActiveNotebook((nb) => {
        const idx =
          afterId == null
            ? nb.cells.length - 1
            : nb.cells.findIndex((c) => c.id === afterId);
        const cells = nb.cells.slice();
        cells.splice(idx + 1, 0, cell);
        return { ...nb, cells };
      });
      setActiveCellId(cell.id);
    },
    [updateActiveNotebook],
  );

  const handleDeleteCell = useCallback(
    (id: string) => {
      updateActiveNotebook((nb) => {
        const idx = nb.cells.findIndex((c) => c.id === id);
        if (idx < 0) return nb;
        const cells = nb.cells.slice();
        cells.splice(idx, 1);
        if (cells.length === 0) cells.push(emptyCodeCell());
        return { ...nb, cells };
      });
      setActiveCellId((prev) => {
        if (prev !== id) return prev;
        const nb = notebooksRef.current.find((n) => n.id === activeId);
        if (!nb) return null;
        const idx = nb.cells.findIndex((c) => c.id === id);
        const next = nb.cells[idx + 1] ?? nb.cells[idx - 1] ?? null;
        return next ? next.id : null;
      });
    },
    [updateActiveNotebook, activeId],
  );

  const handleConvert = useCallback(
    (id: string) => {
      updateActiveNotebook((nb) => ({
        ...nb,
        cells: nb.cells.map((c) =>
          c.id === id
            ? {
                ...c,
                type: c.type === "code" ? "markdown" : "code",
                outputs: [],
                execCount: null,
                status: "idle" as const,
              }
            : c,
        ),
      }));
    },
    [updateActiveNotebook],
  );

  // --------------------------------------------------------------------
  // Cell execution
  // --------------------------------------------------------------------

  const runCell = useCallback(
    async (id: string) => {
      const nb = notebooksRef.current.find((n) => n.id === activeId);
      const cell = nb?.cells.find((c) => c.id === id);
      if (!cell || cell.type !== "code") return;
      const r = getNbRuntime();
      updateCell(id, (c) => ({
        ...c,
        outputs: [],
        status: "queued",
        execCount: null,
      }));
      const appendOutput = (out: CellOutput) =>
        updateCell(id, (c) => ({ ...c, outputs: [...c.outputs, out] }));
      try {
        await r.executeCell(id, cell.source, {
          onStarted: (execCount) => {
            setKernelStatus("running");
            updateCell(id, (c) => ({ ...c, status: "running", execCount }));
          },
          onStream: (kind, text) => {
            appendOutput({ type: "stream", kind, text });
          },
          onDisplayData: (mime) => {
            appendOutput({ type: "display_data", data: mime });
          },
          onExecuteResult: (mime, execCount) => {
            appendOutput({ type: "execute_result", data: mime, execCount });
          },
          onError: (ename, evalue, traceback) => {
            appendOutput({ type: "error", ename, evalue, traceback });
          },
          onFinished: (status, execCount) => {
            updateCell(id, (c) => ({
              ...c,
              status: status === "ok" ? "ok" : "error",
              execCount: execCount || c.execCount,
            }));
            setKernelStatus(r.getStatus());
          },
        });
      } catch (err) {
        console.error("Cell execution failed:", err);
        appendOutput({
          type: "error",
          ename: "RuntimeError",
          evalue: err instanceof Error ? err.message : String(err),
          traceback: "",
        });
        updateCell(id, (c) => ({ ...c, status: "error" }));
      }
    },
    [activeId, getNbRuntime, updateCell],
  );

  const runAll = useCallback(async () => {
    const nb = notebooksRef.current.find((n) => n.id === activeId);
    if (!nb) return;
    const ids = nb.cells.filter((c) => c.type === "code").map((c) => c.id);
    for (const id of ids) {
      await runCell(id);
    }
  }, [activeId, runCell]);

  const restartKernel = useCallback(async () => {
    const ok = window.confirm(
      "Restart the notebook kernel?\n\nThe user namespace (variables defined " +
        "in previous cells) will be lost. Workspace objects in the Signals " +
        "and Images panels are unaffected.",
    );
    if (!ok) return;
    const r = getNbRuntime();
    await r.restart();
    setNotebooks((prev) =>
      prev.map((n) => ({
        ...n,
        cells: n.cells.map((c) => ({
          ...c,
          execCount: null,
          status: "idle",
        })),
      })),
    );
    setKernelStatus(r.getStatus());
  }, [getNbRuntime]);

  // --------------------------------------------------------------------
  // Notebook tabs (open / new / close / rename) + open from disk / store
  // --------------------------------------------------------------------

  const activateNotebook = useCallback((id: string) => {
    setActiveId(id);
    const nb = notebooksRef.current.find((n) => n.id === id);
    setActiveCellId(nb?.cells[0]?.id ?? null);
  }, []);

  const openOrFocusNotebook = useCallback(
    (nb: NotebookModel) => {
      setNotebooks((prev) => {
        if (prev.some((n) => n.id === nb.id)) return prev;
        return [...prev, nb];
      });
      activateNotebook(nb.id);
    },
    [activateNotebook],
  );

  /**
   * Persist *nb* into the Python ``_NOTEBOOKS`` store and the
   * IndexedDB recent cache, then open it. The returned id matches the
   * Python record (same id is used as ``NotebookModel.id`` so saves
   * round-trip cleanly). Falls back to opening a transient model on
   * persistence failure so the UI remains usable.
   */
  const persistAndOpen = useCallback(
    async (nb: NotebookModel): Promise<void> => {
      const json = notebookToJsonString(nb);
      try {
        const rec = await runtime.createNotebook(nb.name, json);
        nb.id = rec.id;
        nb.name = rec.title;
        await recordRecent("notebook", {
          id: rec.id,
          title: rec.title,
          content: json,
        }).catch(() => undefined);
        setStoredList(await listRecent("notebook").catch(() => []));
      } catch (err) {
        console.error("Failed to persist new notebook:", err);
      }
      openOrFocusNotebook(nb);
    },
    [runtime, openOrFocusNotebook],
  );

  const handleNew = useCallback(() => {
    void persistAndOpen(emptyNotebook());
  }, [persistAndOpen]);

  const handleNewFromQuickstart = useCallback(() => {
    void persistAndOpen(buildQuickstartNotebook());
  }, [persistAndOpen]);

  const importMacroAsNotebook = useCallback(
    (title: string, source: string) => {
      void persistAndOpen(macroToNotebook(title, source));
    },
    [persistAndOpen],
  );

  const handleConvertToMacro = useCallback(() => {
    if (!activeNotebook || !onConvertToMacro) return;
    const { title, body } = notebookToMacro(activeNotebook);
    onConvertToMacro(title, body);
  }, [activeNotebook, onConvertToMacro]);

  /**
   * Close a notebook tab in the panel **without** deleting the
   * notebook from the workspace. The notebook stays in the Python
   * store and is still listed in the cross-workspace recent cache,
   * so the user can re-open it from "Recent…". When the last tab is
   * closed, a fresh blank notebook is spawned to keep the panel
   * non-empty. A confirmation dialog matches the macro close-tab
   * semantics.
   */
  const handleCloseTab = useCallback(
    (id: string) => {
      const nb = notebooksRef.current.find((n) => n.id === id);
      const label = nb?.name ?? "this notebook";
      if (
        !window.confirm(
          `Close notebook "${label}"? It will stay in the workspace and the recent cache.`,
        )
      ) {
        return;
      }
      setNotebooks((prev) => {
        const next = prev.filter((n) => n.id !== id);
        if (next.length === 0) {
          // Always keep at least one notebook open. Spawn a transient
          // empty model and persist it via the runtime so its id is
          // stable across save/reload cycles.
          const blank = emptyNotebook();
          void persistAndOpen(blank);
          return [blank];
        }
        return next;
      });
      if (activeId === id) {
        setActiveId(() => {
          const list = notebooksRef.current.filter((n) => n.id !== id);
          return list[0]?.id ?? null;
        });
      }
    },
    [activeId, persistAndOpen],
  );

  const handleRenameActive = useCallback(() => {
    if (!activeNotebook) return;
    setRenameDraft(activeNotebook.name);
    setRenamingId(activeNotebook.id);
  }, [activeNotebook]);

  const commitRename = useCallback(() => {
    const id = renamingId;
    if (id == null) return;
    const trimmed = renameDraft.trim();
    setRenamingId(null);
    if (trimmed === "") return;
    setNotebooks((prev) =>
      prev.map((n) => {
        if (n.id !== id || n.name === trimmed) return n;
        const next = { ...n, name: trimmed };
        // Push the title to Python (workspace HDF5 stores the title)
        // and refresh the recent cache entry so it surfaces the new
        // name in the "Recent…" menu.
        runtime.renameNotebook(id, trimmed).catch((err) => {
          console.error("Failed to rename notebook:", err);
        });
        recordRecent("notebook", {
          id,
          title: trimmed,
          content: notebookToJsonString(next),
        })
          .then(() => listRecent("notebook"))
          .then(setStoredList)
          .catch(() => undefined);
        scheduleSave(next);
        return next;
      }),
    );
  }, [renamingId, renameDraft, runtime, scheduleSave]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
  }, []);

  // -- File: Save as .ipynb ------------------------------------------
  const handleSaveAs = useCallback(() => {
    if (!activeNotebook) return;
    downloadNotebookAsIpynb(activeNotebook);
  }, [activeNotebook]);

  // -- File: Open .ipynb (file picker) -------------------------------
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleOpenFromDisk = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const handleFilePicked = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const files = input.files;
      if (!files || files.length === 0) {
        input.value = "";
        return;
      }
      const file = files[0];
      let text: string;
      try {
        text = await file.text();
      } catch (err) {
        console.error("Failed to read .ipynb file:", err);
        window.alert(
          `Failed to read ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
        input.value = "";
        return;
      }
      try {
        const nameNoExt = file.name.replace(/\.ipynb$/i, "") || "Untitled";
        const nb = jsonStringToNotebook(text, nameNoExt);
        await persistAndOpen(nb);
      } catch (err) {
        console.error("Failed to parse .ipynb file:", err);
        window.alert(
          `Failed to open ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        // Always reset so the user can pick the same file again later.
        input.value = "";
      }
    },
    [persistAndOpen],
  );

  // -- Open menu (browser-stored) ------------------------------------
  // Close the menu when the user clicks anywhere outside of it.
  const openMenuRef = useRef<HTMLDivElement | null>(null);
  const newMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (openMenuFor == null) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const inOpen =
        openMenuRef.current && openMenuRef.current.contains(target);
      const inNew = newMenuRef.current && newMenuRef.current.contains(target);
      if (!inOpen && !inNew) {
        setOpenMenuFor(null);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openMenuFor]);

  const handleOpenStored = useCallback(
    async (id: string) => {
      // Already open as a workspace tab — just focus it.
      const existing = notebooksRef.current.find((n) => n.id === id);
      if (existing) {
        activateNotebook(id);
        setOpenMenuFor(null);
        return;
      }
      // Not in the current workspace — try to fetch from Python first
      // (we may have a stale recent entry after the workspace was
      // wiped). Fall back to the recent cache content.
      let title: string;
      let content: string;
      try {
        const rec = await runtime.getNotebook(id);
        title = rec.title;
        content = rec.content;
      } catch {
        const cached = await getRecent("notebook", id);
        if (!cached) {
          setOpenMenuFor(null);
          return;
        }
        title = cached.title;
        content = cached.content;
        // Re-import into the current workspace.
        try {
          const rec = await runtime.createNotebook(title, content);
          id = rec.id;
        } catch (err) {
          console.error("Failed to import recent notebook into workspace:", err);
        }
      }
      try {
        const nb = content
          ? jsonStringToNotebook(content, title)
          : emptyNotebook(title);
        nb.id = id;
        nb.name = title;
        openOrFocusNotebook(nb);
      } catch (err) {
        console.error("Failed to parse cached notebook:", err);
      }
      setOpenMenuFor(null);
    },
    [activateNotebook, openOrFocusNotebook, runtime],
  );

  const handleDeleteStored = useCallback(
    async (id: string) => {
      const meta = storedList.find((m) => m.id === id);
      if (!meta) return;
      if (!window.confirm(`Remove notebook "${meta.title}" from recent cache?`)) {
        return;
      }
      await removeRecent("notebook", id).catch(() => undefined);
      setStoredList(await listRecent("notebook").catch(() => []));
    },
    [storedList],
  );

  // --------------------------------------------------------------------
  // Imperative handle — used by the application MenuBar to drive the
  // File → Notebook actions even when the notebook panel is hidden.
  // --------------------------------------------------------------------
  useImperativeHandle(
    ref,
    () => ({
      newNotebook: handleNew,
      newFromQuickstart: handleNewFromQuickstart,
      openFromDisk: handleOpenFromDisk,
      saveActiveAsIpynb: handleSaveAs,
      renameActive: handleRenameActive,
      hasActiveNotebook: () => activeNotebook != null,
      importMacroAsNotebook,
    }),
    [
      handleNew,
      handleNewFromQuickstart,
      handleOpenFromDisk,
      handleSaveAs,
      handleRenameActive,
      activeNotebook,
      importMacroAsNotebook,
    ],
  );

  // --------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------

  const kernelLabel = useMemo(() => {
    switch (kernelStatus) {
      case "loading":
        return "● Kernel loading…";
      case "running":
        return "● Kernel running";
      case "stopping":
        return "● Kernel restarting…";
      default:
        return "○ Kernel idle";
    }
  }, [kernelStatus]);

  return (
    <div className="nb-panel">
      <input
        ref={fileInputRef}
        type="file"
        accept=".ipynb,application/json"
        style={{ display: "none" }}
        onChange={handleFilePicked}
      />
      <div className="nb-tabs" role="tablist" aria-label="Open notebooks">
        {notebooks.map((n) => (
          <div
            key={n.id}
            role="tab"
            aria-selected={n.id === activeId}
            className={`nb-tab${n.id === activeId ? " active" : ""}`}
            onClick={() => activateNotebook(n.id)}
            onDoubleClick={() => {
              activateNotebook(n.id);
              setRenameDraft(n.name);
              setRenamingId(n.id);
            }}
            title="Double-click to rename"
          >
            {renamingId === n.id ? (
              <input
                className="nb-tab-rename-input"
                type="text"
                autoFocus
                value={renameDraft}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
                aria-label="Notebook name"
              />
            ) : (
              <span className="nb-tab-title">{n.name}</span>
            )}
            <button
              type="button"
              className="nb-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                handleCloseTab(n.id);
              }}
              aria-label={`Close ${n.name}`}
              title="Close tab"
            >
              ×
            </button>
          </div>
        ))}
        <div className="nb-tab-new-container" ref={newMenuRef}>
          <button
            type="button"
            className="nb-tab-new"
            onClick={(e) => {
              const rect = (
                e.currentTarget as HTMLButtonElement
              ).getBoundingClientRect();
              setNewMenuAnchor({
                left: rect.left,
                top: rect.bottom + 4,
              });
              setOpenMenuFor((prev) => (prev === "new" ? null : "new"));
            }}
            title="New notebook…"
            aria-haspopup="menu"
            aria-expanded={openMenuFor === "new"}
          >
            +
          </button>
          {openMenuFor === "new" && newMenuAnchor && (
            <div
              className="nb-open-menu nb-new-menu"
              role="menu"
              style={{
                position: "fixed",
                left: newMenuAnchor.left,
                top: newMenuAnchor.top,
              }}
            >
              <div className="nb-open-menu-item">
                <button
                  type="button"
                  className="nb-open-menu-name"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenuFor(null);
                    handleNew();
                  }}
                >
                  <span className="nb-open-menu-name-text">Empty notebook</span>
                  <span className="nb-open-menu-name-when">
                    Start from scratch
                  </span>
                </button>
              </div>
              <div className="nb-open-menu-item">
                <button
                  type="button"
                  className="nb-open-menu-name"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenuFor(null);
                    handleNewFromQuickstart();
                  }}
                >
                  <span className="nb-open-menu-name-text">
                    Quickstart template
                  </span>
                  <span className="nb-open-menu-name-when">
                    Demo: signal + moving average
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="nb-toolbar">
        <button
          type="button"
          onClick={() => activeCellId && runCell(activeCellId)}
          disabled={!activeCellId || kernelStatus === "loading"}
          title="Run active cell (Ctrl+Enter)"
        >
          ▶ Run
        </button>
        <button
          type="button"
          onClick={runAll}
          disabled={kernelStatus === "loading" || !activeNotebook}
          title="Run all cells"
        >
          ▶▶ Run All
        </button>
        <button
          type="button"
          onClick={restartKernel}
          disabled={kernelStatus === "loading"}
          title="Restart kernel — loses user namespace"
        >
          ↻ Restart
        </button>
        <span className="nb-toolbar-sep" />
        <button
          type="button"
          onClick={() => handleInsertBelow(activeCellId)}
          disabled={!activeNotebook}
          title="Insert code cell below"
        >
          + Code
        </button>
        <button
          type="button"
          onClick={() => handleInsertMarkdownBelow(activeCellId)}
          disabled={!activeNotebook}
          title="Insert markdown cell below"
        >
          + Markdown
        </button>
        <button
          type="button"
          onClick={() => activeCellId && handleConvert(activeCellId)}
          disabled={!activeCellId}
          title="Convert active cell between code and markdown"
        >
          ↔ Convert
        </button>
        <button
          type="button"
          onClick={() => activeCellId && handleDeleteCell(activeCellId)}
          disabled={!activeCellId}
          title="Delete active cell"
        >
          ✕ Delete
        </button>
        <span className="nb-toolbar-sep" />
        <button
          type="button"
          onClick={handleOpenFromDisk}
          title="Import .ipynb file from disk"
        >
          Import…
        </button>
        <div className="nb-open-menu-container" ref={openMenuRef}>
          <button
            type="button"
            onClick={() =>
              setOpenMenuFor((prev) => (prev === "stored" ? null : "stored"))
            }
            disabled={storedList.length === 0}
            title="Open notebook from recent cache"
          >
            Recent… ({storedList.length})
          </button>
          {openMenuFor === "stored" && (
            <div className="nb-open-menu" role="menu">
              {storedList.length === 0 && (
                <div className="nb-open-menu-empty">
                  No notebooks in recent cache.
                </div>
              )}
              {storedList.map((m) => {
                const openIds = new Set(notebooks.map((n) => n.id));
                const alreadyOpen = openIds.has(m.id);
                const when = new Date(m.lastSeen).toLocaleString();
                return (
                  <div
                    key={m.id}
                    className={`nb-open-menu-item${
                      alreadyOpen ? " nb-open-menu-item-open" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="nb-open-menu-name"
                      onClick={() => handleOpenStored(m.id)}
                      title={
                        alreadyOpen
                          ? `Already open — click to focus tab (last seen ${when})`
                          : `Last seen ${when}`
                      }
                    >
                      <span className="nb-open-menu-name-text">
                        {m.title}
                        {alreadyOpen ? " (open)" : ""}
                      </span>
                      <span className="nb-open-menu-name-when">{when}</span>
                    </button>
                    <button
                      type="button"
                      className="nb-open-menu-delete"
                      onClick={() => handleDeleteStored(m.id)}
                      title="Remove from recent cache"
                      aria-label={`Remove ${m.title} from recent cache`}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleSaveAs}
          disabled={!activeNotebook}
          title="Export current notebook as .ipynb"
        >
          Export…
        </button>
        {onConvertToMacro && (
          <button
            type="button"
            onClick={handleConvertToMacro}
            disabled={!activeNotebook}
            title="Open this notebook as a new DataLab macro"
          >
            Convert to macro
          </button>
        )}
        <span className="nb-toolbar-spacer" />
        <span className="nb-toolbar-status">{kernelLabel}</span>
      </div>
      <div className="nb-cells">
        {activeNotebook ? (
          activeNotebook.cells.map((cell) => (
            <Cell
              key={cell.id}
              cell={cell}
              active={cell.id === activeCellId}
              theme={theme}
              onChange={handleCellChange}
              onRun={runCell}
              onActivate={setActiveCellId}
              onInsertBelow={handleInsertBelow}
              onDelete={handleDeleteCell}
              onConvert={handleConvert}
            />
          ))
        ) : (
          <div className="nb-empty">No notebook open.</div>
        )}
      </div>
    </div>
  );
});
