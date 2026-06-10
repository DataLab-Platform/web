/**
 * MemoryUsageIndicator — small persistent button in the menu bar that
 * shows the live runtime memory footprint and turns orange/red as it
 * approaches out-of-memory territory.
 *
 * DataLab-Web runs Sigima inside Pyodide, whose WASM linear heap grows
 * as large image arrays are allocated and never shrinks back to the OS.
 * A long session that creates and drops many large images can therefore
 * exhaust the browser tab's memory ("out of memory" crash). This
 * indicator surfaces the footprint so the user can act before the crash.
 *
 * Clicking it opens a small dropdown menu gathering the memory-related
 * actions that would otherwise be scattered across the File and Help
 * menus: a "Store data on disk" toggle (spill heavy arrays to OPFS) and
 * a "Free memory" action (garbage-collection pass to reclaim dropped
 * Python references).
 *
 * The component self-polls via {@link useMemoryPoll}; only this small
 * widget re-renders on each sample, never the whole app.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeApi } from "../runtime/runtime";
import {
  formatBytes,
  memoryLevel,
  type MemoryLevel,
  type MemoryUsage,
} from "../utils/memory";
import { t } from "../i18n/translate";

/** Default sampling period (ms) for the memory indicator. */
export const MEMORY_POLL_INTERVAL_MS = 2000;

/**
 * Sample the runtime memory footprint on a timer.
 *
 * Returns ``null`` until the runtime is ready. Each tick reads the WASM
 * heap and JS-heap figures synchronously (``HEAPU8.length``, no Python
 * round-trip) and updates them immediately, then asynchronously fetches
 * the "data loaded" figure (a cheap O(n) sum routed through the Python
 * queue). An in-flight guard prevents the async fetches from stacking up
 * behind a long computation. Exported for unit testing with a fake
 * runtime and fake timers.
 *
 * @param runtime Live runtime, or ``null`` before boot.
 * @param intervalMs Sampling period; defaults to
 *  {@link MEMORY_POLL_INTERVAL_MS}.
 */
export function useMemoryPoll(
  runtime: RuntimeApi | null,
  intervalMs: number = MEMORY_POLL_INTERVAL_MS,
): { usage: MemoryUsage | null; refresh: () => void } {
  const [usage, setUsage] = useState<MemoryUsage | null>(null);
  const inFlight = useRef(false);
  const sample = useCallback(() => {
    if (!runtime) {
      setUsage(null);
      return;
    }
    // Synchronous part: heap figures, updated immediately.
    const base = runtime.getMemoryUsage();
    setUsage((prev) => ({
      ...base,
      // Keep the previous data figure until the async fetch resolves, so
      // the headline does not flicker to "—" between samples.
      dataBytes: prev?.dataBytes ?? base.dataBytes,
    }));
    // Asynchronous part: "data loaded" figure, skipped while one is
    // already pending so polls cannot pile up during a computation.
    if (inFlight.current || typeof runtime.getDataMemoryBytes !== "function") {
      return;
    }
    inFlight.current = true;
    void Promise.resolve(runtime.getDataMemoryBytes())
      .then((dataBytes) => {
        setUsage((prev) => (prev ? { ...prev, dataBytes } : prev));
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [runtime]);
  useEffect(() => {
    if (!runtime) {
      setUsage(null);
      return;
    }
    sample();
    const id = window.setInterval(sample, intervalMs);
    return () => window.clearInterval(id);
  }, [runtime, intervalMs, sample]);
  return { usage, refresh: sample };
}

interface Props {
  /** Live runtime, or ``null`` before boot. */
  runtime: RuntimeApi | null;
  /** Invoked when the user picks "Free memory" to reclaim memory.
   *  Typically wired to ``runtime.freeMemory()`` plus a notification.
   *  The indicator re-samples once the returned promise settles. */
  onRequestFreeMemory?: () => void | Promise<void>;
  /** Current value of the "store data on disk" preference (drives the
   *  checkmark on the menu item). */
  storeOnDisk?: boolean;
  /** True while a storage-mode switch is in progress (disables the
   *  toggle item to prevent re-entrancy). */
  storageBusy?: boolean;
  /** Whether the on-disk storage mode is available in this browser /
   *  context (OPFS + secure context). When false the item is disabled. */
  diskStorageSupported?: boolean;
  /** Toggle on-disk storage mode (spill arrays to OPFS ⇄ keep in RAM).
   *  When omitted the toggle item is hidden. */
  onToggleStoreOnDisk?: () => void | Promise<void>;
  /** Sampling period (ms); overridable for tests. */
  intervalMs?: number;
}

const LEVEL_CLASS: Record<MemoryLevel, string> = {
  ok: "",
  warn: " warn",
  critical: " critical",
};

export function MemoryUsageIndicator({
  runtime,
  onRequestFreeMemory,
  storeOnDisk = false,
  storageBusy = false,
  diskStorageSupported = false,
  onToggleStoreOnDisk,
  intervalMs,
}: Props) {
  const { usage, refresh } = useMemoryPoll(runtime, intervalMs);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const mounted = useRef(true);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Close the dropdown on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  if (!usage || usage.wasmBytes === null) {
    // Nothing to show before the runtime exposes its heap.
    return null;
  }

  const level = memoryLevel(usage);
  // Headline = data the user controls (responds to deletes). Falls back
  // to the reserved heap before the data figure is available.
  const headlineBytes = usage.dataBytes ?? usage.wasmBytes;
  const label = formatBytes(headlineBytes);
  const reservedLine =
    usage.dataBytes !== null
      ? "\n" +
        t("Memory reserved by the engine: {wasm}", {
          wasm: formatBytes(usage.wasmBytes),
        }) +
        "\n" +
        t("Reserved memory is returned to the browser only when you reload")
      : "";
  const jsLine =
    usage.jsUsedBytes !== null
      ? "\n" +
        t("Browser interface: {used}", { used: formatBytes(usage.jsUsedBytes) })
      : "";
  const tooltip =
    t("Data loaded in DataLab: {data}", { data: label }) +
    "\n" +
    t("Computation engine running in your browser (Python/WebAssembly)") +
    reservedLine +
    jsLine +
    "\n" +
    t("Click to manage memory");

  const handleFreeMemory = async () => {
    setOpen(false);
    if (busy || !onRequestFreeMemory) return;
    setBusy(true);
    try {
      await onRequestFreeMemory();
    } finally {
      if (mounted.current) {
        setBusy(false);
        refresh();
      }
    }
  };

  const handleToggleStoreOnDisk = async () => {
    setOpen(false);
    if (!onToggleStoreOnDisk) return;
    await onToggleStoreOnDisk();
  };

  const diskDisabled = !diskStorageSupported || storageBusy;

  return (
    <div className="memory-usage-indicator-root" ref={rootRef}>
      <button
        type="button"
        className={"memory-usage-indicator" + LEVEL_CLASS[level]}
        onClick={() => setOpen((v) => !v)}
        title={tooltip}
        aria-label={tooltip}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="memory-usage-indicator-glyph" aria-hidden="true">
          {"\u25A4"}
        </span>
        <span className="memory-usage-indicator-value">{label}</span>
      </button>
      {open && (
        <div className="memory-usage-menu" role="menu">
          {onToggleStoreOnDisk && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={storeOnDisk}
              className="memory-usage-menu-item memory-usage-menu-item--option"
              disabled={diskDisabled}
              onClick={() => {
                void handleToggleStoreOnDisk();
              }}
            >
              <span
                className={
                  "memory-usage-menu-checkbox" +
                  (storeOnDisk ? " memory-usage-menu-checkbox--checked" : "")
                }
                aria-hidden="true"
              >
                {storeOnDisk ? "\u2611" : "\u2610"}
              </span>
              <span>{t("Store data on disk")}</span>
            </button>
          )}
          {onToggleStoreOnDisk && (
            <div
              className="memory-usage-menu-separator"
              role="separator"
              aria-hidden="true"
            />
          )}
          <button
            type="button"
            role="menuitem"
            className="memory-usage-menu-item memory-usage-menu-item--action"
            disabled={busy || !onRequestFreeMemory}
            onClick={() => {
              void handleFreeMemory();
            }}
          >
            <span className="memory-usage-menu-icon" aria-hidden="true">
              <svg
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                focusable={false}
              >
                <path d="m16 22-1-4" />
                <path d="M19 13.99a1 1 0 0 0 1-1V12a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v.99a1 1 0 0 0 1 1" />
                <path d="M5 14h14l1.973 6.767A1 1 0 0 1 20 22H4a1 1 0 0 1-.973-1.233z" />
                <path d="m8 22 1-4" />
              </svg>
            </span>
            <span>{t("Free memory")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
