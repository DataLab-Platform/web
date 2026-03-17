/**
 * Lightweight in-memory ring buffer capturing every browser ``console.*``
 * call so the Help > Console log dialog can surface them.  Installed once
 * from :file:`main.tsx`.
 */

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
    const original = (console as unknown as Record<string, (...a: unknown[]) => void>)[
      level
    ];
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
