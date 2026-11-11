/**
 * Showcase mode — the only part kept in the main bundle.
 *
 * The showcase plays automated, live demos of DataLab Web (e.g. on a
 * conference booth screen, from a plain browser in kiosk mode). Its player,
 * dialog, overlays, scenarios, URL options and French captions live in a
 * lazily loaded chunk (``./player``); this stub only holds what the
 * application needs before that chunk is loaded:
 *
 *   * whether the URL requests the showcase (``?showcase=…``);
 *   * the "showcase active" flag, used by the application to hide the
 *     Welcome page and to disable the unsaved-changes guard while demos play;
 *   * :func:`useShowcaseLauncher`, which loads the chunk and starts the
 *     showcase from the URL once the runtime is ready, or on demand
 *     (Help > Showcase mode…).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { ActionDescriptor, ActionState } from "../actions/types";
import type { PluginRecord, RuntimeApi } from "../runtime/runtime";
import type { ShowcaseOptions } from "./options";

/** True when *search* (``location.search``) requests the showcase; the
 *  showcase chunk parses the other parameters. */
export function isShowcaseRequested(search: string): boolean {
  const value = new URLSearchParams(search).get("showcase");
  return (
    value !== null &&
    !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase())
  );
}

/** Showcase requested by the page URL (kiosk use), checked once. */
export const URL_SHOWCASE_REQUESTED =
  typeof window !== "undefined" && isShowcaseRequested(window.location.search);

// -- "Showcase active" flag (external store) ---------------------------------

let active = false;
const listeners = new Set<() => void>();

export function isShowcaseActive(): boolean {
  return active;
}

export function setShowcaseActive(value: boolean): void {
  if (active === value) return;
  active = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React binding of the "showcase active" flag. */
export function useShowcaseActive(): boolean {
  return useSyncExternalStore(subscribe, isShowcaseActive, () => false);
}

/** No Quickstart notebook template while demos play (same trick as the
 *  end-to-end tests: the panel only loads it when no tab list is stored). */
export function suppressQuickstartTemplate(): void {
  try {
    const key = "datalab-web.notebooks.openIds";
    if (window.localStorage.getItem(key) === null) {
      window.localStorage.setItem(key, "[]");
    }
  } catch {
    // localStorage unavailable: the template may show, which is harmless.
  }
}

if (URL_SHOWCASE_REQUESTED) {
  // Before the first render: no Welcome page or Quickstart notebook flash
  // while Pyodide boots.
  setShowcaseActive(true);
  suppressQuickstartTemplate();
}

// -- Launcher -------------------------------------------------------------------

/** What the showcase needs from the application. */
export interface ShowcaseHost {
  readonly runtime: RuntimeApi;
  /** Current action registry (menus, toolbar, command palette). */
  getActions(): ActionDescriptor[];
  /** Current action state (enables/disables actions). */
  getActionState(): ActionState;
  /** Plugins known to the application (application scenarios). */
  getPluginRecords(): PluginRecord[];
  /** Empty the workspace as a new, untitled and unmodified one (objects,
   *  macros, notebooks, selection), keeping the Python workers warm. */
  resetWorkspace(): Promise<void>;
}

export interface ShowcaseLauncherDeps {
  runtime: RuntimeApi | null;
  ready: boolean;
  actions: ActionDescriptor[];
  actionState: ActionState;
  pluginRecords: PluginRecord[];
  resetWorkspace: () => Promise<void>;
}

/** Load the showcase chunk (player, overlays, scenarios). */
export function loadShowcase() {
  return import("./player");
}

export interface ShowcaseLauncher {
  /** Start the showcase (ignored until the runtime is ready). */
  start(options: ShowcaseOptions): void;
  /** Host for the Showcase mode dialog, ``null`` until the runtime is
   *  ready. */
  getHost(): ShowcaseHost | null;
}

/**
 * Start the showcase requested by the URL once the runtime is ready (with a
 * boot card while Pyodide loads), and return the launcher used by the
 * Help menu. The host handed to the player always reads the latest
 * application state.
 */
export function useShowcaseLauncher(
  deps: ShowcaseLauncherDeps,
): ShowcaseLauncher {
  const latest = useRef(deps);
  useEffect(() => {
    latest.current = deps;
  });
  const getHost = useCallback((): ShowcaseHost | null => {
    const runtime = latest.current.runtime;
    if (!runtime) return null;
    return {
      runtime,
      getActions: () => latest.current.actions,
      getActionState: () => latest.current.actionState,
      getPluginRecords: () => latest.current.pluginRecords,
      resetWorkspace: () => latest.current.resetWorkspace(),
    };
  }, []);

  useEffect(() => {
    if (URL_SHOWCASE_REQUESTED) {
      void loadShowcase().then((showcase) => showcase.showUrlBootCard());
    }
  }, []);

  const urlStarted = useRef(false);
  const { ready, runtime } = deps;
  useEffect(() => {
    if (!URL_SHOWCASE_REQUESTED || urlStarted.current || !ready || !runtime) {
      return;
    }
    const host = getHost();
    if (!host) return;
    urlStarted.current = true;
    void loadShowcase().then((showcase) => showcase.startUrlShowcase(host));
  }, [ready, runtime, getHost]);

  const start = useCallback(
    (options: ShowcaseOptions) => {
      const host = getHost();
      if (!host) return;
      void loadShowcase().then((showcase) =>
        showcase.startShowcase(host, options),
      );
    },
    [getHost],
  );
  return useMemo(() => ({ start, getHost }), [start, getHost]);
}
