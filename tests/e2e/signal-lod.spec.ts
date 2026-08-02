/** End-to-end coverage for faithful signal level-of-detail (LOD) rendering. */
import { expect, test, type Page } from "@playwright/test";

import { waitForRuntimeReady } from "./fixtures";

const SIZE = 100_000;
const TITLE = "signal-lod-probe";
const HIGH_INDEX = 43_210;
const LOW_INDEX = HIGH_INDEX + 1;

interface TraceInfo {
  pointCount: number;
  axisWidth: number;
  hasHigh: boolean;
  hasLow: boolean;
  consecutive: boolean;
}

async function readTrace(page: Page): Promise<TraceInfo> {
  return page.evaluate((title) => {
    const graph = document.querySelector(
      ".signal-plot-host .js-plotly-plot",
    ) as
      | (HTMLElement & {
          data?: Array<{
            name?: string;
            x?: ArrayLike<number>;
            y?: ArrayLike<number>;
          }>;
          _fullLayout?: { xaxis?: { _length?: number } };
        })
      | null;
    const trace = graph?.data?.find((candidate) => candidate.name === title);
    const x = Array.from(trace?.x ?? []);
    const y = Array.from(trace?.y ?? []);
    return {
      pointCount: x.length,
      axisWidth: Number(graph?._fullLayout?.xaxis?._length ?? 0),
      hasHigh: y.includes(500),
      hasLow: y.includes(-400),
      consecutive:
        x.length > 1 &&
        x.every(
          (value, index) =>
            index === 0 || Math.abs(value - x[index - 1] - 1) < 1e-9,
        ),
    };
  }, TITLE);
}

test.describe("Signal level-of-detail (LOD) display", () => {
  test.setTimeout(300_000);
  test.use({ viewport: { width: 1_920, height: 900 } });

  test("bounds overview points and restores exact samples after zoom", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForRuntimeReady(page);
    await page.getByRole("tab", { name: "Signals" }).click();

    const oid = await page.evaluate(
      async ({ size, title, highIndex, lowIndex }) => {
        const runtime = (
          window as unknown as {
            runtime: {
              addSignalFromArrays: (params: {
                title: string;
                xdata: Float64Array;
                ydata: Float64Array;
              }) => Promise<string>;
            };
          }
        ).runtime;
        const xdata = Float64Array.from({ length: size }, (_, index) => index);
        const ydata = Float64Array.from({ length: size }, (_, index) =>
          Math.sin(index * 0.01),
        );
        ydata[highIndex] = 500;
        ydata[lowIndex] = -400;
        return runtime.addSignalFromArrays({ title, xdata, ydata });
      },
      { size: SIZE, title: TITLE, highIndex: HIGH_INDEX, lowIndex: LOW_INDEX },
    );

    // Runtime-created objects bypass React state, so refresh the object tree.
    await page.getByRole("tab", { name: "Images" }).click();
    await page.getByRole("tab", { name: "Signals" }).click();
    await page
      .locator(".object-tree-item")
      .filter({ hasText: TITLE })
      .first()
      .click();

    const line = page.locator(
      ".signal-plot-host .scatterlayer .trace .js-line",
    );
    await expect(line).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => {
        const trace = await readTrace(page);
        return (
          trace.axisWidth > 0 &&
          trace.pointCount > 0 &&
          trace.pointCount <= trace.axisWidth * 2 + 2 &&
          trace.hasHigh &&
          trace.hasLow
        );
      })
      .toBe(true);

    const overview = await readTrace(page);
    expect(overview.consecutive).toBe(false);

    const zoomButton = page.locator(
      '.signal-plot-host .modebar-btn[data-title="Zoom"]',
    );
    await zoomButton.click();
    const dragLayer = page.locator(".signal-plot-host .nsewdrag").first();
    const box = await dragLayer.boundingBox();
    if (!box) throw new Error("signal drag layer not found");
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.8, {
      steps: 8,
    });
    await page.mouse.up();

    await expect
      .poll(async () => (await readTrace(page)).consecutive, {
        timeout: 15_000,
      })
      .toBe(true);
    const zoomed = await readTrace(page);
    expect(zoomed.pointCount).toBeGreaterThanOrEqual(2);
    expect(zoomed.pointCount).toBeLessThanOrEqual(zoomed.axisWidth * 4 + 2);

    const raw = await page.evaluate(
      async ({ id, highIndex, lowIndex }) => {
        const runtime = (
          window as unknown as {
            runtime: {
              getSignalData: (
                oid: string,
              ) => Promise<{ size: number; y: ArrayLike<number> }>;
            };
          }
        ).runtime;
        const signal = await runtime.getSignalData(id);
        return {
          size: signal.size,
          high: signal.y[highIndex],
          low: signal.y[lowIndex],
        };
      },
      { id: oid, highIndex: HIGH_INDEX, lowIndex: LOW_INDEX },
    );
    expect(raw).toEqual({ size: SIZE, high: 500, low: -400 });
  });
});
