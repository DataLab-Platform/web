import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPackagesWithRetry,
  loadPyodideOrFail,
  micropipInstallWithRetry,
  type PackageLoader,
} from "../../../src/runtime/packageRetry";

const noWait = { sleep: async () => undefined, label: "[test]" };

afterEach(() => {
  vi.restoreAllMocks();
});

/** Pyodide-like loader whose ``loadPackage`` reports a failure through its
 *  ``errorCallback`` (without throwing) on the first ``failures`` calls. */
function flakyLoader(failures: number): PackageLoader & {
  loadCalls: string[][];
} {
  const loadCalls: string[][] = [];
  return {
    loadCalls,
    loadPackage: vi.fn(async (names, options) => {
      loadCalls.push(names as string[]);
      if (loadCalls.length <= failures) {
        options?.errorCallback?.(
          "The following error occurred while loading scipy:",
        );
        options?.errorCallback?.("net::ERR_CACHE_WRITE_FAILURE");
      }
    }),
    runPythonAsync: vi.fn(async () => undefined),
  };
}

describe("loadPackagesWithRetry", () => {
  it("loads once when nothing fails", async () => {
    const py = flakyLoader(0);
    await loadPackagesWithRetry(py, ["numpy", "scipy"], noWait);
    expect(py.loadCalls).toEqual([["numpy", "scipy"]]);
  });

  it("retries while a package fails to load", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const sleeps: number[] = [];
    const py = flakyLoader(2);
    await loadPackagesWithRetry(py, ["numpy", "scipy"], {
      ...noWait,
      delayMs: 100,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(py.loadCalls).toHaveLength(3);
    // Growing delay between attempts.
    expect(sleeps).toEqual([100, 200]);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("logs and gives up without throwing after the last attempt", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const py = flakyLoader(10);
    await expect(
      loadPackagesWithRetry(py, ["scipy"], { ...noWait, attempts: 3 }),
    ).resolves.toBeUndefined();
    expect(py.loadCalls).toHaveLength(3);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("failed after 3 attempts"),
      expect.any(Error),
    );
  });
});

describe("micropipInstallWithRetry", () => {
  it("retries a failed installation, then succeeds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const py = flakyLoader(0);
    let calls = 0;
    py.runPythonAsync = vi.fn(async (code: string) => {
      calls += 1;
      expect(code).toContain('micropip.install(["sigima","guidata"])');
      if (calls === 1) throw new Error("Can't fetch metadata");
    });
    await micropipInstallWithRetry(py, ["sigima", "guidata"], noWait);
    expect(calls).toBe(2);
  });

  it("rethrows the last error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const py = flakyLoader(0);
    py.runPythonAsync = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(
      micropipInstallWithRetry(py, ["sigima"], { ...noWait, attempts: 2 }),
    ).rejects.toThrow("offline");
    expect(py.runPythonAsync).toHaveBeenCalledTimes(2);
  });
});

describe("loadPyodideOrFail", () => {
  it("resolves with the Pyodide instance", async () => {
    const py = { ok: true };
    await expect(
      loadPyodideOrFail(
        async (o: { indexURL: string }) => {
          expect(o.indexURL).toBe("cdn/");
          return py;
        },
        { indexURL: "cdn/" },
      ),
    ).resolves.toBe(py);
  });

  it("fails instead of hanging when the WebAssembly module fails to load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const original = console.warn;
    // Like Pyodide 0.26: warns, and the returned promise never settles.
    const hanging = () => {
      console.warn("wasm instantiation failed!");
      console.warn(new TypeError("Network error: error"));
      return new Promise<never>(() => undefined);
    };
    await expect(loadPyodideOrFail(hanging, {})).rejects.toThrow(
      "WebAssembly module of Pyodide could not be loaded",
    );
    // Both warnings are still logged, and console.warn is restored.
    expect(warn).toHaveBeenCalledTimes(2);
    expect(console.warn).toBe(original);
  });
});
