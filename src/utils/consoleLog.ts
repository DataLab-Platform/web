/**
 * Lightweight in-memory ring buffer capturing every browser ``console.*``
 * call so the Help > Console log dialog can surface them.  Installed once
 * from :file:`main.tsx`.
 *
 * On top of the buffer this module also tracks an *unseen* count of
 * ``warn``/``error`` entries so the menu bar can display a persistent
 * indicator until the user opens the console log dialog.  Mirrors the
 * ``ConsoleStatus`` widget of the DataLab Qt desktop app.
 */

import { useEffect, useSyncExternalStore } from "react";

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleEntry {
  /** Sequential id (monotonic, restarts at 0 each page load). */
  id: number;
  /** Wall-clock timestamp (``new Date()``). */
  time: Date;
  level: ConsoleLevel;
  /** Human-readable message — arguments stringified and space-joined. */
  message: string;
}

const MAX_ENTRIES = 1000;

const buffer: ConsoleEntry[] = [];
const subscribers = new Set<() => void>();
let nextId = 0;
let installed = false;
/** Id of the highest console entry that the user has acknowledged.
 *  Entries with ``id > lastSeenId`` and ``level ∈ {warn, error}`` are
 *  counted as *unseen* by :func:`getUnseenConsoleErrorCount`. */
let lastSeenId = -1;

function stringify(arg: unknown): string {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "string") return arg;
  if (typeof arg === "number" || typeof arg === "boolean") return String(arg);
  if (arg instanceof Error) {
    return arg.stack ? `${arg.message}\n${arg.stack}` : arg.message;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function notify(): void {
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      // ignore subscriber errors
    }
  }
}

function record(level: ConsoleLevel, args: unknown[]): void {
  const entry: ConsoleEntry = {
    id: nextId++,
    time: new Date(),
    level,
    message: args.map(stringify).join(" "),
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
  notify();
}

/** Install the console interceptor (idempotent). */
export function installConsoleCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const levels: ConsoleLevel[] = ["log", "info", "warn", "error", "debug"];
  for (const level of levels) {
    const original = (
      console as unknown as Record<string, (...a: unknown[]) => void>
    )[level];
    if (typeof original !== "function") continue;
    (console as unknown as Record<string, (...a: unknown[]) => void>)[level] = (
      ...args: unknown[]
    ) => {
      record(level, args);
      original.apply(console, args);
    };
  }
  // Catch unhandled errors and promise rejections too.
  window.addEventListener("error", (event) => {
    record("error", [event.message, event.filename, event.lineno]);
  });
  window.addEventListener("unhandledrejection", (event) => {
    record("error", ["Unhandled rejection:", event.reason]);
  });
}

/** Snapshot of currently buffered entries (newest last). */
export function getConsoleEntries(): readonly ConsoleEntry[] {
  return buffer;
}

/** Subscribe to buffer changes; returns the unsubscribe handle. */
export function subscribeConsole(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** Drop every captured entry. */
export function clearConsoleEntries(): void {
  buffer.length = 0;
  notify();
}

/** Count of buffered ``warn``/``error`` entries the user has not yet
 *  acknowledged via :func:`markConsoleErrorsSeen`.  Resilient to ring
 *  trimming because it relies on monotonic ids, not array indices. */
export function getUnseenConsoleErrorCount(): number {
  let n = 0;
  for (const entry of buffer) {
    if (
      entry.id > lastSeenId &&
      (entry.level === "warn" || entry.level === "error")
    ) {
      n++;
    }
  }
  return n;
}

/** Breakdown of unseen ``warn``/``error`` entries — useful for
 *  building a precise tooltip ("N errors, M warnings"). */
export function getUnseenConsoleErrorBreakdown(): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const entry of buffer) {
    if (entry.id <= lastSeenId) continue;
    if (entry.level === "error") errors++;
    else if (entry.level === "warn") warnings++;
  }
  return { errors, warnings };
}

/** Mark every currently buffered entry as seen.  Subsequent ``warn`` /
 *  ``error`` calls will re-increment the unseen counter. */
export function markConsoleErrorsSeen(): void {
  // ``nextId`` is the id that *would* be assigned to the next entry,
  // so the highest id currently in flight is ``nextId - 1``.
  const newSeen = nextId - 1;
  if (newSeen === lastSeenId) return;
  lastSeenId = newSeen;
  notify();
}

/** React hook returning ``{ unseen, errors, warnings, markSeen }`` and
 *  re-rendering whenever the console buffer changes. */
export function useConsoleErrors(): {
  unseen: number;
  errors: number;
  warnings: number;
  markSeen: () => void;
} {
  // ``useSyncExternalStore`` requires a snapshot whose identity changes
  // when the value changes.  We snapshot ``lastSeenId`` + ``nextId``
  // (cheap, monotonic) and recompute the breakdown on render — the
  // buffer is at most ``MAX_ENTRIES`` long, so this stays O(1k).
  const snapshot = useSyncExternalStore(
    (cb) => subscribeConsole(cb),
    () => `${lastSeenId}/${nextId}`,
    () => `${lastSeenId}/${nextId}`,
  );
  // ``snapshot`` is only used to trigger re-renders.
  void snapshot;
  const { errors, warnings } = getUnseenConsoleErrorBreakdown();
  return {
    unseen: errors + warnings,
    errors,
    warnings,
    markSeen: markConsoleErrorsSeen,
  };
}

// ---------------------------------------------------------------------------
// document.title prefix
// ---------------------------------------------------------------------------

const TITLE_PREFIX = "(!) ";

/** Prefix ``document.title`` with ``"(!) "`` while ``unseen > 0`` so the
 *  user notices logged errors even when the tab is in the background.
 *  Removes the prefix when ``unseen`` drops back to 0 or on unmount.
 *  Idempotent: never double-prefixes and never strips a prefix it did
 *  not add. */
export function useConsoleErrorTitlePrefix(): void {
  const { unseen } = useConsoleErrors();
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (unseen > 0) {
      if (!document.title.startsWith(TITLE_PREFIX)) {
        document.title = TITLE_PREFIX + document.title;
      }
    } else if (document.title.startsWith(TITLE_PREFIX)) {
      document.title = document.title.slice(TITLE_PREFIX.length);
    }
    return () => {
      if (typeof document === "undefined") return;
      if (document.title.startsWith(TITLE_PREFIX)) {
        document.title = document.title.slice(TITLE_PREFIX.length);
      }
    };
  }, [unseen]);
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Reset *all* internal state — buffer, ids, seen marker.  Intended for
 *  unit tests; do not call from production code. */
export function __resetConsoleLogForTests(): void {
  buffer.length = 0;
  nextId = 0;
  lastSeenId = -1;
  notify();
}
