/**
 * Regression spec for the single-image viewer's zoom / pan interactions.
 *
 * The uniform-image bitmap is drawn as a ``layout.images`` background rather
 * than a Plotly ``image`` trace.  An image trace forces a ``scaleanchor``
 * constraint that ties the Y axis fully to X, which made the Y axis
 * un-pannable (only horizontal pan worked).  A layout image imposes no such
 * constraint, so — together with our manual aspect-fit (square pixels) and
 * manual pan handler — the view can be panned in BOTH directions.
 *
 * Invariants under test:
 *  1. The bitmap renders as a single ``layout.images`` entry (no ``image``
 *     trace).
 *  2. Box-zoom shrinks the visible range.
 *  3. With the Pan tool armed, a horizontal drag translates X (Y fixed) and a
 *     vertical drag translates Y (X fixed) — the drag mode stays "pan".
 */
import { test, expect, type Page } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

const SIDE = 512;
const TITLE = "pan2d_probe";

interface View {
  x: [number, number];
  y: [number, number];
  dragmode: string;
  nImages: number;
  hasImageTrace: boolean;
}

async function readView(page: Page): Promise<View> {
  return page.evaluate(() => {
    const gd = document.querySelector(".image-plot-host .js-plotly-plot") as
      | (HTMLElement & {
          _fullLayout?: {
            xaxis?: { range?: [number, number] };
            yaxis?: { range?: [number, number] };
            dragmode?: string;
          };
          layout?: { images?: unknown[] };
          data?: Array<{ type?: string }>;
        })
      | null;
    const fl = gd?._fullLayout;
    return {
      x: (fl?.xaxis?.range ?? [0, 0]) as [number, number],
      y: (fl?.yaxis?.range ?? [0, 0]) as [number, number],
      dragmode: String(fl?.dragmode ?? ""),
      nImages: gd?.layout?.images?.length ?? 0,
      hasImageTrace: !!gd?.data?.find((t) => t.type === "image"),
    };
  });
}

test.describe("Image viewer zoom/pan", () => {
  test.setTimeout(300_000);

  test("layout-image render, box-zoom, and 2-D pan", async ({ page }) => {
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
    await page.getByRole("tab", { name: "Signals" }).click();
    await page.waitForTimeout(150);
    await page.getByRole("tab", { name: "Images" }).click();
    await page
      .locator(".object-tree-item")
      .filter({ hasText: TITLE })
      .first()
      .click();

    const dragLayer = page
      .locator(".image-plot-host .js-plotly-plot .nsewdrag")
      .first();
    await expect(dragLayer).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await readView(page)).nImages).toBe(1);

    const initial = await readView(page);
    expect(initial.hasImageTrace).toBe(false);
    const fullSpanX = Math.abs(initial.x[1] - initial.x[0]);

    // Box-zoom.
    let box = await dragLayer.boundingBox();
    if (!box) throw new Error("no drag layer box");
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65, {
      steps: 10,
    });
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect(
      Math.abs((await readView(page)).x[1] - (await readView(page)).x[0]),
    ).toBeLessThan(fullSpanX * 0.8);

    // Arm the Pan tool.
    await page
      .locator('.image-plot-host .modebar-btn[data-title="Pan"]')
      .first()
      .click();
    await page.waitForTimeout(100);
    expect((await readView(page)).dragmode).toBe("pan");

    // Horizontal pan: X translates, Y fixed.
    const beforeH = await readView(page);
    box = await dragLayer.boundingBox();
    if (!box) throw new Error("no drag layer box (H)");
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5, {
      steps: 15,
    });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const afterH = await readView(page);
    expect(afterH.dragmode).toBe("pan");
    // Dragging left ⇒ content follows ⇒ view shows larger X (range grows).
    expect(afterH.x[0]).toBeGreaterThan(beforeH.x[0] + 1);
    expect(afterH.y[0]).toBeCloseTo(beforeH.y[0], 1);

    // Vertical pan: Y translates, X fixed.
    const beforeV = await readView(page);
    box = await dragLayer.boundingBox();
    if (!box) throw new Error("no drag layer box (V)");
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, {
      steps: 15,
    });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const afterV = await readView(page);
    expect(afterV.dragmode).toBe("pan");
    // Dragging down ⇒ content follows ⇒ view shows smaller Y (range shrinks).
    // ``y[0]`` is the bottom (larger) end of the reversed image Y axis.
    expect(afterV.y[0]).toBeLessThan(beforeV.y[0] - 1);
    expect(afterV.x[0]).toBeCloseTo(beforeV.x[0], 1);
  });
});
