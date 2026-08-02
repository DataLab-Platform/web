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

function renderPlot() {
  render(
    <ThemeProvider>
      <SignalPlot
        data={SIGNAL}
        oid={SIGNAL.id}
        annotations={{ shapes: [], annotations: [] }}
        onAnnotationsChange={() => {}}
      />
    </ThemeProvider>,
  );
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
});
