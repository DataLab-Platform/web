/**
 * MemoryUsageIndicator — small persistent button in the menu bar that
 * shows the live runtime memory footprint and turns orange/red as it
 * approaches out-of-memory territory.
 *
 * DataLab-Web runs Sigima inside Pyodide, whose WASM linear heap grows
 * as large image arrays are allocated and never shrinks back to the OS.
 * A long session that creates and drops many large images can therefore
 * exhaust the browser tab's memory ("out of memory" crash). This
 * indicator surfaces the footprint so the user can act before the crash
 * — clicking it triggers a garbage-collection pass (``onRequestFreeMemory``)
 * to reclaim dropped Python references.
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
  /** Invoked when the user clicks the indicator to reclaim memory.
   *  Typically wired to ``runtime.freeMemory()`` plus a notification.
   *  The indicator re-samples once the returned promise settles. */
  onRequestFreeMemory?: () => void | Promise<void>;
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
  intervalMs,
}: Props) {
  const { usage, refresh } = useMemoryPoll(runtime, intervalMs);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
    t("Click to free memory that is no longer in use");

  const handleClick = async () => {
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

  return (
    <button
      type="button"
      className={"memory-usage-indicator" + LEVEL_CLASS[level]}
      onClick={handleClick}
      disabled={busy || !onRequestFreeMemory}
      title={tooltip}
      aria-label={tooltip}
    >
      <span className="memory-usage-indicator-glyph" aria-hidden="true">
        {"\u25A4"}
      </span>
      <span className="memory-usage-indicator-value">{label}</span>
    </button>
  );
}
