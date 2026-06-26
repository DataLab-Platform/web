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

interface BenchResult {
  imageCount: number;
  width: number;
  height: number;
  // Backend / bridge timings (ms)
  createMs: number[];
  getImagesDataMs: number; // batched call (used by MultiImagePlot path)
  getImageDataMsPerImage: number[]; // sequential, mirrors current App.tsx single + batch
  payloadBytesApprox: number; // estimated JSON bytes for getImagesData payload
  // Render timings (ms)
  multiSelectToGridMs: number; // tree click → 4th heatmap visible
  plotlyDrawMs: number; // sum of plotly_afterplot timings
}

test.describe("Image display perf", () => {
  test.setTimeout(300_000);

  test("4 × default-size images, multi-selected", async ({ page }) => {
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
    const backend = await page.evaluate(async () => {
      type Runtime = {
        listImageCreationTypes: () => Promise<{ value: string }[]>;
        createImageTyped: (s: string) => Promise<string>;
        getImageData: (oid: string) => Promise<{
          width: number;
          height: number;
          data: number[][];
        }>;
        getImagesData: (
          oids: string[],
        ) => Promise<{ width: number; height: number }[]>;
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
      // Single-image fetch per id (sequential; mirrors current
      // App.tsx behaviour where the focused image is fetched
      // separately from the extras).
      const getImageDataMsPerImage: number[] = [];
      let firstShape = { width: 0, height: 0 };
      for (const oid of ids) {
        const t0 = performance.now();
        const d = await runtime.getImageData(oid);
        getImageDataMsPerImage.push(performance.now() - t0);
        firstShape = { width: d.width, height: d.height };
      }
      // Batched fetch (what MultiImagePlot ultimately consumes for
      // the *extras*).
      const tBatch = performance.now();
      const batched = await runtime.getImagesData(ids);
      const getImagesDataMs = performance.now() - tBatch;

      // Approximate JSON payload size of the batched call.  A float
      // serialised as decimal averages ~17 chars + ',' + brackets,
      // so we use a representative character count from the first
      // image's data.tolist().  Cheaper than JSON.stringify of all
      // images.
      const tStr = performance.now();
      const sample = await runtime.getImageData(ids[0]);
      const sampleStr = JSON.stringify(sample.data);
      const stringifyMs = performance.now() - tStr;

      return {
        types: picked,
        ids,
        createMs,
        getImageDataMsPerImage,
        getImagesDataMs,
        firstShape,
        batchedCount: batched.length,
        sampleBytes: sampleStr.length,
        stringifyMs,
      };
    });

    expect(backend.batchedCount).toBe(4);

    // Force the App to repopulate the object tree (it was rendered
    // before the images existed).  Toggling the panel switcher fires
    // App.refresh() which reads the live store.
    await page.getByRole("tab", { name: "Signals" }).click();
    await page.getByRole("tab", { name: "Images" }).click();

    // ---------------------------------------------------------------
    // 2. UI benchmark: instrument plotly_afterplot, then ctrl-click
    //    the 3 other images so the grid renders.
    // ---------------------------------------------------------------
    const items = page.locator(".object-tree-item");
    await expect
      .poll(() => items.count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(4);

    // First click: focus image #0 (single ImagePlot).  We measure the
    // multi-select latency from the moment we add image #2/#3/#4 to
    // the selection until the 4-cell grid is on screen.
    await items.nth(0).click();
    await page.waitForSelector(".js-plotly-plot", { timeout: 30_000 });

    // Hook plotly's draw callback before we trigger the multi-select.
    await page.evaluate(() => {
      type WinExt = Window & {
        __plotlyDrawMs?: number;
        __plotlyDrawCount?: number;
      };
      const w = window as unknown as WinExt;
      w.__plotlyDrawMs = 0;
      w.__plotlyDrawCount = 0;
      // react-plotly.js attaches the gd to the wrapper div; we hook
      // into the Plotly events on each existing plot div and on any
      // newly-mounted ones via a MutationObserver.
      const hook = (node: Element) => {
        const gd = node as unknown as {
          on?: (ev: string, cb: () => void) => void;
          __dlwHooked?: boolean;
          __dlwStart?: number;
        };
        if (!gd.on || gd.__dlwHooked) return;
        gd.__dlwHooked = true;
        gd.on("plotly_beforeplot", () => {
          gd.__dlwStart = performance.now();
        });
        gd.on("plotly_afterplot", () => {
          if (gd.__dlwStart !== undefined) {
            w.__plotlyDrawMs =
              (w.__plotlyDrawMs ?? 0) + (performance.now() - gd.__dlwStart);
            w.__plotlyDrawCount = (w.__plotlyDrawCount ?? 0) + 1;
            gd.__dlwStart = undefined;
          }
        });
      };
      document.querySelectorAll(".js-plotly-plot").forEach(hook);
      const obs = new MutationObserver((muts) => {
        for (const m of muts) {
          m.addedNodes.forEach((n) => {
            if (!(n instanceof Element)) return;
            if (n.classList?.contains("js-plotly-plot")) hook(n);
            n.querySelectorAll?.(".js-plotly-plot").forEach(hook);
          });
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      (w as unknown as { __plotlyObs?: MutationObserver }).__plotlyObs = obs;
    });

    // Trigger the multi-select by ctrl-clicking the 3 other images.
    const tSel = await page.evaluate(() => performance.now());
    for (let i = 1; i < 4; i += 1) {
      await items.nth(i).click({ modifiers: ["Control"] });
    }
    // Wait for the grid to mount and contain 4 cells.
    await page.waitForFunction(
      () => document.querySelectorAll(".multi-image-cell").length >= 4,
      undefined,
      { timeout: 60_000 },
    );
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

    // Save a screenshot of the rendered grid for visual verification.
    await page.screenshot({
      path: "test-results/image_perf_grid.png",
      fullPage: false,
    });

    const drawStats = await page.evaluate(() => {
      const w = window as unknown as {
        __plotlyDrawMs?: number;
        __plotlyDrawCount?: number;
      };
      return {
        ms: w.__plotlyDrawMs ?? 0,
        count: w.__plotlyDrawCount ?? 0,
      };
    });

    const result: BenchResult = {
      imageCount: 4,
      width: backend.firstShape.width,
      height: backend.firstShape.height,
      createMs: backend.createMs,
      getImagesDataMs: backend.getImagesDataMs,
      getImageDataMsPerImage: backend.getImageDataMsPerImage,
      payloadBytesApprox: backend.sampleBytes * 4,
      multiSelectToGridMs: tDone - tSel,
      plotlyDrawMs: drawStats.ms,
    };

    console.log("\n=== Image display benchmark ===");
    console.log(
      `Image size:                ${result.width} × ${result.height}`,
    );
    console.log(`Image kinds:               ${backend.types.join(", ")}`);
    console.log(
      `create_image_typed (each): ${result.createMs.map((v) => v.toFixed(0)).join(", ")} ms`,
    );
    console.log(
      `get_image_data (each):     ${result.getImageDataMsPerImage
        .map((v) => v.toFixed(0))
        .join(", ")} ms`,
    );
    console.log(
      `get_images_data (×4):      ${result.getImagesDataMs.toFixed(0)} ms`,
    );
    console.log(
      `JSON.stringify(1 img):     ${backend.stringifyMs.toFixed(0)} ms (${(
        backend.sampleBytes / 1e6
      ).toFixed(2)} MB)`,
    );
    console.log(
      `Approx payload (×4):       ${(result.payloadBytesApprox / 1e6).toFixed(
        2,
      )} MB`,
    );
    console.log(
      `Plotly draw (sum, n=${drawStats.count}):    ${result.plotlyDrawMs.toFixed(
        0,
      )} ms`,
    );
    console.log(
      `Multi-select → grid:       ${result.multiSelectToGridMs.toFixed(0)} ms`,
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
          imageKinds: backend.types,
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
