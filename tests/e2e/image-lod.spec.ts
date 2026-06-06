/**
 * End-to-end spec for the single-image viewer's level-of-detail (LOD)
 * display path.
 *
 * Scientific-imaging invariant under test: the LOD optimisation must only
 * affect the **display bitmap**, never the data. Concretely:
 *
 *  1. A large image (> 1 megapixel) is rasterised to a *decimated* bitmap
 *     sized to the viewport — the Plotly ``image`` trace's PNG ``source`` is
 *     much smaller than the 2048² source and its per-cell spacing ``dx`` is
 *     greater than the native pixel spacing (stride > 1).
 *  2. The full-resolution data is untouched — ``getImageData`` still returns
 *     the 2048² grid with exact pixel values, which is what profiles,
 *     statistics and the hover read-out consume.
 *  3. Zooming to a few pixels re-rasterises them 1:1 (crisp): the new PNG is
 *     tiny and ``dx`` collapses back to the native spacing.
 *
 * These assertions are DOM/trace-level (PNG dimensions, trace spacing) rather
 * than ``window.runtime`` no-ops, per the testing strategy.
 */
import { test, expect, type Page } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

const SIDE = 2048; // > 1 MP → LOD engages.
const TITLE = "lod_probe";

interface TraceInfo {
  hasTrace: boolean;
  source: string;
  dx: number;
  dy: number;
  pngWidth: number;
  pngHeight: number;
}

/** Read the ``image`` trace of the single-image viewer and decode its PNG
 *  ``source`` dimensions. */
async function readImageTrace(page: Page): Promise<TraceInfo> {
  return page.evaluate(async () => {
    const gd = document.querySelector(".image-plot-host .js-plotly-plot") as
      | (HTMLElement & { data?: Array<Record<string, unknown>> })
      | null;
    const trace = gd?.data?.find((t) => t.type === "image");
    if (!trace) {
      return {
        hasTrace: false,
        source: "",
        dx: 0,
        dy: 0,
        pngWidth: 0,
        pngHeight: 0,
      };
    }
    const source = String(trace.source ?? "");
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => resolve({ w: 0, h: 0 });
      im.src = source;
    });
    return {
      hasTrace: true,
      source,
      dx: Number(trace.dx ?? 0),
      dy: Number(trace.dy ?? 0),
      pngWidth: dims.w,
      pngHeight: dims.h,
    };
  });
}

test.describe("Image LOD display", () => {
  test.setTimeout(300_000);

  test("decimates the display bitmap while keeping full-resolution data", async ({
    page,
  }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("[browser:error]", msg.text());
    });

    await page.goto("/");
    await waitForRuntimeReady(page);
    await page.getByRole("tab", { name: "Images" }).click();

    // Create a 2048² ramp where pixel (row j, col i) == i, so a column index
    // maps to a known z value (used to assert full-res fidelity).
    const oid = await page.evaluate(
      ({ side, title }) => {
        const runtime = (
          window as unknown as {
            runtime: { runPython: (c: string) => Promise<unknown> };
          }
        ).runtime;
        // ``add_image_from_array`` returns the new object id.
        return runtime.runPython(
          `import numpy as np\n` +
            `add_image_from_array(${JSON.stringify(title)}, ` +
            `np.tile(np.arange(${side}, dtype=float), (${side}, 1)))`,
        ) as Promise<string>;
      },
      { side: SIDE, title: TITLE },
    );
    expect(typeof oid).toBe("string");

    // Refresh the tree (objects created via runtime bypass React state) and
    // select the image so the single-image viewer mounts.
    await page.getByRole("tab", { name: "Signals" }).click();
    await page.waitForTimeout(150);
    await page.getByRole("tab", { name: "Images" }).click();
    await page
      .locator(".object-tree-item")
      .filter({ hasText: TITLE })
      .first()
      .click();

    // Wait for the decimated bitmap to be encoded.
    await expect
      .poll(async () => (await readImageTrace(page)).hasTrace, {
        timeout: 30_000,
      })
      .toBe(true);

    const zoomedOut = await readImageTrace(page);
    // The PNG is decimated to ~viewport size, far below the 2048² source.
    expect(zoomedOut.pngWidth).toBeGreaterThan(0);
    expect(zoomedOut.pngWidth).toBeLessThan(SIDE);
    // Stride > 1 → each display cell spans several native pixels.
    expect(zoomedOut.dx).toBeGreaterThan(1);

    // Full-resolution data is untouched: still 2048² with exact values.
    const full = await page.evaluate((id) => {
      const runtime = (
        window as unknown as {
          runtime: {
            getImageData: (
              i: string,
            ) => Promise<{ width: number; height: number; data: number[][] }>;
          };
        }
      ).runtime;
      return runtime.getImageData(id).then((d) => ({
        width: d.width,
        height: d.height,
        sample: d.data[5][20],
      }));
    }, oid);
    expect(full.width).toBe(SIDE);
    expect(full.height).toBe(SIDE);
    expect(full.sample).toBe(20); // ramp value at column 20.

    // ---------------------------------------------------------------
    // Zoom in (real box-zoom drag) → finer, near-1:1 rasterisation.
    // ---------------------------------------------------------------
    const dragLayer = page
      .locator(".image-plot-host .js-plotly-plot .nsewdrag")
      .first();
    const box = await dragLayer.boundingBox();
    if (!box) throw new Error("drag layer not found");
    // Drag a small box near the top-left of the plot to zoom into a window
    // of a few dozen native pixels.
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 60, { steps: 8 });
    await page.mouse.up();

    // Wait for the debounced re-raster to produce a finer bitmap.
    await expect
      .poll(async () => (await readImageTrace(page)).dx, { timeout: 15_000 })
      .toBeLessThan(zoomedOut.dx);

    const zoomedIn = await readImageTrace(page);
    // Native spacing restored (stride ≈ 1) and a smaller PNG — pixels 1:1.
    expect(zoomedIn.dx).toBeLessThanOrEqual(1.5);
    expect(zoomedIn.pngWidth).toBeGreaterThan(0);
    expect(zoomedIn.pngWidth).toBeLessThan(zoomedOut.pngWidth);
  });
});
