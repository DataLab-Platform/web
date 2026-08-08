import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImagePlot } from "../../../src/components/ImagePlot";
import type { ImageData } from "../../../src/runtime/runtime";
import { ThemeProvider } from "../../../src/utils/theme";

const plotState = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  renderCount: 0,
}));

vi.mock("react-plotly.js", () => ({
  default: (props: Record<string, unknown>) => {
    plotState.props = props;
    plotState.renderCount += 1;
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
  plotState.renderCount = 0;
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

type ImagePlotProps = Parameters<typeof ImagePlot>[0];

function plotElement(props: Partial<ImagePlotProps> = {}) {
  return (
    <ThemeProvider>
      <ImagePlot data={IMAGE} {...props} />
    </ThemeProvider>
  );
}

function renderPlot(props: Partial<ImagePlotProps> = {}) {
  render(plotElement(props));
  return currentPlot();
}

function currentPlot() {
  return plotState.props as {
    data: Array<Record<string, unknown>>;
    layout: {
      shapes: Array<Record<string, unknown>>;
      annotations: Array<Record<string, unknown>>;
    };
    config: {
      editable: boolean;
      edits: Record<string, boolean>;
    };
    onRelayout: (event: Record<string, unknown>) => void;
    onInitialized: (figure: unknown, graphDiv: unknown) => void;
  };
}

describe("ImagePlot title editing", () => {
  it("restores canonical and legacy annotations without enabling editing", () => {
    const plot = renderPlot({
      graphicalAnnotations: {
        items: [],
        overlay: {
          traces: [{ type: "scatter", x: [1], y: [2] }],
          shapes: [{ type: "line", name: "canonical" }],
          annotations: [{ text: "canonical" }],
        },
      },
      annotations: {
        shapes: [{ type: "rect", name: "legacy" }],
        annotations: [{ text: "legacy" }],
      },
    });

    expect(plot.data.at(-1)).toMatchObject({ type: "scatter" });
    expect(plot.layout.shapes).toEqual([
      expect.objectContaining({ name: "canonical", editable: false }),
      expect.objectContaining({ name: "legacy", editable: false }),
    ]);
    expect(plot.layout.annotations).toEqual([
      expect.objectContaining({ text: "canonical", editable: false }),
      expect.objectContaining({ text: "legacy", editable: false }),
    ]);
  });

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
    expect(initial.layout.uirevision).toBe(IMAGE.id);
  });

  it("updates the hover tooltip without rerendering Plot", () => {
    renderPlot();
    const graphDiv = Object.assign(document.createElement("div"), {
      _fullLayout: {
        xaxis: { p2c: (value: number) => value, _offset: 0, _length: 100 },
        yaxis: { p2c: (value: number) => value, _offset: 0, _length: 100 },
      },
      on: vi.fn(),
    });
    vi.spyOn(graphDiv, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    act(() => currentPlot().onInitialized({}, graphDiv));
    const renderCount = plotState.renderCount;

    fireEvent.mouseMove(document.querySelector(".image-plot-host")!, {
      clientX: 1,
      clientY: 1,
      buttons: 0,
    });

    expect(document.querySelector(".image-hover-tooltip")).not.toBeNull();
    expect(plotState.renderCount).toBe(renderCount);
  });
});
