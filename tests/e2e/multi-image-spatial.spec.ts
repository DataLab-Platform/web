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
