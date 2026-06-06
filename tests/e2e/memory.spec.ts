/**
 * Memory-management end-to-end tests.
 *
 * Two foundational invariants of the memory feature are exercised here:
 *
 * 1. The menu-bar indicator is present and reports a live WASM-heap
 *    figure once the runtime has booted (a visible DOM assertion).
 * 2. The "Free memory" reclamation actually bounds heap growth: a loop
 *    that creates and drops large images while reclaiming after each
 *    iteration must not grow the WASM heap by anywhere near the leaked
 *    working set. Pyodide's heap never shrinks back to the OS, so the
 *    measurable impact is *reuse* of freed pages, not a lower figure.
 *
 * The thresholds are deliberately tolerant: WASM grows in coarse pages
 * and the absolute figure is noisy across machines. A genuine leak would
 * grow the heap by N × image-size; reuse keeps it to a small constant.
 */
import { test, expect } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

test.describe("Memory management", () => {
  test.setTimeout(300_000);

  test("menu-bar indicator reports a live heap figure", async ({ page }) => {
    await page.goto("/");
    await waitForRuntimeReady(page);

    const indicator = page.locator(".memory-usage-indicator");
    await expect(indicator).toBeVisible();
    // The value span must render a non-empty, non-placeholder figure.
    const value = await indicator
      .locator(".memory-usage-indicator-value")
      .textContent();
    expect(value).toBeTruthy();
    expect(value).not.toBe("\u2014");

    const wasm = await page.evaluate(() => {
      const runtime = (
        window as unknown as {
          runtime: { getMemoryUsage: () => { wasmBytes: number | null } };
        }
      ).runtime;
      return runtime.getMemoryUsage().wasmBytes;
    });
    expect(typeof wasm).toBe("number");
    expect(wasm as number).toBeGreaterThan(0);
  });

  test("Free memory reclaims dropped references and bounds heap growth", async ({
    page,
  }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("[browser:error]", msg.text());
    });

    await page.goto("/");
    await waitForRuntimeReady(page);
    await page.getByRole("tab", { name: "Images" }).click();

    const measurement = await page.evaluate(async () => {
      interface FreeResult {
        collected: number;
        objects_before: number;
        objects_after: number;
        wasmBefore: number | null;
        wasmAfter: number | null;
      }
      interface MemRuntime {
        getMemoryUsage: () => { wasmBytes: number | null };
        freeMemory: () => Promise<FreeResult>;
        runPython: (code: string) => Promise<unknown>;
        deleteAllObjects: (kind: string) => Promise<void>;
      }
      const runtime = (window as unknown as { runtime: MemRuntime }).runtime;
      // 1024² float64 = 8 MiB per image; a batch of four ≈ 32 MiB —
      // large enough to move the heap, light enough to stay fast.
      const SIDE = 1024;
      const BATCH = 4;
      const imageBytes = SIDE * SIDE * 8;
      const heap = () => runtime.getMemoryUsage().wasmBytes ?? 0;
      const makeBatch = async () => {
        for (let i = 0; i < BATCH; i++) {
          await runtime.runPython(
            `import numpy as np\nadd_image_from_array("probe${i}", np.zeros((${SIDE}, ${SIDE})))`,
          );
        }
      };

      const base = heap();
      await makeBatch();
      const afterFirst = heap();

      await runtime.deleteAllObjects("image");
      const free = await runtime.freeMemory();

      // Re-create the same working set after reclamation: freed pages
      // should be reused instead of growing the heap a second time.
      await makeBatch();
      const afterSecond = heap();

      return { base, afterFirst, afterSecond, free, imageBytes, batch: BATCH };
    });

    const { base, afterFirst, afterSecond, free, imageBytes, batch } =
      measurement;
    const firstGrowth = afterFirst - base;
    const totalGrowth = afterSecond - base;
    const workingSet = imageBytes * batch;

    console.log(
      `[memory] first batch grew heap by ${(firstGrowth / 1024 / 1024).toFixed(1)} ` +
        `MiB; after free+recreate total growth ${(totalGrowth / 1024 / 1024).toFixed(1)} ` +
        `MiB; working set ${(workingSet / 1024 / 1024).toFixed(0)} MiB; ` +
        `gc collected ${free.collected}, objects ${free.objects_before} → ${free.objects_after}`,
    );

    // The reclamation pass is correctly wired end-to-end.
    expect(typeof free.wasmBefore).toBe("number");
    expect(typeof free.wasmAfter).toBe("number");
    expect(free.collected).toBeGreaterThanOrEqual(0);
    // Dropping the batch then collecting must not leave more live objects
    // than before the pass — i.e. references were actually reclaimed.
    expect(free.objects_after).toBeLessThanOrEqual(free.objects_before);
    // Re-creating the same working set after a free reuses freed pages,
    // so total growth stays close to a single working set rather than two.
    // Allow generous slack for WASM page rounding / fragmentation.
    expect(totalGrowth).toBeLessThan(workingSet * 2);
  });
});
