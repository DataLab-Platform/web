/**
 * Tests for :class:`MultiImageSpatialPlot` — the spatial overlay view
 * shown when several images are selected and the multi-image view is
 * switched to "spatial" mode.
 *
 * Unlike the thumbnail grid, this view positions every image in a single
 * Plotly plot according to its physical ``x0``/``y0``/``dx``/``dy``
 * coordinates. That is what makes the "Distribute on a grid" / "Reset
 * positions" geometry tools observable in the browser, so the key
 * behaviour to lock in is: one ``layout.images`` background per image, each
 * anchored at its own origin, and a shared axis range spanning them all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";

import { MultiImageSpatialPlot } from "../../../src/components/MultiImageSpatialPlot";
import { ThemeProvider } from "../../../src/utils/theme";
import type { ImageData } from "../../../src/runtime/runtime";

const plotState = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  renderCount: 0,
}));
const rasterSizes: Array<{ width: number; height: number }> = [];
let dataUrlCounter = 0;

// Capture the props handed to the Plotly component so we can assert on
// the traces / layout without loading the (heavy, jsdom-unfriendly)
// real plotly.js bundle.
vi.mock("react-plotly.js", () => ({
  default: (props: Record<string, unknown>) => {
    plotState.props = props;
    plotState.renderCount += 1;
    return (
      <div
        data-testid="plot"
        data-traces={JSON.stringify(props.data)}
        data-layout={JSON.stringify(props.layout)}
      />
    );
  },
}));

// jsdom ships no 2D canvas context, so the rasterisation path returns
// null and no ``image`` trace would be emitted. Provide a minimal stub
// so the component takes its normal code path.
beforeEach(() => {
  rasterSizes.length = 0;
  dataUrlCounter = 0;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    createImageData: (w: number, h: number) => {
      rasterSizes.push({ width: w, height: h });
      return {
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      };
    },
    putImageData: () => {},
  })) as unknown as HTMLCanvasElement["getContext"];
  HTMLCanvasElement.prototype.toDataURL = vi.fn(
    () => `data:image/png;base64,STUB${++dataUrlCounter}`,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  plotState.props = null;
  plotState.renderCount = 0;
});

function makeImage(id: string, x0: number, y0: number): ImageData {
  return {
    id,
    title: id,
    width: 2,
    height: 2,
    data: [
      [0, 1],
      [2, 3],
    ],
    dtype: "float64",
    x0,
    y0,
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
}

const LARGE_ROW = new Float32Array(2048);
const LARGE_DATA = Array.from({ length: 2048 }, () => LARGE_ROW);

function makeLargeImage(id: string, x0: number, y0: number): ImageData {
  return {
    ...makeImage(id, x0, y0),
    width: 2048,
    height: 2048,
    data: LARGE_DATA,
  };
}

function readLayout(container: HTMLElement): {
  xaxis: { range: [number, number] };
  yaxis: { range: [number, number] };
  images?: Array<{
    source: string;
    x: number;
    y: number;
    sizex: number;
    sizey: number;
  }>;
} {
  const plot = container.querySelector('[data-testid="plot"]');
  return JSON.parse(plot?.getAttribute("data-layout") ?? "{}");
}

function renderSpatial(images: ImageData[], totalSelected: number) {
  return render(
    <ThemeProvider>
      <MultiImageSpatialPlot images={images} totalSelected={totalSelected} />
    </ThemeProvider>,
  );
}

describe("MultiImageSpatialPlot", () => {
  it("renders one layout-image background per image, anchored at each origin", async () => {
    const images = [makeImage("a", 0, 0), makeImage("b", 10, 5)];
    const { container } = renderSpatial(images, 2);
    await waitFor(() => expect(readLayout(container).images).toHaveLength(2));
    const imgs = readLayout(container).images ?? [];
    expect(imgs).toHaveLength(2);
    // ``x0``/``y0`` are the centers of the first pixel: each bitmap starts
    // half a pixel before them.
    expect(imgs.map((m) => m.x).sort((p, q) => p - q)).toEqual([-0.5, 9.5]);
    expect(imgs.map((m) => m.y).sort((p, q) => p - q)).toEqual([-0.5, 4.5]);
  });

  it("spans the axis range across all images (Y reversed)", () => {
    const images = [makeImage("a", 0, 0), makeImage("b", 10, 5)];
    const { container } = renderSpatial(images, 2);
    const { xaxis, yaxis } = readLayout(container);
    // X spans -0.5 .. 11.5 (outer pixel edges) plus margin.
    expect(xaxis.range[0]).toBeLessThanOrEqual(-0.5);
    expect(xaxis.range[1]).toBeGreaterThanOrEqual(11.5);
    // Y axis is reversed for image orientation: range[0] > range[1].
    expect(yaxis.range[0]).toBeGreaterThan(yaxis.range[1]);
  });

  it("reads the value of the pixel whose center is the closest", () => {
    const images = [makeImage("a", 0, 0)];
    const { container } = renderSpatial(images, 1);
    const graphDiv = Object.assign(document.createElement("div"), {
      _fullLayout: {
        xaxis: { p2c: (v: number) => v / 10, _offset: 0, _length: 100 },
        yaxis: { p2c: (v: number) => v / 10, _offset: 0, _length: 100 },
      },
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
    const plot = plotState.props as {
      onInitialized: (figure: unknown, graphDiv: unknown) => void;
    };
    act(() => plot.onInitialized({}, graphDiv));
    const hoverAt = (x: number, y: number) => {
      fireEvent.mouseMove(
        container.querySelector(".multi-image-spatial-wrap")!,
        { clientX: x * 10, clientY: y * 10, buttons: 0 },
      );
      return container.querySelector(".multi-image-hover")?.textContent ?? "";
    };
    // Pixel (1, 0) spans [0.5, 1.5) × [-0.5, 0.5).
    expect(hoverAt(0.6, 0.4)).toMatch(/z: 1(\.0+)?$/);
    expect(hoverAt(0.4, 0.6)).toMatch(/z: 2(\.0+)?$/);
    // The outer half of the first pixel belongs to the image.
    expect(hoverAt(-0.4, -0.4)).toMatch(/z: 0(\.0+)?$/);
  });

  it("shows the '+N more' banner when the selection exceeds the shown set", () => {
    const images = [makeImage("a", 0, 0), makeImage("b", 10, 0)];
    const { container } = renderSpatial(images, 5);
    expect(container.querySelector(".multi-image-banner")?.textContent).toMatch(
      /2.*5/,
    );
  });

  it("keeps Plotly props stable across an equivalent rerender", () => {
    const images = [makeImage("a", 0, 0), makeImage("b", 10, 5)];
    const { rerender } = renderSpatial(images, 2);
    const initial = plotState.props as {
      data: unknown;
      layout: { uirevision: string };
      config: unknown;
    };

    rerender(
      <ThemeProvider>
        <MultiImageSpatialPlot images={images} totalSelected={2} />
      </ThemeProvider>,
    );

    expect(plotState.props?.data).toBe(initial.data);
    expect(plotState.props?.layout).toBe(initial.layout);
    expect(plotState.props?.config).toBe(initial.config);
    expect(initial.layout.uirevision).toBe("a|b");
  });

  it("updates the hover tooltip without rerendering Plot", () => {
    const images = [makeImage("a", 0, 0), makeImage("b", 10, 5)];
    const { container } = renderSpatial(images, 2);
    const graphDiv = Object.assign(document.createElement("div"), {
      _fullLayout: {
        xaxis: {
          p2c: (value: number) => value,
          _offset: 0,
          _length: 100,
          range: [0, 12],
        },
        yaxis: {
          p2c: (value: number) => value,
          _offset: 0,
          _length: 100,
          range: [7, 0],
        },
      },
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
    const plot = plotState.props as {
      onInitialized: (figure: unknown, graphDiv: unknown) => void;
    };
    act(() => plot.onInitialized({}, graphDiv));
    const renderCount = plotState.renderCount;

    fireEvent.mouseMove(container.querySelector(".multi-image-spatial-wrap")!, {
      clientX: 1,
      clientY: 1,
      buttons: 0,
    });

    expect(container.querySelector(".multi-image-hover")).not.toBeNull();
    expect(plotState.renderCount).toBe(renderCount);
  });

  it("budgets four 2048² images and restores exact pixels on zoom", async () => {
    const images = [
      makeLargeImage("top-left", 0, 0),
      makeLargeImage("top-right", 2048, 0),
      makeLargeImage("bottom-left", 0, 2048),
      makeLargeImage("bottom-right", 2048, 2048),
    ];
    const { container } = renderSpatial(images, 4);
    await waitFor(() => expect(readLayout(container).images).toHaveLength(4));

    const initial = readLayout(container).images!;
    expect(initial.map(({ x, y }) => [x, y])).toEqual([
      [-0.5, -0.5],
      [2047.5, -0.5],
      [-0.5, 2047.5],
      [2047.5, 2047.5],
    ]);
    expect(initial.map(({ source }) => source)).toEqual([
      "data:image/png;base64,STUB1",
      "data:image/png;base64,STUB2",
      "data:image/png;base64,STUB3",
      "data:image/png;base64,STUB4",
    ]);
    expect(rasterSizes).toHaveLength(4);
    expect(
      rasterSizes.every(({ width, height }) => width < 1024 && height < 1024),
    ).toBe(true);
    expect(
      rasterSizes.reduce(
        (total, { width, height }) => total + width * height,
        0,
      ),
    ).toBeLessThan(1024 * 1024);

    const plot = plotState.props as {
      onRelayout: (event: Record<string, unknown>) => void;
    };
    // Pixels 10…25 of the top-right image (centers 2058…2073), rows 0…15.
    act(() =>
      plot.onRelayout({
        "xaxis.range[0]": 2057.5,
        "xaxis.range[1]": 2073.5,
        "yaxis.range[0]": 15.5,
        "yaxis.range[1]": -0.5,
      }),
    );
    await waitFor(() => expect(readLayout(container).images).toHaveLength(1));
    const zoomed = readLayout(container).images![0];
    expect(zoomed.x).toBe(2057.5);
    expect(zoomed.y).toBe(-0.5);
    expect(zoomed.sizex).toBe(16);
    expect(zoomed.sizey).toBe(16);
    expect(rasterSizes.at(-1)).toEqual({ width: 16, height: 16 });
  });
});
