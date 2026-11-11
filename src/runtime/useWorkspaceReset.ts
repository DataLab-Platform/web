/**
 * "New workspace" transition: empty every panel and start an untitled,
 * unmodified workspace (used by the showcase mode between two demos).
 *
 * Like opening a workspace (``handleOpenWorkspaceHdf5`` in ``App.tsx``), it
 * drops the selection, mounts the Macro and Notebook panels afresh on the
 * new contents and resets the workspace state (no filename — hence the
 * "Untitled" window title and a new default name for Save —, not
 * modified). Unlike it, the Python workers of these panels are kept warm.
 */

import { useCallback } from "react";
import type { RuntimeApi } from "./runtime";
import { useWorkspace } from "./WorkspaceContext";

export interface WorkspaceResetHandlers {
  /** Drop the selection and every view state tied to workspace objects
   *  (current object, selected groups, opened example…). */
  clearSelection: () => void;
  /** Mount the Macro and Notebook panels afresh, keeping their workers. */
  remountPanels: () => void;
  /** Re-read the object tree of the active panel. */
  refresh: () => Promise<void>;
}

export function useWorkspaceReset(
  runtime: RuntimeApi | null,
  handlers: WorkspaceResetHandlers,
): () => Promise<void> {
  const { markClean, setFilename } = useWorkspace();
  const { clearSelection, remountPanels, refresh } = handlers;
  return useCallback(async () => {
    if (!runtime) return;
    // First, so that no view asks Python for the objects being deleted.
    clearSelection();
    await runtime.resetAll();
    remountPanels();
    setFilename(null);
    // After ``resetAll``, whose workspace mutation marked it modified.
    markClean();
    await refresh();
  }, [runtime, clearSelection, remountPanels, refresh, setFilename, markClean]);
}
