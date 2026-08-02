/**
 * Signal-display performance baseline.
 *
 * Timings are trend-only. Deterministic invariants cover binary payload size,
 * trace count, and the number of samples handed to Plotly.
 */
import { expect, test, type Page } from "@playwright/test";
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

const SIZES = [10_000, 100_000, 500_000, 1_000_000];

interface SignalBenchResult {
  size: number;
  createMs: number;
  fetch: RuntimePayloadMetric;
  selectToVisibleMs: number;
  plotRenderCount: number;
  traceCount: number;
  plotWidth: number;
  plottedPoints: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longestTaskMs: number;
  hoverMs: number | null;
  panMs: number | null;
  zoomMs: number | null;
  relayoutCount: number;
}

async function waitForGraphHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      Boolean(
        (
          document.querySelector(".js-plotly-plot") as
            | (Element & { __dlwMetricsHooked?: boolean })
            | null
        )?.__dlwMetricsHooked,
      ),
    undefined,
    { timeout: 5_000 },
  );
}

async function readSignalPlot(page: Page, title: string) {
  return page.evaluate((traceTitle: string) => {
    const graph = document.querySelector(".js-plotly-plot") as
      | (Element & {
          data?: Array<{ name?: string; x?: ArrayLike<number> }>;
          _fullLayout?: { xaxis?: { _length?: number } };
        })
      | null;
    const traces = graph?.data ?? [];
    const trace = traces.find((candidate) => candidate.name === traceTitle);
    return {
      traceCount: traces.length,
      plotWidth: Number(graph?._fullLayout?.xaxis?._length ?? 0),
      plottedPoints: trace?.x?.length ?? 0,
    };
  }, title);
}

async function waitForSignalRender(
  page: Page,
  title: string,
  notBefore: number,
) {
  await page.waitForFunction(
    ({ traceTitle, minimumStartTime }) => {
      const metrics = (
        window as unknown as {
          __dlwPlotlyMetrics?: {
            plotRenders: Array<{
              kind: string;
              startTime: number;
            }>;
          };
        }
      ).__dlwPlotlyMetrics;
      const graph = document.querySelector(".js-plotly-plot") as
        | (Element & { data?: Array<{ name?: string }> })
        | null;
      return Boolean(
        graph?.data?.some((trace) => trace.name === traceTitle) &&
        metrics?.plotRenders.some(
          (render) =>
            render.kind === "signal" && render.startTime >= minimumStartTime,
        ),
      );
    },
    { traceTitle: title, minimumStartTime: notBefore },
    { timeout: 120_000 },
  );
  const metrics = await readPlotlyMetrics(page);
  const render = metrics.plotRenders.find(
    (candidate) =>
      candidate.kind === "signal" && candidate.startTime >= notBefore,
  );
  if (!render) throw new Error(`Missing post-selection render for ${title}`);
  return render;
}

async function measureHover(page: Page): Promise<number | null> {
  await resetPlotlyMetrics(page);
  const points = await page.evaluate(() => {
    const path = document.querySelector(
      ".js-plotly-plot .scatterlayer .trace .js-line",
    );
    if (!(path instanceof SVGGeometryElement)) return null;
    const matrix = path.getScreenCTM();
    if (!matrix) return null;
    const coordinates = [
      ...String(path.getAttribute("d") ?? "").matchAll(
        /[ML](-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?),(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/gi,
      ),
    ].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
    if (coordinates.length === 0) return null;
    return [0.15, 0.3, 0.5, 0.7, 0.85].map((fraction) => {
      const index = Math.min(
        coordinates.length - 1,
        Math.floor(coordinates.length * fraction),
      );
      const local = coordinates[index];
      const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    });
  });
  if (!points) return null;
  const startedAt = await page.evaluate(() => performance.now());
  for (const point of points) {
    await page.mouse.move(point.x, point.y);
    try {
      await page
        .locator(".js-plotly-plot .hoverlayer .hovertext")
        .first()
        .waitFor({ state: "visible", timeout: 2_000 });
      return (await page.evaluate(() => performance.now())) - startedAt;
    } catch {
      // Try another retained SVG vertex before declaring hover unavailable.
    }
  }
  return null;
}

async function measureDrag(
  page: Page,
  mode: "Pan" | "Zoom",
): Promise<number | null> {
  await page
    .locator(`.js-plotly-plot .modebar-btn[data-title="${mode}"]`)
    .first()
    .click();
  await resetPlotlyMetrics(page);
  const dragLayer = page.locator(".js-plotly-plot .nsewdrag").first();
  const box = await dragLayer.boundingBox();
  if (!box) return null;
  const startedAt = await page.evaluate(() => performance.now());
  await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.65, {
    steps: 8,
  });
  await page.mouse.up();
  try {
    await waitForNextPlotRender(page, 0, "signal", 15_000);
  } catch {
    return null;
  }
  return (await page.evaluate(() => performance.now())) - startedAt;
}

test.describe("Signal display perf", () => {
  test.setTimeout(600_000);

  test("10k to 1M samples remain measurable and interactive", async ({
    page,
  }) => {
    await installPlotlyMetrics(page);
    await page.goto("/");
    await waitForRuntimeReady(page);
    await page.getByRole("tab", { name: "Signals" }).click();

    const created = await page.evaluate(async (sizes: number[]) => {
      type Runtime = {
        addSignalFromArrays: (params: {
          title: string;
          xdata: Float64Array;
          ydata: Float64Array;
        }) => Promise<string>;
      };
      const runtime = (window as unknown as { runtime: Runtime }).runtime;
      const rows: Array<{
        id: string;
        size: number;
        title: string;
        createMs: number;
      }> = [];
      for (const size of sizes) {
        const x = new Float64Array(size);
        const y = new Float64Array(size);
        for (let index = 0; index < size; index += 1) {
          x[index] = index / Math.max(1, size - 1);
          y[index] = Math.sin(index * 0.013) + 0.15 * Math.cos(index * 0.071);
        }
        const title = `signal-perf-${size}`;
        const startedAt = performance.now();
        const id = await runtime.addSignalFromArrays({
          title,
          xdata: x,
          ydata: y,
        });
        rows.push({
          id,
          size,
          title,
          createMs: performance.now() - startedAt,
        });
      }
      return rows;
    }, SIZES);

    await page.getByRole("tab", { name: "Images" }).click();
    await page.getByRole("tab", { name: "Signals" }).click();
    const treeItems = page.locator(".object-tree-item");
    await expect.poll(() => treeItems.count(), { timeout: 30_000 }).toBe(4);

    const results: SignalBenchResult[] = [];
    for (const entry of created) {
      const fetch = await measureRuntimePayload(page, "getSignalData", [
        entry.id,
      ]);
      expect(fetch.itemCount).toBe(1);
      expect(fetch.shapes[0]?.size).toBe(entry.size);
      expect(fetch.payloadBytes).toBe(
        entry.size * 2 * Float64Array.BYTES_PER_ELEMENT,
      );

      await resetPlotlyMetrics(page);
      const selectedAt = await page.evaluate(() => performance.now());
      await treeItems.filter({ hasText: entry.title }).first().click();
      const render = await waitForSignalRender(page, entry.title, selectedAt);
      const renderMetrics = await readPlotlyMetrics(page);
      await expect
        .poll(async () => {
          const plotted = await readSignalPlot(page, entry.title);
          return (
            plotted.plotWidth > 0 &&
            plotted.plottedPoints > 0 &&
            plotted.plottedPoints <= plotted.plotWidth * 2 + 2
          );
        })
        .toBe(true);
      const plotted = await readSignalPlot(page, entry.title);
      expect(plotted.traceCount).toBe(1);
      expect(plotted.plottedPoints).toBeGreaterThan(0);
      expect(plotted.plottedPoints).toBeLessThanOrEqual(
        plotted.plotWidth * 2 + 2,
      );

      await waitForGraphHook(page);
      const hoverMs = await measureHover(page);
      const panMs = await measureDrag(page, "Pan");
      const panMetrics = await readPlotlyMetrics(page);
      const zoomMs = await measureDrag(page, "Zoom");
      const zoomMetrics = await readPlotlyMetrics(page);
      expect(hoverMs).not.toBeNull();
      expect(panMs).not.toBeNull();
      expect(zoomMs).not.toBeNull();
      expect(
        panMetrics.plotRenders.length + zoomMetrics.plotRenders.length,
      ).toBeGreaterThanOrEqual(2);
      const longTaskTotalMs = renderMetrics.longTasks.reduce(
        (total, task) => total + task.duration,
        0,
      );

      results.push({
        size: entry.size,
        createMs: entry.createMs,
        fetch,
        selectToVisibleMs: render.startTime - selectedAt,
        plotRenderCount: renderMetrics.plotRenders.length,
        traceCount: plotted.traceCount,
        plotWidth: plotted.plotWidth,
        plottedPoints: plotted.plottedPoints,
        longTaskCount: renderMetrics.longTasks.length,
        longTaskTotalMs,
        longestTaskMs: Math.max(
          0,
          ...renderMetrics.longTasks.map((task) => task.duration),
        ),
        hoverMs,
        panMs,
        zoomMs,
        relayoutCount:
          panMetrics.plotRenders.length + zoomMetrics.plotRenders.length,
      });
    }

    console.log("\n=== Signal display benchmark ===");
    for (const result of results) {
      console.log(
        `${String(result.size).padStart(7)} pts · payload ${(result.fetch.payloadBytes / 1e6).toFixed(2)} MB · ` +
          `visible ${result.selectToVisibleMs.toFixed(0)} ms · Plotly ${result.plottedPoints} pts · ` +
          `long tasks ${result.longTaskCount}/${result.longestTaskMs.toFixed(0)} ms · ` +
          `hover ${result.hoverMs?.toFixed(0) ?? "n/a"} ms · pan ${result.panMs?.toFixed(0) ?? "n/a"} ms · ` +
          `zoom ${result.zoomMs?.toFixed(0) ?? "n/a"} ms`,
      );
    }
    console.log("================================\n");

    const here = dirname(fileURLToPath(import.meta.url));
    const resultsDir = join(here, "..", "benchmark", "results");
    mkdirSync(resultsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outPath = join(resultsDir, `signal_perf_${stamp}.json`);
    writeFileSync(
      outPath,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), results },
        null,
        2,
      ),
    );
    console.log(`[signal-perf] results written to ${outPath}\n`);
  });
});
