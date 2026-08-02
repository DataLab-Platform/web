import { cleanup, render } from "@testing-library/react";
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

function plotElement() {
  return (
    <ThemeProvider>
      <SignalPlot
        data={SIGNAL}
        oid={SIGNAL.id}
        annotations={ANNOTATIONS}
        onAnnotationsChange={onAnnotationsChange}
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
});
