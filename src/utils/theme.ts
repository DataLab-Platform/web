/* Theme management — light/dark with system default and persistence.
 *
 * The active theme is applied as a `data-theme="light"|"dark"` attribute on
 * `<html>`, which CSS in `styles.css` consumes to switch palettes.
 *
 * Three modes are supported:
 *   - "system": follow `prefers-color-scheme` and react to changes
 *   - "light":  force light palette
 *   - "dark":   force dark palette
 */
import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "datalab-web:theme";

function readStoredMode(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") {
      return raw;
    }
  } catch {
    /* ignore — localStorage may be unavailable */
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function resolve(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/** React hook returning the current theme mode + resolved theme + setter. */
export function useTheme(): {
  mode: ThemeMode;
  theme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [theme, setTheme] = useState<ResolvedTheme>(() =>
    resolve(readStoredMode()),
  );

  // Apply theme to <html> whenever it changes.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Recompute resolved theme when the mode changes.
  useEffect(() => {
    setTheme(resolve(mode));
  }, [mode]);

  // Track system preference changes when in "system" mode.
  useEffect(() => {
    if (mode !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(mql.matches ? "dark" : "light");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setModeState(next);
  }, []);

  // Toggle cycles light ↔ dark (and exits "system" mode on first click).
  const toggle = useCallback(() => {
    const current: ResolvedTheme = resolve(mode);
    setMode(current === "dark" ? "light" : "dark");
  }, [mode, setMode]);

  return { mode, theme, setMode, toggle };
}

/** Apply the persisted (or system-default) theme as early as possible. Call
 *  this once from `main.tsx` *before* React renders, so the first paint
 *  already uses the correct palette and avoids a dark-to-light flash. */
export function initThemeEarly(): void {
  applyTheme(resolve(readStoredMode()));
}
