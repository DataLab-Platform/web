import type { Page } from "@playwright/test";

export interface PlotRenderMetric {
  kind: "signal" | "image";
  phase: "initialized" | "updated";
  sequence: number;
  startTime: number;
}

export interface LongTaskMetric {
  startTime: number;
  duration: number;
}

export interface PlotlyMetricsSnapshot {
  installedAt: number;
  graphMountCount: number;
  afterPlotCount: number;
  relayoutCount: number;
  hoverCount: number;
  drawDurations: number[];
  plotRenders: PlotRenderMetric[];
  longTasks: LongTaskMetric[];
}

export interface RuntimePayloadMetric {
  totalMs: number;
  queueWaitMs: number | null;
  bridgeAndTransferMs: number | null;
  decodeMs: number | null;
  payloadBytes: number;
  itemCount: number;
  shapes: Array<{
    width?: number;
    height?: number;
    size?: number;
  }>;
}

/** Install metrics before navigation so the first Plotly call is observed. */
export async function installPlotlyMetrics(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type MetricsState = {
      installedAt: number;
      graphMountCount: number;
      afterPlotCount: number;
      relayoutCount: number;
      hoverCount: number;
      drawDurations: number[];
      plotRenders: Array<{
        kind: "signal" | "image";
        phase: "initialized" | "updated";
        sequence: number;
        startTime: number;
      }>;
      longTasks: Array<{ startTime: number; duration: number }>;
    };
    type MetricsWindow = Window & {
      __dlwPlotlyMetrics?: MetricsState;
    };
    type GraphDiv = Element & {
      on?: (event: string, callback: () => void) => void;
      __dlwMetricsHooked?: boolean;
      __dlwBeforePlotAt?: number;
    };

    const metricsWindow = window as MetricsWindow;
    const state: MetricsState = {
      installedAt: performance.now(),
      graphMountCount: 0,
      afterPlotCount: 0,
      relayoutCount: 0,
      hoverCount: 0,
      drawDurations: [],
      plotRenders: [],
      longTasks: [],
    };
    metricsWindow.__dlwPlotlyMetrics = state;
    window.addEventListener("datalab-web:plot-rendered", (event) => {
      const detail = (event as CustomEvent).detail as {
        kind?: unknown;
        phase?: unknown;
        sequence?: unknown;
      };
      if (
        (detail.kind !== "signal" && detail.kind !== "image") ||
        (detail.phase !== "initialized" && detail.phase !== "updated") ||
        typeof detail.sequence !== "number"
      ) {
        return;
      }
      state.plotRenders.push({
        kind: detail.kind,
        phase: detail.phase,
        sequence: detail.sequence,
        startTime: performance.now(),
      });
    });

    const hookGraph = (element: Element) => {
      const graph = element as GraphDiv;
      if (graph.__dlwMetricsHooked || typeof graph.on !== "function") return;
      graph.__dlwMetricsHooked = true;
      state.graphMountCount += 1;
      graph.on("plotly_beforeplot", () => {
        graph.__dlwBeforePlotAt = performance.now();
      });
      graph.on("plotly_afterplot", () => {
        state.afterPlotCount += 1;
        if (graph.__dlwBeforePlotAt !== undefined) {
          state.drawDurations.push(performance.now() - graph.__dlwBeforePlotAt);
          graph.__dlwBeforePlotAt = undefined;
        }
      });
      graph.on("plotly_relayout", () => {
        state.relayoutCount += 1;
      });
      graph.on("plotly_hover", () => {
        state.hoverCount += 1;
      });
    };
    const hookGraphs = () => {
      document.querySelectorAll(".js-plotly-plot").forEach(hookGraph);
    };
    const startGraphObserver = () => {
      hookGraphs();
      const observer = new MutationObserver(hookGraphs);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      window.setInterval(hookGraphs, 25);
    };
    if (document.documentElement) startGraphObserver();
    else
      window.addEventListener("DOMContentLoaded", startGraphObserver, {
        once: true,
      });

    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            state.longTasks.push({
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
        });
        observer.observe({ type: "longtask", buffered: true });
      } catch {
        // Long-task entries are optional outside Chromium.
      }
    }
  });
}

export async function resetPlotlyMetrics(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (
      window as unknown as {
        __dlwPlotlyMetrics?: PlotlyMetricsSnapshot;
      }
    ).__dlwPlotlyMetrics;
    if (!state)
      throw new Error("Plotly metrics were not installed before navigation");
    state.installedAt = performance.now();
    state.graphMountCount = 0;
    state.afterPlotCount = 0;
    state.relayoutCount = 0;
    state.hoverCount = 0;
    state.drawDurations.length = 0;
    state.plotRenders.length = 0;
    state.longTasks.length = 0;
  });
}

export async function readPlotlyMetrics(
  page: Page,
): Promise<PlotlyMetricsSnapshot> {
  return page.evaluate(() => {
    const state = (
      window as unknown as {
        __dlwPlotlyMetrics?: PlotlyMetricsSnapshot;
      }
    ).__dlwPlotlyMetrics;
    if (!state)
      throw new Error("Plotly metrics were not installed before navigation");
    return structuredClone(state);
  });
}

/** Wait for ``react-plotly`` to finish a render and publish its graphDiv. */
export async function waitForNextPlotRender(
  page: Page,
  previousCount: number,
  kind?: "signal" | "image",
  timeout = 30_000,
): Promise<PlotRenderMetric> {
  await page.waitForFunction(
    ({ count, expectedKind }) => {
      const state = (
        window as unknown as {
          __dlwPlotlyMetrics?: PlotlyMetricsSnapshot;
        }
      ).__dlwPlotlyMetrics;
      return Boolean(
        state?.plotRenders
          .slice(count)
          .some((render) => !expectedKind || render.kind === expectedKind),
      );
    },
    { count: previousCount, expectedKind: kind },
    { timeout },
  );
  const metrics = await readPlotlyMetrics(page);
  const render = metrics.plotRenders
    .slice(previousCount)
    .find((entry) => !kind || entry.kind === kind);
  if (!render) throw new Error("Plot render completed without a metric entry");
  return render;
}

/** Wait for a real ``plotly_afterplot`` event; timeout is an error. */
export async function waitForNextAfterPlot(
  page: Page,
  previousCount: number,
  timeout = 30_000,
): Promise<void> {
  await page.waitForFunction(
    (count: number) => {
      const state = (
        window as unknown as {
          __dlwPlotlyMetrics?: PlotlyMetricsSnapshot;
        }
      ).__dlwPlotlyMetrics;
      return (state?.afterPlotCount ?? 0) > count;
    },
    previousCount,
    { timeout },
  );
}

/**
 * Invoke one runtime method and measure the queued call without returning the
 * potentially huge payload through Playwright's own serialisation layer.
 */
export async function measureRuntimePayload(
  page: Page,
  method: string,
  args: unknown[],
): Promise<RuntimePayloadMetric> {
  return page.evaluate(
    async ({ methodName, methodArgs }) => {
      type RuntimeLike = Record<string, unknown> & {
        invokePy?: (...args: unknown[]) => Promise<unknown>;
      };
      const runtime = (window as unknown as { runtime: RuntimeLike }).runtime;
      const runtimeMethod = runtime[methodName];
      if (typeof runtimeMethod !== "function") {
        throw new Error(`Runtime method not found: ${methodName}`);
      }

      let invokeStartedAt: number | null = null;
      let invokeFinishedAt: number | null = null;
      const originalInvoke = runtime.invokePy;
      if (typeof originalInvoke === "function") {
        runtime.invokePy = async function (
          this: unknown,
          ...invokeArgs: unknown[]
        ) {
          if (invokeStartedAt === null) invokeStartedAt = performance.now();
          try {
            return await originalInvoke.apply(this, invokeArgs);
          } finally {
            invokeFinishedAt = performance.now();
          }
        };
      }

      const byteLength = (value: unknown): number => {
        if (value instanceof ArrayBuffer) return value.byteLength;
        if (ArrayBuffer.isView(value)) return value.byteLength;
        if (Array.isArray(value)) {
          return value.reduce((total, item) => total + byteLength(item), 0);
        }
        if (value !== null && typeof value === "object") {
          return Object.values(value).reduce(
            (total, item) => total + byteLength(item),
            0,
          );
        }
        return 0;
      };
      const shapeOf = (value: unknown) => {
        if (value === null || typeof value !== "object") return {};
        const record = value as Record<string, unknown>;
        return {
          ...(typeof record.width === "number" ? { width: record.width } : {}),
          ...(typeof record.height === "number"
            ? { height: record.height }
            : {}),
          ...(typeof record.size === "number" ? { size: record.size } : {}),
        };
      };

      const startedAt = performance.now();
      let payload: unknown;
      try {
        payload = await runtimeMethod.apply(runtime, methodArgs);
      } finally {
        if (originalInvoke) runtime.invokePy = originalInvoke;
      }
      const finishedAt = performance.now();
      const items = Array.isArray(payload) ? payload : [payload];
      const queueWaitMs =
        invokeStartedAt === null ? null : invokeStartedAt - startedAt;
      const bridgeAndTransferMs =
        invokeStartedAt === null || invokeFinishedAt === null
          ? null
          : invokeFinishedAt - invokeStartedAt;
      return {
        totalMs: finishedAt - startedAt,
        queueWaitMs,
        bridgeAndTransferMs,
        decodeMs:
          queueWaitMs === null || bridgeAndTransferMs === null
            ? null
            : finishedAt - startedAt - queueWaitMs - bridgeAndTransferMs,
        payloadBytes: byteLength(payload),
        itemCount: items.length,
        shapes: items.map(shapeOf),
      };
    },
    { methodName: method, methodArgs: args },
  );
}
