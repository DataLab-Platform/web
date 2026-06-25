/**
 * Regression spec for LIVE image-ROI editing.
 *
 * Plotly emits no ``plotly_relayouting`` stream while an image-trace shape is
 * dragged (only the final geometry on mouse release), so DataLab-Web drives
 * ROI move/resize manually for continuous feedback (see the manual drag
 * handler in ``ImagePlot.tsx``). The invariant under test: the on-screen
 * shape geometry (``gd._fullLayout.shapes``) updates DURING the drag — read
 * mid-gesture, before ``mouseup`` — not only after release.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

const SIDE = 512;
const TITLE = "roi_live_drag";

interface Shape0 {
  type?: string;
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  path?: string;
}

async function readShape0(page: Page): Promise<Shape0 | null> {
  return page.evaluate(() => {
    const gd = document.querySelector(".image-plot-host .js-plotly-plot") as
      | (HTMLElement & { _fullLayout?: { shapes?: Shape0[] } })
      | null;
    const s = gd?._fullLayout?.shapes?.[0];
    return s
      ? { type: s.type, x0: s.x0, x1: s.x1, y0: s.y0, y1: s.y1, path: s.path }
      : null;
  });
}

async function openTopMenu(page: Page, key: string): Promise<void> {
  const top = page.locator(`[data-menu-top="${key}"]`);
  await top.hover();
  await page.waitForTimeout(120);
  if ((await top.getAttribute("aria-expanded")) !== "true") {
    await top.click();
    await page.waitForTimeout(120);
  }
}

/** Create a uniform image, select it, and enter ROI edit mode. */
async function setupRoiEdit(page: Page): Promise<Locator> {
  await page.goto("/");
  await waitForRuntimeReady(page);
  await page.getByRole("tab", { name: "Images" }).click();
  await page.evaluate(
    ({ side, title }) => {
      const runtime = (
        window as unknown as {
          runtime: { runPython: (c: string) => Promise<unknown> };
        }
      ).runtime;
      return runtime.runPython(
        `import numpy as np\n` +
          `add_image_from_array(${JSON.stringify(title)}, ` +
          `np.tile(np.arange(${side}, dtype=float), (${side}, 1)))`,
      );
    },
    { side: SIDE, title: TITLE },
  );
  // Toggle tabs to force the object tree to populate.
  await page.getByRole("tab", { name: "Signals" }).click();
  await page.waitForTimeout(150);
  await page.getByRole("tab", { name: "Images" }).click();
  await page
    .locator(".object-tree-item")
    .filter({ hasText: TITLE })
    .first()
    .click({ timeout: 30_000 });

  const dragLayer = page
    .locator(".image-plot-host .js-plotly-plot .nsewdrag")
    .first();
  await expect(dragLayer).toBeVisible({ timeout: 30_000 });

  await openTopMenu(page, "ROI");
  await page
    .locator(".menu-dropdown")
    .getByRole("menuitem", { name: /Edit regions of interest/i })
    .first()
    .click();
  await expect(page.locator(".roi-floating")).toBeVisible({ timeout: 15_000 });
  return dragLayer;
}

/** Arm a draw geometry from the floating ROI panel, trace it over the given
 *  fractional box, then disarm so the next drag is a move/resize. */
async function drawShape(
  page: Page,
  dragLayer: Locator,
  panelButtonTitle: string,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  const drawBtn = page.locator(
    `.roi-floating button[title="${panelButtonTitle}"]`,
  );
  const isArmed = async () =>
    ((await drawBtn.getAttribute("class")) ?? "").includes("active");
  // Arm the tool if not already armed (the panel toggles, and one geometry
  // may be armed by default on entering edit mode).
  if (!(await isArmed())) await drawBtn.click();
  const box = await dragLayer.boundingBox();
  if (!box) throw new Error("no drag layer box");
  await page.mouse.move(
    box.x + box.width * from[0],
    box.y + box.height * from[1],
  );
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], {
    steps: 12,
  });
  await page.mouse.up();
  await page.waitForTimeout(300);
  // Disarm the draw tool so the next drag on the shape is interpreted as a
  // move/resize rather than drawing a new ROI.
  if (await isArmed()) await drawBtn.click();
  await page.waitForTimeout(150);
}

test.describe("Image ROI live drag", () => {
  test.setTimeout(180_000);

  test("rectangle moves live (mid-drag, not only on release)", async ({
    page,
  }) => {
    const dragLayer = await setupRoiEdit(page);
    await drawShape(
      page,
      dragLayer,
      "Draw a rectangle on the plot",
      [0.3, 0.3],
      [0.6, 0.6],
    );

    const before = await readShape0(page);
    expect(before?.type).toBe("rect");

    const box = await dragLayer.boundingBox();
    if (!box) throw new Error("no drag layer box");
    // Grab the rectangle interior and drag it right+down.
    const sx = box.x + box.width * 0.45;
    const sy = box.y + box.height * 0.45;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + box.width * 0.12, sy + box.height * 0.08, {
      steps: 12,
    });

    // LIVE assertion: the shape moved before the button was released.
    const mid = await readShape0(page);
    expect(mid).not.toBeNull();
    expect(Math.abs((mid?.x0 ?? 0) - (before?.x0 ?? 0))).toBeGreaterThan(1);

    await page.mouse.move(sx + box.width * 0.16, sy + box.height * 0.1, {
      steps: 6,
    });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await readShape0(page);
    expect(after?.x0 ?? 0).toBeGreaterThan(before?.x0 ?? 0);
  });

  test("rectangle resizes live via a corner handle", async ({ page }) => {
    const dragLayer = await setupRoiEdit(page);
    await drawShape(
      page,
      dragLayer,
      "Draw a rectangle on the plot",
      [0.3, 0.3],
      [0.6, 0.6],
    );

    const before = await readShape0(page);
    const beforeW = Math.abs((before?.x1 ?? 0) - (before?.x0 ?? 0));

    const box = await dragLayer.boundingBox();
    if (!box) throw new Error("no drag layer box");
    // Grab the bottom-right corner (drawn at fraction 0.6, 0.6) and drag out.
    const sx = box.x + box.width * 0.6;
    const sy = box.y + box.height * 0.6;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + box.width * 0.15, sy + box.height * 0.15, {
      steps: 12,
    });

    const mid = await readShape0(page);
    const midW = Math.abs((mid?.x1 ?? 0) - (mid?.x0 ?? 0));
    expect(midW).toBeGreaterThan(beforeW + 1);

    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await readShape0(page);
    const afterW = Math.abs((after?.x1 ?? 0) - (after?.x0 ?? 0));
    expect(afterW).toBeGreaterThan(beforeW + 1);
  });

  test("circle moves live", async ({ page }) => {
    const dragLayer = await setupRoiEdit(page);
    await drawShape(
      page,
      dragLayer,
      "Draw a circle on the plot",
      [0.35, 0.35],
      [0.6, 0.6],
    );

    const before = await readShape0(page);
    expect(before?.type).toBe("circle");
    const beforeCx = ((before?.x0 ?? 0) + (before?.x1 ?? 0)) / 2;

    const box = await dragLayer.boundingBox();
    if (!box) throw new Error("no drag layer box");
    // Grab the circle centre and drag it.
    const sx = box.x + box.width * 0.475;
    const sy = box.y + box.height * 0.475;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + box.width * 0.12, sy + box.height * 0.05, {
      steps: 12,
    });

    const mid = await readShape0(page);
    const midCx = ((mid?.x0 ?? 0) + (mid?.x1 ?? 0)) / 2;
    expect(Math.abs(midCx - beforeCx)).toBeGreaterThan(1);

    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await readShape0(page);
    const afterCx = ((after?.x0 ?? 0) + (after?.x1 ?? 0)) / 2;
    expect(afterCx).toBeGreaterThan(beforeCx);
  });

  test("rectangle resizes live via an edge handle", async ({ page }) => {
    const dragLayer = await setupRoiEdit(page);
    await drawShape(
      page,
      dragLayer,
      "Draw a rectangle on the plot",
      [0.3, 0.3],
      [0.6, 0.6],
    );

    const before = await readShape0(page);
    const beforeW = Math.abs((before?.x1 ?? 0) - (before?.x0 ?? 0));
    const beforeH = Math.abs((before?.y1 ?? 0) - (before?.y0 ?? 0));

    const box = await dragLayer.boundingBox();
    if (!box) throw new Error("no drag layer box");
    // Grab the right edge mid-height (x=0.6, y=0.45) and drag it outward.
    const sx = box.x + box.width * 0.6;
    const sy = box.y + box.height * 0.45;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + box.width * 0.15, sy, { steps: 12 });

    const mid = await readShape0(page);
    const midW = Math.abs((mid?.x1 ?? 0) - (mid?.x0 ?? 0));
    const midH = Math.abs((mid?.y1 ?? 0) - (mid?.y0 ?? 0));
    // Width grows; height stays (edge resize is one-dimensional).
    expect(midW).toBeGreaterThan(beforeW + 1);
    expect(Math.abs(midH - beforeH)).toBeLessThan(1);

    await page.mouse.up();
  });

  test("hovering a ROI sets a move / resize cursor", async ({ page }) => {
    const dragLayer = await setupRoiEdit(page);
    await drawShape(
      page,
      dragLayer,
      "Draw a rectangle on the plot",
      [0.3, 0.3],
      [0.6, 0.6],
    );

    const box = await dragLayer.boundingBox();
    if (!box) throw new Error("no drag layer box");
    const cursorAt = async (fx: number, fy: number): Promise<string> => {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(80);
      return page.evaluate(() => {
        const el = document.querySelector(
          ".image-plot-host .js-plotly-plot .nsewdrag",
        );
        return el ? getComputedStyle(el).cursor : "";
      });
    };

    // Interior → move; right edge → horizontal resize.
    expect(await cursorAt(0.45, 0.45)).toBe("move");
    expect(await cursorAt(0.6, 0.45)).toBe("ew-resize");
    // Off the ROI → cursor is no longer our move/resize affordance.
    expect(await cursorAt(0.05, 0.05)).not.toBe("move");
  });
});
