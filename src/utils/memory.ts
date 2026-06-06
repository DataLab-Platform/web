/**
 * Memory-usage helpers for DataLab-Web.
 *
 * DataLab-Web runs Sigima inside Pyodide (CPython compiled to
 * WebAssembly). The dominant memory consumer is the **WASM linear
 * heap** (`HEAPU8`), which grows as Python objects — notably large
 * image arrays held by the in-memory object model — are allocated.
 * Emscripten never returns that heap to the OS, so a long session that
 * creates and drops many large images keeps growing the heap until the
 * browser tab runs out of memory (the "out of memory" crash).
 *
 * These pure helpers read the current footprint and classify it into a
 * coarse severity level so the menu bar can surface a live indicator.
 * They are intentionally free of React / Pyodide-bundling imports so
 * they can be unit-tested in isolation.
 */

import { t } from "../i18n/translate";

/** A snapshot of the runtime's memory footprint. */
export interface MemoryUsage {
  /** Pyodide WASM linear-heap size in bytes (``HEAPU8.length``). This is
   *  the figure most predictive of an out-of-memory crash, and it is
   *  available in every browser. Emscripten never returns this heap to
   *  the browser, so it only ever grows (a page reload resets it).
   *  ``null`` when the Pyodide module does not expose its heap (e.g.
   *  before boot or on a mocked runtime). */
  wasmBytes: number | null;
  /** Total byte size of the signal/image arrays currently held by the
   *  object model. Unlike {@link wasmBytes} this drops as soon as
   *  objects are deleted, so it is the figure the user can act on.
   *  ``null`` before the runtime can report it. */
  dataBytes: number | null;
  /** JS heap currently used, in bytes. Chromium-only
   *  (``performance.memory``); ``null`` elsewhere. */
  jsUsedBytes: number | null;
  /** JS heap limit, in bytes. Chromium-only; ``null`` elsewhere. */
  jsLimitBytes: number | null;
}

/** Coarse severity buckets used to colour the memory indicator. */
export type MemoryLevel = "ok" | "warn" | "critical";

/**
 * WASM-heap thresholds (in bytes) driving the indicator colour.
 *
 * 32-bit WASM caps the linear heap at 4 GiB, but Pyodide tabs in
 * practice start failing allocations well before that. The defaults
 * below leave headroom: green below 1.5 GiB, orange up to 2.5 GiB,
 * red beyond. Tune here if field data suggests different limits.
 */
export const WASM_WARN_BYTES = 1.5 * 1024 * 1024 * 1024;
export const WASM_CRITICAL_BYTES = 2.5 * 1024 * 1024 * 1024;

/** Minimal shape of the Pyodide Emscripten module we depend on. */
export interface PyodideModuleLike {
  HEAPU8?: { length: number };
}

/** Non-standard ``performance.memory`` (Chromium). */
interface PerformanceMemory {
  usedJSHeapSize?: number;
  jsHeapSizeLimit?: number;
}

/**
 * Read the Pyodide WASM linear-heap size in bytes, or ``null`` when the
 * module does not expose ``HEAPU8`` (pre-boot or mocked runtime).
 */
export function readWasmHeapBytes(
  module: PyodideModuleLike | undefined,
): number | null {
  const length = module?.HEAPU8?.length;
  return typeof length === "number" && Number.isFinite(length) ? length : null;
}

/**
 * Read the Chromium ``performance.memory`` counters, or ``null`` values
 * on browsers that do not expose them (Firefox, Safari).
 */
export function readJsMemory(): {
  jsUsedBytes: number | null;
  jsLimitBytes: number | null;
} {
  const perf = (
    typeof performance !== "undefined" ? performance : undefined
  ) as (Performance & { memory?: PerformanceMemory }) | undefined;
  const mem = perf?.memory;
  return {
    jsUsedBytes:
      typeof mem?.usedJSHeapSize === "number" ? mem.usedJSHeapSize : null,
    jsLimitBytes:
      typeof mem?.jsHeapSizeLimit === "number" ? mem.jsHeapSizeLimit : null,
  };
}

/**
 * Classify a memory snapshot into a coarse severity level based on the
 * WASM heap size. Snapshots without a WASM figure are treated as
 * ``"ok"`` (nothing actionable to show).
 */
export function memoryLevel(usage: MemoryUsage): MemoryLevel {
  const bytes = usage.wasmBytes;
  if (bytes === null) return "ok";
  if (bytes >= WASM_CRITICAL_BYTES) return "critical";
  if (bytes >= WASM_WARN_BYTES) return "warn";
  return "ok";
}

/**
 * Format a byte count as a short human-readable string using binary
 * units (e.g. ``"512 MB"``, ``"1.4 GB"``; localized, so French renders
 * ``"512 Mo"`` / ``"1.4 Go"``). The number and unit are joined by a
 * narrow no-break space (U+202F) per SI / French typography, which also
 * keeps them on the same line. ``null`` renders as ``"—"``.
 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "\u2014";
  // U+202F NARROW NO-BREAK SPACE between value and unit.
  const sp = "\u202f";
  if (bytes < 1024) return `${Math.round(bytes)}${sp}${t("B")}`;
  const units = [t("KB"), t("MB"), t("GB"), t("TB")];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 100, none above, to keep the indicator compact.
  const formatted =
    value >= 100 ? Math.round(value).toString() : value.toFixed(1);
  return `${formatted}${sp}${units[unit]}`;
}
