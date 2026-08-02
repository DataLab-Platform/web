import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignalPlot } from "../../../src/components/SignalPlot";
import type { SignalData } from "../../../src/runtime/runtime";
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

const SIGNAL: SignalData = {
  id: "signal-1",
  uuid: null,
  title: "Original title",
  size: 3,
  xlabel: "Time",
  ylabel: "Amplitude",
  xunit: "s",
  yunit: "V",
  x: [0, 1, 2],
  y: [0, 1, 0],
};
const ANNOTATIONS = { shapes: [], annotations: [] };
const onAnnotationsChange = vi.fn();

function plotElement(
  data: SignalData = SIGNAL,
  options: {
    extraSignals?: SignalData[];
    roi?: Array<{ xmin: number; xmax: number; title: string }>;
  } = {},
) {
  return (
    <ThemeProvider>
      <SignalPlot
        data={data}
        oid={data.id}
        annotations={ANNOTATIONS}
        onAnnotationsChange={onAnnotationsChange}
        extraSignals={options.extraSignals}
        roi={options.roi}
      />
    </ThemeProvider>
  );
}

function renderPlot() {
  render(plotElement());
  return plotState.props as {
    config: {
      editable: boolean;
      edits: Record<string, boolean>;
    };
    onRelayout: (event: Record<string, unknown>) => void;
    onInitialized: (figure: unknown, graphDiv: unknown) => void;
  };
}

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

describe("SignalPlot title editing", () => {
  it("keeps titles read-only while allowing persisted overlay edits", () => {
    const plot = renderPlot();

    expect(plot.config.editable).toBe(false);
    expect(plot.config.edits).toMatchObject({
      annotationPosition: true,
      annotationTail: true,
      annotationText: true,
      shapePosition: true,
    });
    expect(plot.config.edits.titleText).toBeUndefined();
    expect(plot.config.edits.axisTitleText).toBeUndefined();
    expect(plot.config.edits.legendText).toBeUndefined();
  });

  it("keeps Plotly props stable across an equivalent rerender", () => {
    const { rerender } = render(plotElement());
    const initial = plotState.props as {
      data: unknown;
      layout: { uirevision: string };
      config: unknown;
    };

    rerender(plotElement());

    expect(plotState.props?.data).toBe(initial.data);
    expect(plotState.props?.layout).toBe(initial.layout);
    expect(plotState.props?.config).toBe(initial.config);
    expect(initial.layout.uirevision).toBe(SIGNAL.id);
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

    const traces = plotState.props?.data as Array<{
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
    let trace = (plotState.props?.data as Array<{ x: ArrayLike<number> }>)[0];

    expect(trace.x.length).toBeLessThanOrEqual(1_602 * 3);
    expect(trace.x.length).toBeLessThan(signal.size * 3);

    act(() => {
      (plotState.props?.onRelayout as (event: Record<string, unknown>) => void)(
        {
          "xaxis.range[0]": 1_000,
          "xaxis.range[1]": 1_010,
        },
      );
    });
    trace = (plotState.props?.data as Array<{ x: ArrayLike<number> }>)[0];

    // Eleven visible points plus one neighbour on each side, expanded to
    // [x, x, NaN] stems by buildCurveTrace.
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
      const signal = denseSignal(`dense-${curvestyle}`, curvestyle);
      render(plotElement(signal));
      const trace = (
        plotState.props?.data as Array<{
          x: ArrayLike<number>;
          mode: string;
        }>
      )[0];

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
    const currentPlot = () =>
      plotState.props as {
        data: unknown;
        onInitialized: (figure: unknown, graphDiv: unknown) => void;
        onRelayout: (event: Record<string, unknown>) => void;
      };
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
    const switchedTrace = (
      plotState.props?.data as Array<{ x: ArrayLike<number> }>
    )[0];
    expect(switchedTrace.x.length).toBeGreaterThan(100);
  });
});
