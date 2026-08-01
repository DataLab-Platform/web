import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignalPlot } from "../../../src/components/SignalPlot";
import { ThemeProvider } from "../../../src/utils/theme";
import type { AnalysisResult, SignalData } from "../../../src/runtime/runtime";

vi.mock("react-plotly.js", () => ({
  default: (props: { data: unknown[]; layout: unknown }) => (
    <div
      data-testid="plot"
      data-traces={JSON.stringify(props.data)}
      data-layout={JSON.stringify(props.layout)}
    />
  ),
}));

afterEach(cleanup);

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

function renderPlot(props: Partial<Parameters<typeof SignalPlot>[0]> = {}) {
  const data = props.data ?? makeSignal("primary");
  return render(
    <ThemeProvider>
      <SignalPlot
        data={data}
        oid={data.id}
        annotations={{ shapes: [], annotations: [] }}
        onAnnotationsChange={() => {}}
        {...props}
      />
    </ThemeProvider>,
  );
}

function plotPayload(container: HTMLElement): {
  data: Array<Record<string, unknown>>;
  layout: Record<string, Record<string, unknown>>;
} {
  const plot = container.querySelector('[data-testid="plot"]');
  return {
    data: JSON.parse(plot?.getAttribute("data-traces") ?? "[]"),
    layout: JSON.parse(plot?.getAttribute("data-layout") ?? "{}"),
  };
}

describe("SignalPlot multi-signal layouts", () => {
  it("preserves overlay mode and exposes an accessible mode selector", () => {
    const onModeChange = vi.fn();
    const { container } = renderPlot({
      extraSignals: [makeSignal("extra")],
      layoutMode: "overlay",
      onLayoutModeChange: onModeChange,
    });
    const { data } = plotPayload(container);
    expect(
      data.filter((trace) => trace.uid).map((trace) => trace.xaxis),
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
    const { data, layout } = plotPayload(container);
    const signalIds = new Set(["primary", "extra", "frequency"]);
    const curves = data.filter((trace) =>
      signalIds.has(String(trace.uid ?? "")),
    );
    expect(curves.map((trace) => [trace.xaxis, trace.yaxis])).toEqual([
      ["x", "y"],
      ["x2", "y2"],
      ["x3", "y3"],
    ]);
    const peak = data.find((trace) => trace.name === "Peak");
    expect(peak).toMatchObject({ xaxis: "x2", yaxis: "y2" });
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
      extraSignals: [makeSignal("b"), makeSignal("c")],
      layoutMode: "horizontal",
      onLayoutModeChange: () => {},
    });
    const { layout } = plotPayload(container);
    const first = layout.xaxis.domain as unknown as [number, number];
    const second = layout.xaxis2.domain as unknown as [number, number];
    expect(first[1]).toBeLessThan(second[0]);
    expect(
      (container.querySelector(".signal-plot-canvas") as HTMLElement).style
        .minWidth,
    ).toBe("1080px");
  });

  it("keeps a single signal on the historical primary axes", () => {
    const { container } = renderPlot({ layoutMode: "vertical" });
    const { data, layout } = plotPayload(container);
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
