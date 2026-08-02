import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImagePlot } from "../../../src/components/ImagePlot";
import type { ImageData } from "../../../src/runtime/runtime";
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

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    }),
    putImageData: () => {},
  })) as unknown as HTMLCanvasElement["getContext"];
  HTMLCanvasElement.prototype.toDataURL = vi.fn(
    () => "data:image/png;base64,STUB",
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  plotState.props = null;
});

const IMAGE: ImageData = {
  id: "image-1",
  title: "Original image",
  width: 2,
  height: 2,
  data: [
    [0, 1],
    [2, 3],
  ],
  dtype: "float64",
  x0: 0,
  y0: 0,
  dx: 1,
  dy: 1,
  data_min: 0,
  data_max: 3,
  xlabel: "x",
  ylabel: "y",
  zlabel: "z",
  xunit: "",
  yunit: "",
  zunit: "",
};

function renderPlot() {
  render(
    <ThemeProvider>
      <ImagePlot data={IMAGE} />
    </ThemeProvider>,
  );
  return currentPlot();
}

function currentPlot() {
  return plotState.props as {
    config: {
      editable: boolean;
      edits: Record<string, boolean>;
    };
    onRelayout: (event: Record<string, unknown>) => void;
  };
}

describe("ImagePlot title editing", () => {
  it("keeps the title read-only without enabling native ROI movement", () => {
    const plot = renderPlot();

    expect(plot.config.editable).toBe(false);
    expect(plot.config.edits).toEqual({
      shapePosition: false,
    });
  });

  it("enables native shape movement only for the Stats tool", () => {
    renderPlot();

    fireEvent.click(screen.getByRole("button", { name: "Stats area" }));

    expect(currentPlot().config.edits).toMatchObject({
      shapePosition: true,
    });
    expect(currentPlot().config.edits.titleText).toBeUndefined();
  });
});
