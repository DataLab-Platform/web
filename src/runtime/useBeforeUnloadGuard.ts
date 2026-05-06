/**
 * Register a ``beforeunload`` listener that prompts the browser to
 * confirm tab close / reload **only when** *active* is true.
 *
 * Used by DataLab-Web to protect users from losing in-memory workspace
 * state (signals, images, macros, notebooks) that has not been saved to
 * an HDF5 workspace file yet. The listener does **not** fire when
 * ``active`` is false — clean workspaces close silently, matching
 * standard editor / IDE conventions.
 */

import { useEffect } from "react";

export function useBeforeUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      // Calling preventDefault() and assigning returnValue are both
      // required for cross-browser support of the native "unsaved
      // changes" prompt. The actual message is browser-controlled
      // (Chrome, Firefox, Safari ignore custom strings since 2016+).
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}
