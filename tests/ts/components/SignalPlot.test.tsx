import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignalPlot } from "../../../src/components/SignalPlot";
import type { AnalysisResult, SignalData } from "../../../src/runtime/runtime";
import { ThemeProvider } from "../../../src/utils/theme";

const plotState = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));

vi.mock("react-plotly.js", () => ({
  default: (props: Record<string, unknown>) => {
    plotState.props = props;
    return <div data-testid="plot" />;
  },
}));

afterEach(() => {
  cleanup();
  plotState.props = null;
});

function makeSignal(id: string, xunit = "s", xlabel = "Time"): SignalData {
  return {
    id,
    uuid: null,
    title: id,
    size: 3,
    xlabel,
    ylabel: "Amplitude",
    xunit,
    yunit: "V",
    x: [0, 1, 2],
    y: [0, 1, 0],
  };
}

const SIGNAL: SignalData = {
  ...makeSignal("signal-1"),
  title: "Original title",
};
const ANNOTATIONS = { shapes: [], annotations: [] };
const onAnnotationsChange = vi.fn();
type SignalPlotProps = Parameters<typeof SignalPlot>[0];

function plotElement(
  data: SignalData = SIGNAL,
  props: Partial<Omit<SignalPlotProps, "data">> = {},
) {
  return (
    <ThemeProvider>
      <SignalPlot
        data={data}
        oid={data.id}
        annotations={ANNOTATIONS}
        onAnnotationsChange={onAnnotationsChange}
        {...props}
      />
    </ThemeProvider>
  );
}

function renderPlot(props: Partial<SignalPlotProps> = {}) {
  const data = props.data ?? SIGNAL;
  const { data: _data, ...overrides } = props;
  return render(plotElement(data, overrides));
}

function currentPlot() {
  return plotState.props as {
    data: Array<Record<string, unknown>>;
    layout: Record<string, Record<string, unknown>> & { uirevision: string };
    config: {
      editable: boolean;
      edits: Record<string, boolean>;
    };
    onRelayout: (event: Record<string, unknown>) => void;
    onInitialized: (figure: unknown, graphDiv: unknown) => void;
  };
}

describe("SignalPlot multi-signal layouts", () => {
  it("preserves overlay mode and exposes an accessible mode selector", () => {
    const onModeChange = vi.fn();
    renderPlot({
      data: makeSignal("primary"),
      extraSignals: [makeSignal("extra")],
      layoutMode: "overlay",
      onLayoutModeChange: onModeChange,
    });
    expect(
      currentPlot()
        .data.filter((trace) => trace.uid)
        .map((trace) => trace.xaxis),
    ).toEqual(["x", "x"]);
    expect(
      screen
        .getByRole("button", { name: "Overlay" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Vertical" }));
    expect(onModeChange).toHaveBeenCalledWith("vertical");
  });

  it("routes signals, results and primary overlays to vertical subplots", () => {
    const pointResult = {
      category: "geometry",
      metadata_key: "peak",
      title: "Peak",
      func_name: "peak",
      headers: [],
      roi_indices: null,
      kind: "point",
      coords: [[1, 2]],
    } satisfies AnalysisResult;
    const { container } = renderPlot({
      data: makeSignal("primary"),
      extraSignals: [
        makeSignal("extra"),
        makeSignal("frequency", "Hz", "Frequency"),
      ],
      extraResults: [{ signalId: "extra", results: [pointResult] }],
      roi: [{ xmin: 0.5, xmax: 1.5 }],
      annotations: {
        shapes: [{ type: "line", xref: "paper", yref: "paper" }],
        annotations: [],
      },
      layoutMode: "vertical",
      onLayoutModeChange: () => {},
    });
    const { data, layout } = currentPlot();
    const signalIds = new Set(["primary", "extra", "frequency"]);
    const curves = data.filter((trace) =>
      signalIds.has(String(trace.uid ?? "")),
    );
    expect(curves.map((trace) => [trace.xaxis, trace.yaxis])).toEqual([
      ["x", "y"],
      ["x2", "y2"],
      ["x3", "y3"],
    ]);
    expect(data.find((trace) => trace.name === "Peak")).toMatchObject({
      xaxis: "x2",
      yaxis: "y2",
    });
    expect(layout.xaxis2.matches).toBe("x");
    expect(layout.xaxis3.matches).toBeUndefined();
    expect(layout.xaxis.title).toEqual({ text: "\u200b" });
    const shapes = layout.shapes as unknown as Array<Record<string, unknown>>;
    expect(shapes.some((shape) => shape.yref === "y domain")).toBe(true);
    expect(
      shapes.some(
        (shape) => shape.xref === "x domain" && shape.yref === "y domain",
      ),
    ).toBe(true);
    expect(
      (container.querySelector(".signal-plot-canvas") as HTMLElement).style
        .minHeight,
    ).toBe("660px");
  });

  it("uses separate horizontal domains and a scroll-safe minimum width", () => {
    const { container } = renderPlot({
      data: makeSignal("primary"),
      extraSignals: [makeSignal("b"), makeSignal("c")],
      layoutMode: "horizontal",
      onLayoutModeChange: () => {},
    });
    const { layout } = currentPlot();
    const first = layout.xaxis.domain as unknown as [number, number];
    const second = layout.xaxis2.domain as unknown as [number, number];
    expect(first[1]).toBeLessThan(second[0]);
    expect(
      (container.querySelector(".signal-plot-canvas") as HTMLElement).style
        .minWidth,
    ).toBe("1080px");
  });

  it("keeps a single signal on the historical primary axes", () => {
    renderPlot({ data: makeSignal("primary"), layoutMode: "vertical" });
    const { data, layout } = currentPlot();
    expect(data.find((trace) => trace.uid)).toMatchObject({
      xaxis: "x",
      yaxis: "y",
    });
    expect(layout.xaxis2).toBeUndefined();
    expect(
      screen.queryByRole("group", { name: "Signal plot layout" }),
    ).toBeNull();
  });
});

function denseSignal(
  id: string,
  curvestyle: "Lines" | "Steps" | "Sticks" | "Dots" = "Lines",
): SignalData {
  const size = 10_000;
  const x = Float64Array.from({ length: size }, (_, index) => index);
  const y = Float64Array.from({ length: size }, (_, index) =>
    Math.sin(index * 0.01),
  );
  y[4_321] = 100;
  y[4_322] = -80;
  return {
    ...SIGNAL,
    id,
    title: id,
    size,
    x,
    y,
    style: {
      color: null,
      linestyle: null,
      linewidth: null,
      curvestyle,
    },
  };
}

describe("SignalPlot title editing and LOD", () => {
  it("keeps titles read-only while allowing persisted overlay edits", () => {
    renderPlot();
    const { config } = currentPlot();

    expect(config.editable).toBe(false);
    expect(config.edits).toMatchObject({
      annotationPosition: true,
      annotationTail: true,
      annotationText: true,
      shapePosition: true,
    });
    expect(config.edits.titleText).toBeUndefined();
    expect(config.edits.axisTitleText).toBeUndefined();
    expect(config.edits.legendText).toBeUndefined();
  });

  it("keeps Plotly props stable across an equivalent rerender", () => {
    const { rerender } = renderPlot();
    const initial = currentPlot();

    rerender(plotElement());

    expect(currentPlot().data).toBe(initial.data);
    expect(currentPlot().layout).toBe(initial.layout);
    expect(currentPlot().config).toBe(initial.config);
    expect(initial.layout.uirevision).toBe(`overlay:${SIGNAL.id}`);
  });

  it("bounds dense signal and ROI traces while preserving narrow extrema", () => {
    const primary = denseSignal("dense-primary");
    const extra = denseSignal("dense-extra");
    render(
      plotElement(primary, {
        extraSignals: [extra],
        roi: [{ xmin: 0, xmax: primary.x.length - 1, title: "all" }],
      }),
    );

    const traces = currentPlot().data as Array<{
      name: string;
      x: ArrayLike<number>;
      y: ArrayLike<number>;
    }>;
    const roiTrace = traces.find((trace) => trace.name === "all")!;
    const primaryTrace = traces.find((trace) => trace.name === primary.title)!;
    const extraTrace = traces.find((trace) => trace.name === extra.title)!;

    expect(primaryTrace.x.length).toBeLessThanOrEqual(1_602);
    expect(extraTrace.x.length).toBeLessThanOrEqual(1_602);
    expect(roiTrace.x.length).toBeLessThanOrEqual(1_602);
    expect(Array.from(primaryTrace.y)).toContain(100);
    expect(Array.from(primaryTrace.y)).toContain(-80);
  });

  it("reduces sticks before expansion and restores exact points after zoom", () => {
    const signal = denseSignal("dense-sticks", "Sticks");
    render(plotElement(signal));
    let trace = currentPlot().data[0] as { x: ArrayLike<number> };

    expect(trace.x.length).toBeLessThanOrEqual(1_602 * 3);
    expect(trace.x.length).toBeLessThan(signal.size * 3);

    act(() => {
      currentPlot().onRelayout({
        "xaxis.range[0]": 1_000,
        "xaxis.range[1]": 1_010,
      });
    });
    trace = currentPlot().data[0] as { x: ArrayLike<number> };

    expect(Array.from(trace.x).filter(Number.isFinite)).toHaveLength(26);
    expect(trace.x.length).toBe(39);
  });

  it.each([
    ["Lines", "lines"],
    ["Steps", "lines"],
    ["Dots", "markers"],
  ] as const)(
    "applies level-of-detail (LOD) reduction before %s rendering",
    (curvestyle, plotlyMode) => {
      render(plotElement(denseSignal(`dense-${curvestyle}`, curvestyle)));
      const trace = currentPlot().data[0] as {
        x: ArrayLike<number>;
        mode: string;
      };

      expect(trace.x.length).toBeLessThanOrEqual(1_602);
      expect(trace.mode).toBe(plotlyMode);
    },
  );

  it("ignores live axis ranges until the final relayout event", () => {
    const signal = denseSignal("dense-live-range");
    let liveRelayout: ((event: Record<string, unknown>) => void) | undefined;
    const graphDiv = {
      _fullLayout: { xaxis: { _length: 800 } },
      on: vi.fn(
        (
          event: string,
          callback: (payload: Record<string, unknown>) => void,
        ) => {
          if (event === "plotly_relayouting") liveRelayout = callback;
        },
      ),
    };
    const { rerender } = render(plotElement(signal));
    act(() => {
      currentPlot().onInitialized({}, graphDiv);
    });
    const initialData = currentPlot().data;

    act(() => {
      liveRelayout?.({
        "xaxis.range[0]": 1_000,
        "xaxis.range[1]": 1_010,
      });
    });
    expect(currentPlot().data).toBe(initialData);

    act(() => {
      currentPlot().onRelayout({
        "xaxis.range[0]": 1_000,
        "xaxis.range[1]": 1_010,
      });
    });
    expect(currentPlot().data).not.toBe(initialData);

    rerender(plotElement(denseSignal("another-signal")));
    const switchedTrace = currentPlot().data[0] as { x: ArrayLike<number> };
    expect(switchedTrace.x.length).toBeGreaterThan(100);
  });
});
