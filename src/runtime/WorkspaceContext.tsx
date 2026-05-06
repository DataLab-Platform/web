/**
 * WorkspaceContext — global "is the in-memory workspace dirty wrt the
 * last HDF5 save/open?" state, plus the associated filename when known.
 *
 * Design contract (see ``/memories/session/plan.md``):
 *
 * - HDF5 is the single source of durable truth. IndexedDB caches
 *   (Recent…) are convenience-only.
 * - ``dirty=true`` means: "the user has produced changes that would
 *   be lost on reload unless saved as an HDF5 workspace".
 * - ``filename`` is the most recent name used by Open / Save HDF5
 *   (``null`` while the session is "Untitled").
 * - ``recovered=true`` is a transient flag set after restoring content
 *   from the IndexedDB cache (Recent menu or recovery banner). It
 *   stays on until the next ``markClean()`` (i.e. the user saves).
 *
 * Dirty granularity is **global**, intentionally. Per-form / per-cell
 * dirty indicators (SidePanel, MetadataEditor, MacroEditor) keep
 * their own finer-grained state — this context layers a workspace
 * level signal on top of them.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface WorkspaceState {
  /** True iff there are HDF5-relevant changes since the last save/open. */
  dirty: boolean;
  /** Last filename used with Open/Save HDF5 workspace. */
  filename: string | null;
  /** True once the session content has been restored from a cache
   *  (Recent…/recovery banner) and not yet saved to a fresh HDF5. */
  recovered: boolean;
}

export interface WorkspaceContextValue extends WorkspaceState {
  markDirty: () => void;
  markClean: () => void;
  setFilename: (name: string | null) => void;
  setRecovered: (recovered: boolean) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState>({
    dirty: false,
    filename: null,
    recovered: false,
  });

  const markDirty = useCallback(() => {
    setState((prev) => (prev.dirty ? prev : { ...prev, dirty: true }));
  }, []);

  const markClean = useCallback(() => {
    setState((prev) =>
      !prev.dirty && !prev.recovered
        ? prev
        : { ...prev, dirty: false, recovered: false },
    );
  }, []);

  const setFilename = useCallback((name: string | null) => {
    setState((prev) =>
      prev.filename === name ? prev : { ...prev, filename: name },
    );
  }, []);

  const setRecovered = useCallback((recovered: boolean) => {
    setState((prev) =>
      prev.recovered === recovered ? prev : { ...prev, recovered },
    );
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      ...state,
      markDirty,
      markClean,
      setFilename,
      setRecovered,
    }),
    [state, markDirty, markClean, setFilename, setRecovered],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}

/** Optional accessor — returns ``null`` outside a provider, useful for
 *  components that may be rendered in tests without one. */
export function useWorkspaceOptional(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}
