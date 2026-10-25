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
  all: [] as Record<string, unknown>[],
  renderCount: 0,
}));

vi.mock("react-plotly.js", () => ({
  default: (props: Record<string, unknown>) => {
    plotState.props = props;
    plotState.all.push(props);
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
    drawImage: () => {},
  })) as unknown as HTMLCanvasElement["getContext"];
  HTMLCanvasElement.prototype.toDataURL = vi.fn(
    () => "data:image/png;base64,STUB",
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  plotState.props = null;
  plotState.all = [];
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

// ---------------------------------------------------------------------------
// Pixel-center convention: ``x0``/``y0`` are the centers of the first pixel
// (Sigima), so pixel ``i`` covers ``[x0 + (i - ½)·dx, x0 + (i + ½)·dx)``.
// ---------------------------------------------------------------------------

/** 4×4 ramp ``z = 4·j + i`` with pixel centers at 0, 1, 2, 3 (web#69). */
const RAMP: ImageData = {
  ...IMAGE,
  id: "ramp",
  width: 4,
  height: 4,
  data: [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [8, 9, 10, 11],
    [12, 13, 14, 15],
  ],
  data_max: 15,
};

/** 4×3 non-uniform image (pixel centers in ``xcoords``/``ycoords``). */
const NON_UNIFORM: ImageData = {
  ...RAMP,
  id: "non-uniform",
  height: 3,
  data: RAMP.data.slice(0, 3),
  data_max: 11,
  is_uniform_coords: false,
  xcoords: [0, 1.5, 4, 9],
  ycoords: [0, 2, 5],
};

/** Main image plot props (the cross-section plots have no
 *  ``onInitialized`` handler). */
function mainPlot() {
  const main = plotState.all.filter(
    (props) => typeof props.onInitialized === "function",
  );
  return main.at(-1) as ReturnType<typeof currentPlot>;
}

/** Connect a fake Plotly graph div whose data coordinates are the client
 *  coordinates divided by 10, then hover the image at ``(x, y)``. */
function hoverAt(x: number, y: number) {
  const graphDiv = Object.assign(document.createElement("div"), {
    _fullLayout: {
      xaxis: { p2c: (v: number) => v / 10, _offset: 0, _length: 100 },
      yaxis: { p2c: (v: number) => v / 10, _offset: 0, _length: 100 },
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
  act(() => mainPlot().onInitialized({}, graphDiv));
  fireEvent.mouseMove(document.querySelector(".image-plot-host")!, {
    clientX: x * 10,
    clientY: y * 10,
    buttons: 0,
  });
}

function hoverText(): string {
  return document.querySelector(".image-hover-tooltip")?.textContent ?? "";
}

describe("ImagePlot pixel-center convention", () => {
  it("centers the pixels of the bitmap on x0 + i·dx", () => {
    vi.useFakeTimers();
    render(plotElement({ data: RAMP }));
    act(() => vi.advanceTimersByTime(200));
    const layout = currentPlot().layout as unknown as {
      images: Array<Record<string, number>>;
    };
    expect(layout.images).toHaveLength(1);
    expect(layout.images[0]).toMatchObject({
      x: -0.5,
      y: -0.5,
      sizex: 4,
      sizey: 4,
    });
  });

  it("places a calibrated image from the outer edge of its first pixel", () => {
    vi.useFakeTimers();
    const calibrated = { ...RAMP, x0: 10, y0: -3, dx: 0.5, dy: 2 };
    render(plotElement({ data: calibrated }));
    act(() => vi.advanceTimersByTime(200));
    const layout = currentPlot().layout as unknown as {
      images: Array<Record<string, number>>;
    };
    expect(layout.images[0]).toMatchObject({
      x: 9.75,
      y: -4,
      sizex: 2,
      sizey: 8,
    });
  });

  it("reads the value of the pixel whose center is the closest", () => {
    renderPlot({ data: RAMP });
    hoverAt(0.4, 0.4);
    expect(hoverText()).toMatch(/z: 0(\.0+)?$/);
    hoverAt(0.6, 0.4);
    expect(hoverText()).toMatch(/z: 1(\.0+)?$/);
    hoverAt(0.6, 0.6);
    expect(hoverText()).toMatch(/z: 5(\.0+)?$/);
    // The outer half of the first pixel belongs to the image.
    hoverAt(-0.4, -0.4);
    expect(hoverText()).toMatch(/z: 0(\.0+)?$/);
  });

  it("draws zoomed-in pixels sharp (nearest pixel)", () => {
    vi.useFakeTimers();
    const toDataURL = vi.mocked(HTMLCanvasElement.prototype.toDataURL);
    render(plotElement({ data: RAMP }));
    act(() => vi.advanceTimersByTime(200));
    // 4 pixels over the default 1024-pixel plot area: the bitmap is
    // magnified ×256 and drawn with nearest-pixel scaling.
    const encoded = toDataURL.mock.contexts.at(-1) as HTMLCanvasElement;
    expect([encoded.width, encoded.height]).toEqual([1024, 1024]);
    expect(
      document
        .querySelector(".image-plot-host")
        ?.classList.contains("image-crisp-pixels"),
    ).toBe(true);
  });

  it("keeps the smooth rendering of decimated images", () => {
    vi.useFakeTimers();
    // 1100² image (LOD) shown whole over 1024 pixels: decimated ×2.
    const row = new Float32Array(1100);
    const large: ImageData = {
      ...RAMP,
      id: "large",
      width: 1100,
      height: 1100,
      data: Array.from({ length: 1100 }, () => row),
    };
    render(plotElement({ data: large }));
    act(() => vi.advanceTimersByTime(200));
    expect(
      (currentPlot().layout as unknown as { images: unknown[] }).images,
    ).toHaveLength(1);
    expect(
      document
        .querySelector(".image-plot-host")
        ?.classList.contains("image-crisp-pixels"),
    ).toBe(false);
  });

  it("computes stats over the pixels the rectangle covers", () => {
    renderPlot({ data: RAMP });
    fireEvent.click(screen.getByRole("button", { name: "Stats area" }));
    // [0.6, 1.4]² lies inside pixel (1, 1), which spans [0.5, 1.5]².
    act(() =>
      currentPlot().onRelayout({
        shapes: [{ type: "rect", x0: 0.6, x1: 1.4, y0: 0.6, y1: 1.4 }],
      }),
    );
    const stats = document.querySelector(".image-stats-overlay-body");
    expect(stats?.textContent).toMatch(/n: 1(?!\d)/);
    expect(stats?.textContent).toMatch(/mean: 5/);
    // [0.2, 1.7] × [0.6, 1.4] covers columns 0 to 2 of row 1.
    act(() =>
      currentPlot().onRelayout({
        shapes: [{ type: "rect", x0: 0.2, x1: 1.7, y0: 0.6, y1: 1.4 }],
      }),
    );
    expect(
      document.querySelector(".image-stats-overlay-body")?.textContent,
    ).toMatch(/n: 3(?!\d)/);
  });

  it("draws cross-sections of non-uniform images on their pixel centers", () => {
    renderPlot({ data: NON_UNIFORM });
    fireEvent.click(screen.getByRole("button", { name: "Cross profiles" }));
    // Pixel (2, 1): x in [2.75, 6.5), y in [1, 3.5).
    hoverAt(4.2, 2.1);
    // The horizontal cross-section is the plot whose X axis is aligned with
    // the image (fixed range, no tick labels).
    type ProfileProps = {
      data: Array<Record<string, unknown>>;
      layout: { xaxis: { range?: number[]; showticklabels?: boolean } };
    };
    const xProfile = (plotState.all as ProfileProps[])
      .filter(
        (props) =>
          !("onInitialized" in props) &&
          props.layout.xaxis.range !== undefined &&
          props.layout.xaxis.showticklabels === false,
      )
      .at(-1);
    expect(xProfile).toBeDefined();
    const trace = xProfile!.data[0];
    expect(trace.x).toEqual([0, 1.5, 4, 9]);
    expect(trace.y).toEqual([4, 5, 6, 7]);
    expect(xProfile!.layout.xaxis.range).toEqual([-0.75, 11.5]);
  });
});
