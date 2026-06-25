import { useCallback, useState } from "react";

/**
 * ``useState`` variant backed by ``localStorage`` for a boolean view
 * preference, so the choice survives reloads and applies across the app.
 *
 * @param key Storage key (namespaced, e.g. ``"datalab-web.image-grid"``).
 * @param defaultValue Value used when nothing is stored yet (or storage is
 *  unavailable).
 */
export function usePersistedBool(
  key: string,
  defaultValue: boolean,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return raw === "true";
    } catch {
      return defaultValue;
    }
  });
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        /* ignore quota / disabled storage */
      }
    },
    [key],
  );
  return [value, update];
}

/** Storage key for the "show grid over images" toggle, shared by the
 *  single-image viewer and the multi-image spatial overlay. */
export const IMAGE_GRID_PREF_KEY = "datalab-web.image-grid";
