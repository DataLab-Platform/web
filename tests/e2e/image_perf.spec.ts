/**
 * Image-display performance benchmark.
 *
 * Reproduces the user-visible scenario: create 4 images of different
 * types (default size from Sigima), then multi-select them all in the
 * tree so :class:`MultiImagePlot` renders the 2×2 grid.
 *
 * The benchmark splits the wall clock into the individually
 * attributable phases (Pyodide bridge, JSON serialisation, React
 * commit, Plotly draw) so we can identify which stage actually
 * dominates the latency the user perceives.
 *
 * Run with:
 *   npx playwright test tests/e2e/image_perf.spec.ts --reporter=list
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForRuntimeReady } from "./fixtures";
import {
  installPlotlyMetrics,
  measureRuntimePayload,
  readPlotlyMetrics,
  resetPlotlyMetrics,
  waitForNextPlotRender,
  type RuntimePayloadMetric,
} from "./helpers/plotlyMetrics";

interface BenchResult {
  imageCount: number;
  width: number;
  height: number;
  // Backend / bridge timings (ms)
  createMs: number[];
  getImagesData: RuntimePayloadMetric;
  getImageDataPerImage: RuntimePayloadMetric[];
  payloadBytes: number;
  // Render timings (ms)
  singleSelectToPlotMs: number;
  singlePlotlyRenderMs: number;
  singleReactDrawCount: number;
  multiSelectToCommitMs: number;
  commitToCanvasPaintMs: number;
  multiSelectToGridMs: number;
  gridPlotlyRedrawMs: number | null;
  gridPlotlyGraphCount: number;
  plotlyReactCount: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longestTaskMs: number;
}

test.describe("Image display perf", () => {
  test.setTimeout(300_000);

  test("4 × default-size images, multi-selected", async ({ page }) => {
    await installPlotlyMetrics(page);
    // Capture browser console output to surface async errors / warnings
    // that may explain unexpected slowness.
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning")
        console.log(`[browser:${msg.type()}]`, msg.text());
    });

    await page.goto("/");
    await waitForRuntimeReady(page);

    // Make sure we're on the Image panel.
    await page.getByRole("tab", { name: "Images" }).click();

    // ---------------------------------------------------------------
    // 1. Backend benchmark: create 4 images of different types and
    //    measure each backend round-trip.
    // ---------------------------------------------------------------
    const created = await page.evaluate(async () => {
      type Runtime = {
        listImageCreationTypes: () => Promise<{ value: string }[]>;
        createImageTyped: (s: string) => Promise<string>;
      };
      const runtime = (window as unknown as { runtime: Runtime }).runtime;

      const types = await runtime.listImageCreationTypes();
      // Pick the first 4 distinct types — order matches the Create
      // menu (gauss, uniform, zeros, empty, ...).
      const picked = types.slice(0, 4).map((t) => t.value);
      const createMs: number[] = [];
      const ids: string[] = [];
      for (const stype of picked) {
        const t0 = performance.now();
        const oid = await runtime.createImageTyped(stype);
        createMs.push(performance.now() - t0);
        ids.push(oid);
      }
      return { types: picked, ids, createMs };
    });

    const getImageDataPerImage: RuntimePayloadMetric[] = [];
    for (const oid of created.ids) {
      getImageDataPerImage.push(
        await measureRuntimePayload(page, "getImageData", [oid]),
      );
    }
    const getImagesData = await measureRuntimePayload(page, "getImagesData", [
      created.ids,
    ]);
    expect(getImagesData.itemCount).toBe(4);
    const expectedPayloadBytes = getImagesData.shapes.reduce(
      (total, shape) => total + (shape.width ?? 0) * (shape.height ?? 0) * 4,
      0,
    );
    expect(getImagesData.payloadBytes).toBe(expectedPayloadBytes);

    // Force the App to repopulate the object tree (it was rendered
    // before the images existed).  Toggling the panel switcher fires
    // App.refresh() which reads the live store.
    await page.getByRole("tab", { name: "Signals" }).click();
    await page.getByRole("tab", { name: "Images" }).click();

    // ---------------------------------------------------------------
    // 2. UI benchmark: measure the first Plotly viewer, then the React
    //    commit and canvas paint of the multi-image grid separately.
    // ---------------------------------------------------------------
    const items = page.locator(".object-tree-item");
    await expect
      .poll(() => items.count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(4);

    // First click: focus image #0 (single ImagePlot).  We measure the
    // multi-select latency from the moment we add image #2/#3/#4 to
    // the selection until the 4-cell grid is on screen.
    // Warm the initial mount. The graphDiv only exposes its event emitter
    // after Plotly's first render, so this mount is deliberately not timed.
    const warmMetrics = await readPlotlyMetrics(page);
    await items.nth(0).click();
    await waitForNextPlotRender(page, warmMetrics.plotRenders.length, "image");

    // Measure a React-driven update on the already-instrumented graph.
    await resetPlotlyMetrics(page);
    const tSingle = await page.evaluate(() => performance.now());
    await items.nth(1).click();
    const singleRender = await waitForNextPlotRender(page, 0, "image");
    const tSingleDone = await page.evaluate(() => performance.now());
    const singleMetrics = await readPlotlyMetrics(page);

    // Anchor the range on the first image before timing the transition.
    await items.nth(0).click();
    await waitForNextPlotRender(
      page,
      singleMetrics.plotRenders.length,
      "image",
    );

    // Select the full contiguous range atomically. Sequential Ctrl-clicks
    // would render intermediate two/three-image states and pollute this
    // single-image-to-grid measurement.
    await resetPlotlyMetrics(page);
    const tSel = await page.evaluate(() => performance.now());
    await items.nth(3).click({ modifiers: ["Shift"] });
    // Wait for the grid to mount and contain 4 cells.
    await page.waitForFunction(
      () => document.querySelectorAll(".multi-image-cell").length >= 4,
      undefined,
      { timeout: 60_000 },
    );
    const tCommit = await page.evaluate(() => performance.now());
    // Wait until each cell's canvas has been painted (``width`` is
    // only set once :func:`paintImageData` runs in our ``useEffect``).
    await page.waitForFunction(
      () => {
        const canvases = document.querySelectorAll<HTMLCanvasElement>(
          ".multi-image-cell .multi-image-canvas",
        );
        if (canvases.length < 4) return false;
        return Array.from(canvases).every((c) => c.width > 0);
      },
      undefined,
      { timeout: 120_000 },
    );
    const tDone = await page.evaluate(() => performance.now());
    const gridMetrics = await readPlotlyMetrics(page);
    const gridPlotlyGraphCount = await page
      .locator(".multi-image-cell .js-plotly-plot")
      .count();

    // Save a screenshot of the rendered grid for visual verification.
    await page.screenshot({
      path: "test-results/image_perf_grid.png",
      fullPage: false,
    });

    const firstShape = getImagesData.shapes[0] ?? {};
    const singlePlotlyRenderMs = singleRender.startTime - tSingle;
    const gridPlotlyRedrawMs =
      gridMetrics.drawDurations.length > 0
        ? gridMetrics.drawDurations.reduce((total, value) => total + value, 0)
        : null;
    const longTaskTotalMs = gridMetrics.longTasks.reduce(
      (total, task) => total + task.duration,
      0,
    );

    const result: BenchResult = {
      imageCount: 4,
      width: firstShape.width ?? 0,
      height: firstShape.height ?? 0,
      createMs: created.createMs,
      getImagesData,
      getImageDataPerImage,
      payloadBytes: getImagesData.payloadBytes,
      singleSelectToPlotMs: tSingleDone - tSingle,
      singlePlotlyRenderMs,
      singleReactDrawCount: singleMetrics.plotRenders.length,
      multiSelectToCommitMs: tCommit - tSel,
      commitToCanvasPaintMs: tDone - tCommit,
      multiSelectToGridMs: tDone - tSel,
      gridPlotlyRedrawMs,
      gridPlotlyGraphCount,
      plotlyReactCount: gridMetrics.plotRenders.length,
      longTaskCount: gridMetrics.longTasks.length,
      longTaskTotalMs,
      longestTaskMs: Math.max(
        0,
        ...gridMetrics.longTasks.map((t) => t.duration),
      ),
    };
    expect(result.singleReactDrawCount).toBeGreaterThan(0);
    expect(result.gridPlotlyGraphCount).toBe(0);
    expect(result.gridPlotlyRedrawMs).toBeNull();

    console.log("\n=== Image display benchmark ===");
    console.log(
      `Image size:                ${result.width} × ${result.height}`,
    );
    console.log(`Image kinds:               ${created.types.join(", ")}`);
    console.log(
      `create_image_typed (each): ${result.createMs.map((v) => v.toFixed(0)).join(", ")} ms`,
    );
    console.log(
      `get_image_data (each):     ${result.getImageDataPerImage
        .map((metric) => metric.totalMs.toFixed(0))
        .join(", ")} ms`,
    );
    console.log(
      `get_images_data (×4):      ${result.getImagesData.totalMs.toFixed(0)} ms`,
    );
    console.log(
      `  queue / bridge / decode: ${result.getImagesData.queueWaitMs?.toFixed(1) ?? "n/a"} / ${result.getImagesData.bridgeAndTransferMs?.toFixed(1) ?? "n/a"} / ${result.getImagesData.decodeMs?.toFixed(1) ?? "n/a"} ms`,
    );
    console.log(
      `Binary payload (×4):       ${(result.payloadBytes / 1e6).toFixed(2)} MB`,
    );
    console.log(
      `Single select → Plotly:    ${result.singleSelectToPlotMs.toFixed(0)} ms (render ${result.singlePlotlyRenderMs.toFixed(0)} ms, n=${result.singleReactDrawCount})`,
    );
    console.log(
      `Multi-select → commit:     ${result.multiSelectToCommitMs.toFixed(0)} ms`,
    );
    console.log(
      `Commit → canvas paint:     ${result.commitToCanvasPaintMs.toFixed(0)} ms`,
    );
    console.log(
      `Multi-select → grid:       ${result.multiSelectToGridMs.toFixed(0)} ms (${result.longTaskCount} long tasks, max ${result.longestTaskMs.toFixed(0)} ms)`,
    );
    console.log("================================\n");

    // Persist machine-readable results next to the other benchmark
    // outputs so they can be tracked over time. Only the deterministic
    // metrics (payload sizes) are meaningful as regression invariants;
    // the timings are kept for trend inspection but are noisy on shared
    // CI runners (see scripts/perf-to-benchmark-json.mjs).
    const here = dirname(fileURLToPath(import.meta.url));
    const resultsDir = join(here, "..", "benchmark", "results");
    mkdirSync(resultsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outPath = join(resultsDir, `image_perf_${stamp}.json`);
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          imageKinds: created.types,
          result,
        },
        null,
        2,
      ),
    );
    console.log(`[image-perf] results written to ${outPath}\n`);

    // Soft sanity bounds: the test does not fail on slowness — the
    // user explicitly wants to measure it — but we keep an upper
    // limit so a regression that hangs forever is caught.
    expect(result.multiSelectToGridMs).toBeLessThan(120_000);
  });
});
