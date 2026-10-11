/**
 * Signal and image plot interactions that rely on Plotly behaviour outside
 * its TypeScript declarations: PNG capture of the visible plot (the AI
 * assistant's ``capture_view`` tool, through ``window.Plotly.toImage``) and
 * signal ROI rectangles dragged in the plot, whose new bounds must reach the
 * runtime.
 */
import { expect, test, type Page } from "@playwright/test";

import { waitForRuntimeReady } from "./fixtures";

const SIGNAL = "plot_interactions_signal";
const IMAGE = "plot_interactions_image";

interface RuntimeApi {
  addSignalFromArrays(params: {
    title: string;
    xdata: number[];
    ydata: number[];
  }): Promise<string>;
  setSignalRoi(
    id: string,
    segments: { xmin: number; xmax: number; title?: string }[],
  ): Promise<unknown>;
  getSignalRoi(id: string): Promise<{ xmin: number; xmax: number }[]>;
  runPython(code: string): Promise<unknown>;
}

async function selectObject(
  page: Page,
  tab: "Signals" | "Images",
  title: string,
): Promise<void> {
  // Runtime-created objects bypass React state: switch tabs to refresh.
  await page
    .getByRole("tab", { name: tab === "Signals" ? "Images" : "Signals" })
    .click();
  await page.getByRole("tab", { name: tab }).click();
  await page
    .locator(".object-tree-item")
    .filter({ hasText: title })
    .first()
    .click({ timeout: 30_000 });
}

/** Capture a panel through the AI assistant's capture module and return the
 *  PNG size and the number of distinct colours found in it. */
async function capture(
  page: Page,
  panel: "signal" | "image",
): Promise<{ width: number; height: number; colours: number }> {
  return page.evaluate(async (kind) => {
    // Same module instance as the app: the dev server serves one URL.
    const mod = await import("/src/aiassistant/plotCapture.ts");
    const shot = await mod.capturePlotPng({ panel: kind });
    const img = new Image();
    img.src = shot.dataUrl;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2-D context");
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const colours = new Set<number>();
    for (let i = 0; i < pixels.length && colours.size < 64; i += 4 * 7) {
      colours.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
    }
    return {
      width: canvas.width,
      height: canvas.height,
      colours: colours.size,
    };
  }, panel);
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

test.describe("Plot interactions beyond Plotly's typings", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(300_000);

  let page: Page;
  let signalId: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1_600, height: 900 } });
    await page.goto("/");
    await waitForRuntimeReady(page);
    signalId = await page.evaluate(async (title) => {
      const runtime = (window as unknown as { runtime: RuntimeApi }).runtime;
      const xdata = Array.from({ length: 201 }, (_, i) => i / 2);
      const ydata = xdata.map((x) => Math.sin(x / 8));
      return runtime.addSignalFromArrays({ title, xdata, ydata });
    }, SIGNAL);
    await page.evaluate(async (title) => {
      const runtime = (window as unknown as { runtime: RuntimeApi }).runtime;
      await runtime.runPython(
        `import numpy as np\n` +
          `add_image_from_array(${JSON.stringify(title)}, ` +
          `np.add.outer(np.arange(64.0), np.arange(64.0)))`,
      );
    }, IMAGE);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("captures the visible signal and image plots as PNG", async () => {
    await selectObject(page, "Signals", SIGNAL);
    await expect(
      page.locator(".signal-plot-host .scatterlayer .trace .js-line"),
    ).toBeVisible({ timeout: 30_000 });
    const signal = await capture(page, "signal");
    expect(signal.width).toBeGreaterThan(100);
    expect(signal.height).toBeGreaterThan(100);
    expect(signal.colours).toBeGreaterThan(2);

    await selectObject(page, "Images", IMAGE);
    await expect(
      page.locator(".image-plot-host .js-plotly-plot .nsewdrag").first(),
    ).toBeVisible({ timeout: 30_000 });
    const image = await capture(page, "image");
    expect(image.width).toBeGreaterThan(100);
    // The colormapped gradient must be part of the capture, not only axes.
    expect(image.colours).toBeGreaterThan(16);
  });

  test("a signal ROI dragged in the plot updates the runtime", async () => {
    await page.evaluate(async (id) => {
      const runtime = (window as unknown as { runtime: RuntimeApi }).runtime;
      await runtime.setSignalRoi(id, [{ xmin: 20, xmax: 40, title: "r" }]);
    }, signalId);
    await selectObject(page, "Images", IMAGE);
    await selectObject(page, "Signals", SIGNAL);
    await openTopMenu(page, "ROI");
    await page
      .locator(".menu-dropdown")
      .getByRole("menuitem", { name: /Edit regions of interest/i })
      .first()
      .click();
    await expect(page.locator(".roi-floating")).toBeVisible({
      timeout: 15_000,
    });
    // A drag must move the existing ROI, not draw a new one.
    const armed = page.locator(".roi-floating button.active[title^='Draw']");
    if ((await armed.count()) > 0) await armed.first().click();

    const shape = page
      .locator(".signal-plot-host .layer-above .shapelayer path")
      .first();
    await expect(shape).toBeVisible({ timeout: 15_000 });
    const plot = await page
      .locator(".signal-plot-host .nsewdrag")
      .first()
      .boundingBox();
    const box = await shape.boundingBox();
    if (!plot || !box) throw new Error("signal plot or ROI shape not found");
    const sx = box.x + box.width / 2;
    const sy = box.y + box.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + plot.width * 0.2, sy, { steps: 12 });
    await page.mouse.up();

    await expect
      .poll(
        async () =>
          page.evaluate(async (id) => {
            const runtime = (window as unknown as { runtime: RuntimeApi })
              .runtime;
            return (await runtime.getSignalRoi(id))[0]?.xmin ?? null;
          }, signalId),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(25);
    const [segment] = await page.evaluate(
      async (id) =>
        (window as unknown as { runtime: RuntimeApi }).runtime.getSignalRoi(id),
      signalId,
    );
    // A move keeps the width: only the position changes.
    expect(segment.xmax - segment.xmin).toBeCloseTo(20, 0);
  });
});
