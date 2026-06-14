/**
 * Tests for :class:`MultiImageSpatialPlot` — the spatial overlay view
 * shown when several images are selected and the multi-image view is
 * switched to "spatial" mode.
 *
 * Unlike the thumbnail grid, this view positions every image in a single
 * Plotly plot according to its physical ``x0``/``y0``/``dx``/``dy``
 * coordinates. That is what makes the "Distribute on a grid" / "Reset
 * positions" geometry tools observable in the browser, so the key
 * behaviour to lock in is: one ``image`` trace per image, each anchored
 * at its own origin, and a shared axis range spanning them all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { MultiImageSpatialPlot } from "../../../src/components/MultiImageSpatialPlot";
import { ThemeProvider } from "../../../src/utils/theme";
import type { ImageData } from "../../../src/runtime/runtime";

// Capture the props handed to the Plotly component so we can assert on
// the traces / layout without loading the (heavy, jsdom-unfriendly)
// real plotly.js bundle.
vi.mock("react-plotly.js", () => ({
  default: (props: { data: unknown[]; layout: unknown }) => (
    <div
      data-testid="plot"
      data-traces={JSON.stringify(props.data)}
      data-layout={JSON.stringify(props.layout)}
    />
  ),
}));

// jsdom ships no 2D canvas context, so the rasterisation path returns
// null and no ``image`` trace would be emitted. Provide a minimal stub
// so the component takes its normal code path.
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
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

interface ImageTrace {
  type: string;
  x0: number;
  y0: number;
}

function readTraces(container: HTMLElement): ImageTrace[] {
  const plot = container.querySelector('[data-testid="plot"]');
  return JSON.parse(plot?.getAttribute("data-traces") ?? "[]");
}

function readLayout(container: HTMLElement): {
  xaxis: { range: [number, number] };
  yaxis: { range: [number, number] };
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
  it("renders one image trace per image, anchored at each origin", () => {
    const images = [makeImage("a", 0, 0), makeImage("b", 10, 5)];
    const { container } = renderSpatial(images, 2);
    const traces = readTraces(container).filter((t) => t.type === "image");
    expect(traces).toHaveLength(2);
    expect(traces.map((t) => t.x0).sort((p, q) => p - q)).toEqual([0, 10]);
    expect(traces.map((t) => t.y0).sort((p, q) => p - q)).toEqual([0, 5]);
  });

  it("spans the axis range across all images (Y reversed)", () => {
    const images = [makeImage("a", 0, 0), makeImage("b", 10, 5)];
    const { container } = renderSpatial(images, 2);
    const { xaxis, yaxis } = readLayout(container);
    // X spans 0 .. 12 (10 + width*dx) plus margin.
    expect(xaxis.range[0]).toBeLessThanOrEqual(0);
    expect(xaxis.range[1]).toBeGreaterThanOrEqual(12);
    // Y axis is reversed for image orientation: range[0] > range[1].
    expect(yaxis.range[0]).toBeGreaterThan(yaxis.range[1]);
  });

  it("shows the '+N more' banner when the selection exceeds the shown set", () => {
    const images = [makeImage("a", 0, 0), makeImage("b", 10, 0)];
    const { container } = renderSpatial(images, 5);
    expect(container.querySelector(".multi-image-banner")?.textContent).toMatch(
      /2.*5/,
    );
  });
});
