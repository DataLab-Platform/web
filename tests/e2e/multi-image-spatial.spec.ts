/**
 * Regression spec for the multi-image "Spatial" overlay view.
 *
 * Like the single-image viewer, the uniform-image bitmaps are drawn as
 * ``layout.images`` backgrounds (no ``scaleanchor`` constraint) so the axes
 * pan freely, and the view state (zoom / pan / drag mode) is captured so that
 * re-renders from the hover read-out no longer revert it.  Regressions this
 * guards against:
 *  - the Pan tool disarming itself the instant the pointer moved;
 *  - vertical pan being blocked or inverted;
 *  - "Autoscale" snapping back to the previous zoom on the next hover.
 */
import { test, type Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

const SIDE = 128;
const LOD_SIDE = 2048;
const LOD_TITLES = ["spLodA", "spLodB", "spLodC", "spLodD"];

interface BitmapInfo {
  source: string;
  x: number;
  y: number;
  sizex: number;
  sizey: number;
  width: number;
  height: number;
  firstRed: number;
}

async function readView(page: Page) {
  return page.evaluate(() => {
    const gd = document.querySelector(
      ".multi-image-spatial-wrap .js-plotly-plot",
    ) as
      | (HTMLElement & {
          _fullLayout?: {
            xaxis?: { range?: [number, number] };
            yaxis?: { range?: [number, number] };
            dragmode?: string;
          };
          layout?: { images?: unknown[] };
        })
      | null;
    const fl = gd?._fullLayout;
    return {
      x: (fl?.xaxis?.range ?? [0, 0]) as [number, number],
      y: (fl?.yaxis?.range ?? [0, 0]) as [number, number],
      dragmode: String(fl?.dragmode ?? ""),
      nImages: gd?.layout?.images?.length ?? 0,
    };
  });
}

async function readSpatialBitmaps(page: Page): Promise<BitmapInfo[]> {
  return page.evaluate(async () => {
    const gd = document.querySelector(
      ".multi-image-spatial-wrap .js-plotly-plot",
    ) as
      | (HTMLElement & { layout?: { images?: Array<Record<string, unknown>> } })
      | null;
    const images = gd?.layout?.images ?? [];
    return Promise.all(
      images.map(async (item) => {
        const source = String(item.source ?? "");
        const decoded = await new Promise<{
          width: number;
          height: number;
          firstRed: number;
        }>((resolve) => {
          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d");
            context?.drawImage(image, 0, 0);
            resolve({
              width: image.naturalWidth,
              height: image.naturalHeight,
              firstRed: context?.getImageData(0, 0, 1, 1).data[0] ?? -1,
            });
          };
          image.onerror = () => resolve({ width: 0, height: 0, firstRed: -1 });
          image.src = source;
        });
        return {
          source,
          x: Number(item.x),
          y: Number(item.y),
          sizex: Number(item.sizex),
          sizey: Number(item.sizey),
          ...decoded,
        };
      }),
    );
  });
}

test("spatial multi-image: pan stays armed, 2-D pan, autoscale persists", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await waitForRuntimeReady(page);
  await page.getByRole("tab", { name: "Images" }).click();
  await page.evaluate(
    ({ side }) => {
      const runtime = (
        window as unknown as {
          runtime: { runPython: (c: string) => Promise<unknown> };
        }
      ).runtime;
      return runtime.runPython(
        `import numpy as np\n` +
          `a = np.tile(np.arange(${side}, dtype=float), (${side}, 1))\n` +
          `add_image_from_array("spA", a)\n` +
          `add_image_from_array("spB", a.T)`,
      );
    },
    { side: SIDE },
  );
  await page.getByRole("tab", { name: "Signals" }).click();
  await page.waitForTimeout(150);
  await page.getByRole("tab", { name: "Images" }).click();

  // Select both images (multi-select).
  await page
    .locator(".object-tree-item")
    .filter({ hasText: "spA" })
    .first()
    .click();
  await page
    .locator(".object-tree-item")
    .filter({ hasText: "spB" })
    .first()
    .click({ modifiers: ["Control"] });

  // Switch to the Spatial overlay.
  await page.getByRole("button", { name: "Spatial" }).click();
  const plot = page.locator(".multi-image-spatial-wrap .js-plotly-plot");
  await expect(plot).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await readView(page)).nImages)
    .toBeGreaterThan(0);

  const dragLayer = page
    .locator(".multi-image-spatial-wrap .js-plotly-plot .nsewdrag")
    .first();

  // Arm Pan and verify it stays armed (the bug: it disarmed instantly).
  await page
    .locator('.multi-image-spatial-wrap .modebar-btn[data-title="Pan"]')
    .first()
    .click();
  await page.waitForTimeout(100);
  // A mouse move used to disarm pan (re-render reset dragmode) — move first.
  let box = await dragLayer.boundingBox();
  if (!box) throw new Error("no drag box");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(100);
  expect((await readView(page)).dragmode).toBe("pan");

  // Horizontal pan.
  const beforeH = await readView(page);
  box = await dragLayer.boundingBox();
  if (!box) throw new Error("no drag box (H)");
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5, {
    steps: 15,
  });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterH = await readView(page);
  expect(afterH.dragmode).toBe("pan");
  expect(afterH.x[0]).toBeGreaterThan(beforeH.x[0] + 0.5);
  expect(afterH.y[0]).toBeCloseTo(beforeH.y[0], 0);

  // Vertical pan.
  const beforeV = await readView(page);
  box = await dragLayer.boundingBox();
  if (!box) throw new Error("no drag box (V)");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, {
    steps: 15,
  });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterV = await readView(page);
  expect(afterV.dragmode).toBe("pan");
  expect(afterV.y[0]).toBeLessThan(beforeV.y[0] - 0.5);
  expect(afterV.x[0]).toBeCloseTo(beforeV.x[0], 0);

  // Autoscale must persist across a subsequent hover (the bug: hover reverted
  // to the previous zoom).
  await page
    .locator('.multi-image-spatial-wrap .modebar-btn[data-title="Autoscale"]')
    .first()
    .click();
  await page.waitForTimeout(300);
  const autoscaled = await readView(page);
  box = await dragLayer.boundingBox();
  if (!box) throw new Error("no drag box (hover)");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(300);
  const afterHover = await readView(page);
  expect(afterHover.x[0]).toBeCloseTo(autoscaled.x[0], 0);
  expect(afterHover.x[1]).toBeCloseTo(autoscaled.x[1], 0);
});

test("spatial multi-image: four 2048² images use viewport LOD and exact zoom", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await waitForRuntimeReady(page);
  await page.getByRole("tab", { name: "Images" }).click();
  await page.evaluate(
    ({ side, titles }) => {
      const runtime = (
        window as unknown as {
          runtime: { runPython: (code: string) => Promise<unknown> };
        }
      ).runtime;
      return runtime.runPython(
        `import numpy as np\n` +
          `arr = np.tile(np.arange(${side}, dtype=np.float32), (${side}, 1))\n` +
          `positions = [(0, 0), (${side}, 0), (0, ${side}), (${side}, ${side})]\n` +
          `titles = ${JSON.stringify(titles)}\n` +
          `for title, (x0, y0) in zip(titles, positions):\n` +
          `    oid = add_image_from_array(title, arr)\n` +
          `    obj = _MODEL.get(oid)\n` +
          `    obj.x0, obj.y0 = x0, y0\n` +
          `    set_colormap(oid, "gray", False)`,
      );
    },
    { side: LOD_SIDE, titles: LOD_TITLES },
  );
  await page.getByRole("tab", { name: "Signals" }).click();
  await page.getByRole("tab", { name: "Images" }).click();

  for (let index = 0; index < LOD_TITLES.length; index += 1) {
    await page
      .locator(".object-tree-item")
      .filter({ hasText: LOD_TITLES[index] })
      .first()
      .click(index === 0 ? {} : { modifiers: ["Control"] });
  }
  await page.getByRole("button", { name: "Spatial" }).click();
  await expect
    .poll(async () => (await readSpatialBitmaps(page)).length, {
      timeout: 30_000,
    })
    .toBe(4);

  const initial = await readSpatialBitmaps(page);
  // Primary image first, then the remaining selected images. Layout-image
  // array order is the z-order used by Plotly (later entries draw on top).
  expect(initial.map(({ x, y }) => [x, y])).toEqual([
    [LOD_SIDE, LOD_SIDE],
    [0, 0],
    [LOD_SIDE, 0],
    [0, LOD_SIDE],
  ]);
  expect(
    initial.every(({ width, height }) => width <= 512 && height <= 512),
  ).toBe(true);
  expect(
    initial.every(
      ({ sizex, sizey }) =>
        sizex >= LOD_SIDE &&
        sizex <= LOD_SIDE + 8 &&
        sizey >= LOD_SIDE &&
        sizey <= LOD_SIDE + 8,
    ),
  ).toBe(true);

  // The current image is the only full-resolution bridge payload; its LOD
  // bitmap is smaller than the 512-pixel previews of the other images.
  const fullResolution = initial.reduce((best, item) =>
    item.width < best.width ? item : best,
  );
  const zoomBox = await page.evaluate(({ x, y }) => {
    const gd = document.querySelector(
      ".multi-image-spatial-wrap .js-plotly-plot",
    ) as
      | (HTMLElement & {
          _fullLayout?: {
            xaxis?: { c2p: (value: number) => number; _offset: number };
            yaxis?: { c2p: (value: number) => number; _offset: number };
          };
        })
      | null;
    const xaxis = gd?._fullLayout?.xaxis;
    const yaxis = gd?._fullLayout?.yaxis;
    if (!gd || !xaxis || !yaxis) return null;
    const rect = gd.getBoundingClientRect();
    return {
      x0: rect.left + xaxis._offset + xaxis.c2p(x + 100),
      x1: rect.left + xaxis._offset + xaxis.c2p(x + 356),
      y0: rect.top + yaxis._offset + yaxis.c2p(y + 100),
      y1: rect.top + yaxis._offset + yaxis.c2p(y + 356),
    };
  }, fullResolution);
  if (!zoomBox) throw new Error("Plotly axes unavailable");
  await page.mouse.move(zoomBox.x0, zoomBox.y0);
  await page.mouse.down();
  await page.mouse.move(zoomBox.x1, zoomBox.y1, { steps: 10 });
  await page.mouse.up();

  await expect
    .poll(
      async () => {
        const bitmaps = await readSpatialBitmaps(page);
        if (
          bitmaps.length !== 1 ||
          bitmaps[0].width <= 0 ||
          bitmaps[0].height <= 0
        ) {
          return Number.POSITIVE_INFINITY;
        }
        return Math.max(
          bitmaps[0].sizex / bitmaps[0].width,
          bitmaps[0].sizey / bitmaps[0].height,
        );
      },
      { timeout: 15_000 },
    )
    .toBeLessThanOrEqual(1.5);
  const zoomed = (await readSpatialBitmaps(page))[0];
  expect(zoomed.width).toBeGreaterThan(0);
  expect(zoomed.sizex / zoomed.width).toBeLessThanOrEqual(1.5);
  expect(zoomed.sizey / zoomed.height).toBeLessThanOrEqual(1.5);
  const sourceColumn = Math.round(zoomed.x - fullResolution.x);
  const expectedRed = Math.round((sourceColumn / (LOD_SIDE - 1)) * 255);
  expect(Math.abs(zoomed.firstRed - expectedRed)).toBeLessThanOrEqual(2);
});
