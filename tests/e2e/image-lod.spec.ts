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
 *  3. Zooming to a few pixels re-rasterises them: every visible pixel is
 *     painted (stride 1) and magnified by an integer factor into sharp blocks
 *     (nearest pixel), drawn on screen without smoothing.
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
  x: number;
  y: number;
  sizex: number;
  sizey: number;
  dx: number;
  dy: number;
  pngWidth: number;
  pngHeight: number;
}

/** Read the bitmap ``layout.images`` background of the single-image viewer
 *  and decode its PNG ``source`` dimensions.  The bitmap used to be an
 *  ``image`` trace but is now a layout image (so the axes carry no constraint
 *  and can be panned in both directions).  The per-cell spacing ``dx``/``dy``
 *  is recovered as ``sizex / pngWidth`` / ``sizey / pngHeight``. */
async function readImageTrace(page: Page): Promise<TraceInfo> {
  return page.evaluate(async () => {
    const gd = document.querySelector(".image-plot-host .js-plotly-plot") as
      | (HTMLElement & { layout?: { images?: Array<Record<string, unknown>> } })
      | null;
    const img = gd?.layout?.images?.[0];
    if (!img) {
      return {
        hasTrace: false,
        source: "",
        x: 0,
        y: 0,
        sizex: 0,
        sizey: 0,
        dx: 0,
        dy: 0,
        pngWidth: 0,
        pngHeight: 0,
      };
    }
    const source = String(img.source ?? "");
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => resolve({ w: 0, h: 0 });
      im.src = source;
    });
    const sizex = Number(img.sizex ?? 0);
    const sizey = Number(img.sizey ?? 0);
    return {
      hasTrace: true,
      source,
      x: Number(img.x ?? 0),
      y: Number(img.y ?? 0),
      sizex,
      sizey,
      dx: dims.w > 0 ? sizex / dims.w : 0,
      dy: dims.h > 0 ? sizey / dims.h : 0,
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
    // ``x0 = y0 = 0`` is the center of the first pixel: the bitmap starts at
    // its outer edge, half a pixel before.
    expect(zoomedOut.x).toBe(-0.5);
    expect(zoomedOut.y).toBe(-0.5);
    expect(zoomedOut.sizex).toBeGreaterThanOrEqual(SIDE);
    expect(zoomedOut.sizey).toBeGreaterThanOrEqual(SIDE);
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
    // Every visible pixel painted (stride 1, one cell per unit-spaced pixel)
    // and magnified by an integer factor into sharp blocks.
    expect(Number.isInteger(zoomedIn.sizex)).toBe(true);
    expect(Number.isInteger(zoomedIn.sizey)).toBe(true);
    const zoomX = zoomedIn.pngWidth / zoomedIn.sizex;
    const zoomY = zoomedIn.pngHeight / zoomedIn.sizey;
    expect(Number.isInteger(zoomX) && zoomX >= 2).toBe(true);
    expect(Number.isInteger(zoomY) && zoomY >= 2).toBe(true);
    // The windowed bitmap starts on a pixel edge (center ± 0.5).
    expect(Number.isInteger(zoomedIn.x + 0.5)).toBe(true);
    expect(Number.isInteger(zoomedIn.y + 0.5)).toBe(true);
  });

  test("draws zoomed-in pixels as sharp blocks (nearest pixel)", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForRuntimeReady(page);
    await page.getByRole("tab", { name: "Images" }).click();
    // 8×8 checkerboard: any smoothing would show colours between the two.
    await page.evaluate(() => {
      const runtime = (
        window as unknown as {
          runtime: { runPython: (c: string) => Promise<unknown> };
        }
      ).runtime;
      return runtime.runPython(
        `import numpy as np\n` +
          `add_image_from_array("crisp_probe", ` +
          `(np.indices((8, 8)).sum(axis=0) % 2).astype(float))`,
      );
    });
    await page.getByRole("tab", { name: "Signals" }).click();
    await page.waitForTimeout(150);
    await page.getByRole("tab", { name: "Images" }).click();
    await page
      .locator(".object-tree-item")
      .filter({ hasText: "crisp_probe" })
      .first()
      .click();
    await expect
      .poll(async () => (await readImageTrace(page)).pngWidth, {
        timeout: 30_000,
      })
      .toBeGreaterThan(8);

    // The 8 pixels are magnified by an integer factor in the bitmap itself
    // (so exported images are sharp too), without blending.
    const trace = await readImageTrace(page);
    expect(trace.sizex).toBe(8);
    const zoom = trace.pngWidth / 8;
    expect(Number.isInteger(zoom) && zoom >= 2).toBe(true);
    const bitmapColours = await page.evaluate(async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      const colours = new Set<number>();
      for (let p = 0; p < data.data.length; p += 4) {
        colours.add(
          (data.data[p] << 16) | (data.data[p + 1] << 8) | data.data[p + 2],
        );
      }
      return colours.size;
    }, trace.source);
    expect(bitmapColours).toBe(2);

    // On screen, the enlarged bitmap is drawn with nearest-pixel scaling:
    // a row across the image holds only the two checkerboard colours.
    const bitmap = page
      .locator(".image-plot-host .layer-subplot .imagelayer image")
      .first();
    expect(
      await bitmap.evaluate((node) => getComputedStyle(node).imageRendering),
    ).toBe("pixelated");
    const box = await bitmap.boundingBox();
    if (!box) throw new Error("bitmap not rendered");
    const row = await page.screenshot({
      clip: {
        x: Math.ceil(box.x) + 1,
        y: Math.round(box.y + box.height * (3.5 / 8)),
        width: Math.floor(box.width) - 3,
        height: 1,
      },
    });
    const screenColours = await page.evaluate(async (png) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, 1).data;
      const colours = new Set<number>();
      for (let p = 0; p < data.length; p += 4) {
        colours.add((data[p] << 16) | (data[p + 1] << 8) | data[p + 2]);
      }
      return colours.size;
    }, row.toString("base64"));
    expect(screenColours).toBe(2);
  });
});
