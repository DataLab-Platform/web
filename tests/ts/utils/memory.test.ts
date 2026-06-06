/**
 * Unit tests for the pure memory-usage helpers in ``src/utils/memory``.
 *
 * These assert the classification thresholds and the byte formatter that
 * drive the menu-bar memory indicator, with no React or Pyodide imports.
 */

import { describe, expect, it } from "vitest";

import {
  formatBytes,
  memoryLevel,
  readJsMemory,
  readWasmHeapBytes,
  WASM_CRITICAL_BYTES,
  WASM_WARN_BYTES,
  type MemoryUsage,
} from "../../../src/utils/memory";

const GiB = 1024 * 1024 * 1024;

/** Narrow no-break space (U+202F) joining value and unit. */
const NB = "\u202f";

function usage(wasmBytes: number | null): MemoryUsage {
  return { wasmBytes, dataBytes: null, jsUsedBytes: null, jsLimitBytes: null };
}

describe("formatBytes", () => {
  it("renders null as an em dash", () => {
    expect(formatBytes(null)).toBe("\u2014");
  });

  it("renders non-finite values as an em dash", () => {
    expect(formatBytes(Number.NaN)).toBe("\u2014");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("\u2014");
  });

  it("renders small byte counts in bytes", () => {
    expect(formatBytes(0)).toBe(`0${NB}B`);
    expect(formatBytes(512)).toBe(`512${NB}B`);
  });

  it("uses binary units with one decimal below 100", () => {
    expect(formatBytes(1024)).toBe(`1.0${NB}KB`);
    expect(formatBytes(1.5 * 1024 * 1024)).toBe(`1.5${NB}MB`);
    expect(formatBytes(1.4 * GiB)).toBe(`1.4${NB}GB`);
  });

  it("drops the decimal at or above 100 of a unit", () => {
    expect(formatBytes(512 * 1024 * 1024)).toBe(`512${NB}MB`);
    expect(formatBytes(128 * 1024)).toBe(`128${NB}KB`);
  });
});

describe("memoryLevel", () => {
  it("treats a missing WASM figure as ok", () => {
    expect(memoryLevel(usage(null))).toBe("ok");
  });

  it("is ok below the warn threshold", () => {
    expect(memoryLevel(usage(WASM_WARN_BYTES - 1))).toBe("ok");
    expect(memoryLevel(usage(0))).toBe("ok");
  });

  it("warns from the warn threshold up to critical", () => {
    expect(memoryLevel(usage(WASM_WARN_BYTES))).toBe("warn");
    expect(memoryLevel(usage(WASM_CRITICAL_BYTES - 1))).toBe("warn");
  });

  it("is critical at or above the critical threshold", () => {
    expect(memoryLevel(usage(WASM_CRITICAL_BYTES))).toBe("critical");
    expect(memoryLevel(usage(4 * GiB))).toBe("critical");
  });
});

describe("readWasmHeapBytes", () => {
  it("returns null for an undefined module", () => {
    expect(readWasmHeapBytes(undefined)).toBeNull();
  });

  it("returns null when HEAPU8 is absent", () => {
    expect(readWasmHeapBytes({})).toBeNull();
  });

  it("returns the heap length when present", () => {
    expect(readWasmHeapBytes({ HEAPU8: { length: 123_456 } })).toBe(123_456);
  });

  it("returns null for a non-finite length", () => {
    expect(readWasmHeapBytes({ HEAPU8: { length: Number.NaN } })).toBeNull();
  });
});

describe("readJsMemory", () => {
  it("returns a well-formed shape regardless of browser support", () => {
    const result = readJsMemory();
    expect(result).toHaveProperty("jsUsedBytes");
    expect(result).toHaveProperty("jsLimitBytes");
    for (const value of [result.jsUsedBytes, result.jsLimitBytes]) {
      expect(value === null || typeof value === "number").toBe(true);
    }
  });
});
