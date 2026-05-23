/**
 * Helpers tracking whether the user has seen the release notes for the
 * currently running version of DataLab-Web.
 *
 * The version string is whatever is injected via
 * ``import.meta.env.VITE_APP_VERSION`` (see :mod:`HelpDialog`); the
 * "last seen" value is persisted in ``localStorage`` so the "NEW" hint
 * on the Welcome page only fires once per upgrade per browser profile.
 */

import { useCallback, useEffect, useState } from "react";

const LAST_SEEN_KEY = "datalab-web.releaseNotes.lastSeenVersion";

/** Storage event name dispatched on the window when the "last seen"
 *  value is updated within the same tab. ``storage`` events from the
 *  Web Storage API only fire across tabs, so we synthesise our own for
 *  intra-tab subscribers (e.g. the Welcome badge). */
const CHANGE_EVENT = "datalab-web:releaseNotes:change";

export function readLastSeenVersion(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

export function markReleaseSeen(version: string): void {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    /* ignore quota / privacy mode errors */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function hasUnseenRelease(currentVersion: string): boolean {
  // A missing or invalid version string should never produce a stuck
  // badge — treat it as "already seen".
  if (!currentVersion || currentVersion === "dev") return false;
  return readLastSeenVersion() !== currentVersion;
}

/** React hook exposing a reactive "is there a new release the user
 *  hasn't acknowledged yet?" flag. Re-evaluates on mount and whenever
 *  another component calls :func:`markReleaseSeen`. */
export function useUnseenRelease(currentVersion: string): boolean {
  const compute = useCallback(
    () => hasUnseenRelease(currentVersion),
    [currentVersion],
  );
  const [unseen, setUnseen] = useState(compute);
  useEffect(() => {
    setUnseen(compute());
    const handler = () => setUnseen(compute());
    window.addEventListener(CHANGE_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, [compute]);
  return unseen;
}
