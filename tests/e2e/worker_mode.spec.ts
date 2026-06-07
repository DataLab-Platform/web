/**
 * Worker-mode runtime — permanent end-to-end regression suite.
 *
 * The runtime can host Pyodide either on the UI thread (default) or inside
 * a Dedicated Web Worker (opt-in via ``?runtime=worker``; see
 * ``runtimeMode.ts`` and DEW ADR #2). The worker path has its own failure
 * surface that unit tests cannot reach — Pyodide boot inside a module
 * worker, the ``postMessage`` RPC bridge, transferable buffers, the
 * synchronous mirror, and the workspace-mutation event crossing back to the
 * main thread. A subtle break here (e.g. the Proxy accidentally becoming
 * *thenable*) would hang boot silently; only a browser-driven test catches
 * it reliably.
 *
 * This is the **permanent** guard that gates promoting worker mode to the
 * default. It runs in the regular ``chromium`` project (not ``perf``), so
 * it executes on every CI run. To amortise the one-time worker boot
 * (~tens of seconds: Pyodide download + Sigima micropip install), all
 * assertions share a single page booted once in ``beforeAll`` and run
 * ``serial``.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";

import { waitForRuntimeReady } from "./fixtures";

/** Structural view of the public runtime surface this suite drives. */
interface E2ERuntime {
  addSignalFromArrays(params: {
    title: string;
    xdata: number[];
    ydata: number[];
  }): Promise<string>;
  addImageFromArray(params: {
    title: string;
    data: Float64Array;
    width: number;
    height: number;
    dtype: string;
  }): Promise<string>;
  getSignalData(id: string): Promise<{ x: number[]; y: number[] }>;
  getImageData(oid: string): Promise<{
    width: number;
    height: number;
    data_min: number;
    data_max: number;
  }>;
  listSignals(): Promise<{ id: string; title: string }[]>;
  listImages(): Promise<{ id: string; title: string }[]>;
  setStorageMode(mode: "ram" | "disk"): Promise<void>;
  getStorageMode(): "ram" | "disk";
  getSpilledCount(): number;
  getDiskStoreBytes(): number;
  getMemoryUsage(): { wasmBytes: number | null };
  deleteAllObjects(kind: "signal" | "image"): Promise<void>;
  resetAll(): Promise<void>;
}

/* The runtime is exposed on ``window.runtime`` in dev mode by
 * ``RuntimeContext``. Each ``page.evaluate`` below rebuilds a typed handle
 * from ``window`` — Playwright runs the closure in the browser context, so
 * it cannot capture an outer-scope helper. */

test.describe.serial("worker-mode runtime (E2E)", () => {
  // One worker boot for the whole suite; generous budget for the cold
  // Pyodide download + Sigima install inside the worker.
  test.describe.configure({ timeout: 300_000 });

  let context: Awaited<ReturnType<Browser["newContext"]>>;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("[browser:error]", msg.text());
    });
    page.on("pageerror", (err) => console.log("[pageerror]", err.message));
    // Opt into worker mode via the URL flag honoured by ``getRuntimeMode``.
    await page.goto("/?runtime=worker");
    await waitForRuntimeReady(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("boots Pyodide in the worker and reports ready", async () => {
    // ``waitForRuntimeReady`` already asserted the status attribute; make
    // the worker-boot success explicit and prove the runtime answers RPC
    // calls (the bridge is live), with a real non-zero heap behind it.
    await expect(page.locator(".app")).toHaveAttribute(
      "data-runtime-status",
      "ready",
    );
    const wasm = await page.evaluate(
      () =>
        (window as unknown as { runtime: E2ERuntime }).runtime.getMemoryUsage()
          .wasmBytes,
    );
    expect(typeof wasm).toBe("number");
    expect(wasm as number).toBeGreaterThan(0);
  });

  test("round-trips a signal across the postMessage bridge", async () => {
    const result = await page.evaluate(async () => {
      const runtime = (window as unknown as { runtime: E2ERuntime }).runtime;
      await runtime.resetAll();
      const x = Array.from({ length: 64 }, (_, i) => i);
      const y = x.map((v) => v * 2);
      const id = await runtime.addSignalFromArrays({
        title: "worker-signal",
        xdata: x,
        ydata: y,
      });
      const data = await runtime.getSignalData(id);
      const signals = await runtime.listSignals();
      return {
        count: signals.length,
        firstY: data.y[0],
        lastY: data.y[data.y.length - 1],
        length: data.y.length,
      };
    });
    expect(result.count).toBe(1);
    expect(result.length).toBe(64);
    expect(result.firstY).toBe(0);
    expect(result.lastY).toBe(126);
  });

  test("transfers an image array zero-copy and reads it back intact", async () => {
    // Exercises the transferable path: the 512² float64 input (2 MiB) is
    // moved (not cloned) into the worker, and the encoded payload is
    // transferred back. Integrity is the proof the buffers survived the
    // move in both directions.
    const result = await page.evaluate(async () => {
      const runtime = (window as unknown as { runtime: E2ERuntime }).runtime;
      await runtime.resetAll();
      const side = 512;
      const data = new Float64Array(side * side);
      data.fill(7);
      const oid = await runtime.addImageFromArray({
        title: "worker-image",
        data,
        width: side,
        height: side,
        dtype: "float64",
      });
      const img = await runtime.getImageData(oid);
      const images = await runtime.listImages();
      return {
        count: images.length,
        width: img.width,
        height: img.height,
        min: img.data_min,
        max: img.data_max,
      };
    });
    expect(result.count).toBe(1);
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.min).toBe(7);
    expect(result.max).toBe(7);
  });

  test("preserves call ordering (FIFO queue) over the bridge", async () => {
    const titles = await page.evaluate(async () => {
      const runtime = (window as unknown as { runtime: E2ERuntime }).runtime;
      await runtime.resetAll();
      const x = Array.from({ length: 8 }, (_, i) => i);
      const tasks = Array.from({ length: 10 }, (_, i) =>
        runtime.addSignalFromArrays({
          title: `wq-${i}`,
          xdata: x,
          ydata: x.map((v) => v * (i + 1)),
        }),
      );
      await Promise.all(tasks);
      return (await runtime.listSignals())
        .map((s) => s.title)
        .filter((t) => t.startsWith("wq-"));
    });
    expect(titles).toHaveLength(10);
    for (let i = 0; i < 10; i += 1) {
      expect(titles[i]).toBe(`wq-${i}`);
    }
  });

  test("spills to OPFS in disk mode and keeps the sync mirror consistent", async () => {
    const result = await page.evaluate(async () => {
      const runtime = (window as unknown as { runtime: E2ERuntime }).runtime;
      await runtime.resetAll();
      await runtime.setStorageMode("disk");

      const side = 512;
      const n = 4;
      const oids: string[] = [];
      for (let i = 0; i < n; i++) {
        const data = new Float64Array(side * side);
        data.fill(i);
        oids.push(
          await runtime.addImageFromArray({
            title: `disk-${i}`,
            data,
            width: side,
            height: side,
            dtype: "float64",
          }),
        );
      }

      // Synchronous accessors must reflect state right after the await —
      // the worker pushes the mirror before the result so there is no lag.
      const mode = runtime.getStorageMode();
      const spilled = runtime.getSpilledCount();
      const diskBytes = runtime.getDiskStoreBytes();

      // Page each image back in from the OPFS store and check integrity.
      let checksum = 0;
      let integrityOk = true;
      for (const oid of oids) {
        const img = await runtime.getImageData(oid);
        checksum += img.data_min;
        if (img.data_min !== img.data_max) integrityOk = false;
      }

      await runtime.deleteAllObjects("image");
      await runtime.setStorageMode("ram");
      return { mode, spilled, diskBytes, checksum, integrityOk, n };
    });
    expect(result.mode).toBe("disk");
    expect(result.spilled).toBe(result.n);
    expect(result.diskBytes).toBeGreaterThan(0);
    expect(result.integrityOk).toBe(true);
    // 0 + 1 + 2 + 3.
    expect(result.checksum).toBe(6);
  });

  test("bridges workspace mutations to the dirty title marker", async () => {
    // Creating an object fires a workspace-mutation event in the worker;
    // it must cross back to the main thread and flip WorkspaceContext's
    // dirty flag, which surfaces as the ``•`` marker in the document title.
    await page.evaluate(async () => {
      const runtime = (window as unknown as { runtime: E2ERuntime }).runtime;
      await runtime.resetAll();
      await runtime.addSignalFromArrays({
        title: "dirty-probe",
        xdata: [0, 1, 2],
        ydata: [0, 1, 2],
      });
    });
    await expect
      .poll(() => page.title(), { timeout: 10_000 })
      .toMatch(/\u2022/);
  });
});
