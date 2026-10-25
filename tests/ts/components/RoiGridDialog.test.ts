/**
 * The ROI grid preview is a TypeScript replica of Sigima's
 * ``generate_image_grid_roi``: it must give the rectangles the backend creates
 * on submit.  The reference values below were computed with Sigima 1.4
 * (pixel-center convention: the grid spans the outer edges of the pixels and
 * every cell is made of whole pixels).
 */
import { describe, expect, it, vi } from "vitest";
import { computeRoiGridPreview } from "../../../src/components/RoiGridDialog";
import type { ImageData, ImageRoiSegment } from "../../../src/runtime/runtime";

// The dialog module imports the image viewer, whose Plotly bundle cannot load
// under jsdom; only the pure grid computation is exercised here.
vi.mock("react-plotly.js", () => ({ default: () => null }));

type Rect = [title: string, x0: number, y0: number, dx: number, dy: number];

function makeImage(fields: Partial<ImageData>): ImageData {
  return {
    id: "img",
    title: "img",
    width: 1,
    height: 1,
    data: [],
    dtype: "float64",
    x0: 0,
    y0: 0,
    dx: 1,
    dy: 1,
    data_min: 0,
    data_max: 1,
    xlabel: "",
    ylabel: "",
    zlabel: "",
    xunit: "",
    yunit: "",
    zunit: "",
    ...fields,
  } as ImageData;
}

/** 8×6 image, pixel centers at 10 + 0.5·i and -3 + 2·j. */
const CALIBRATED = makeImage({
  width: 8,
  height: 6,
  x0: 10,
  y0: -3,
  dx: 0.5,
  dy: 2,
});

/** 4×3 non-uniform image. */
const NON_UNIFORM = makeImage({
  width: 4,
  height: 3,
  is_uniform_coords: false,
  xcoords: [0, 1.5, 4, 9],
  ycoords: [0, 2, 5],
});

const DEFAULTS = {
  nx: 3,
  ny: 3,
  xtranslation: 50,
  ytranslation: 50,
  xsize: 50,
  ysize: 50,
  xstep: 100,
  ystep: 100,
  base_name: "ROI",
  name_pattern: "{base}({r},{c})",
  xdirection: "increasing",
  ydirection: "increasing",
};

function rects(rois: ImageRoiSegment[]): Rect[] {
  return rois.map((roi) => {
    if (roi.geometry !== "rectangle") throw new Error("not a rectangle");
    return [roi.title ?? "", roi.x0, roi.y0, roi.dx, roi.dy];
  });
}

function expectRects(actual: Rect[], expected: Rect[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((rect, k) => {
    expect(rect[0]).toBe(expected[k][0]);
    for (let i = 1; i < 5; i++) {
      expect(rect[i] as number).toBeCloseTo(expected[k][i] as number, 9);
    }
  });
}

describe("computeRoiGridPreview (Sigima generate_image_grid_roi)", () => {
  it("matches Sigima with the default parameters", () => {
    expectRects(rects(computeRoiGridPreview(CALIBRATED, DEFAULTS)), [
      ["ROI(1,1)", 10.25, -4, 0.5, 2],
      ["ROI(1,2)", 11.25, -4, 1, 2],
      ["ROI(1,3)", 12.75, -4, 0.5, 2],
      ["ROI(2,1)", 10.25, 0, 0.5, 2],
      ["ROI(2,2)", 11.25, 0, 1, 2],
      ["ROI(2,3)", 12.75, 0, 0.5, 2],
      ["ROI(3,1)", 10.25, 4, 0.5, 2],
      ["ROI(3,2)", 11.25, 4, 1, 2],
      ["ROI(3,3)", 12.75, 4, 0.5, 2],
    ]);
  });

  it("tiles the pixels of the image exactly with full cells", () => {
    const values = { ...DEFAULTS, nx: 4, ny: 2, xsize: 100, ysize: 100 };
    expectRects(rects(computeRoiGridPreview(CALIBRATED, values)), [
      ["ROI(1,1)", 9.75, -4, 1, 6],
      ["ROI(1,2)", 10.75, -4, 1, 6],
      ["ROI(1,3)", 11.75, -4, 1, 6],
      ["ROI(1,4)", 12.75, -4, 1, 6],
      ["ROI(2,1)", 9.75, 2, 1, 6],
      ["ROI(2,2)", 10.75, 2, 1, 6],
      ["ROI(2,3)", 11.75, 2, 1, 6],
      ["ROI(2,4)", 12.75, 2, 1, 6],
    ]);
  });

  it("applies translations, steps and decreasing directions", () => {
    const values = {
      ...DEFAULTS,
      nx: 2,
      ny: 2,
      xsize: 40,
      ysize: 60,
      xtranslation: 30,
      ytranslation: 70,
      xstep: 150,
      ystep: 80,
      xdirection: "decreasing",
      ydirection: "decreasing",
    };
    expectRects(rects(computeRoiGridPreview(CALIBRATED, values)), [
      ["ROI(2,2)", 10.25, -2, 0.5, 4],
      ["ROI(2,1)", 13.25, -2, 0.5, 4],
      ["ROI(1,2)", 10.25, 4, 0.5, 4],
      ["ROI(1,1)", 13.25, 4, 0.5, 4],
    ]);
  });

  it("keeps a zero translation", () => {
    const values = { ...DEFAULTS, nx: 2, ny: 1, ysize: 100, xtranslation: 0 };
    expectRects(rects(computeRoiGridPreview(CALIBRATED, values)), [
      ["ROI(1,1)", 8.25, -4, 1, 12],
      ["ROI(1,2)", 10.25, -4, 1, 12],
    ]);
  });

  it("lays the grid over the bin edges of non-uniform images", () => {
    const full = { ...DEFAULTS, nx: 2, ny: 1, xsize: 100, ysize: 100 };
    expectRects(rects(computeRoiGridPreview(NON_UNIFORM, full)), [
      ["ROI(1,1)", -0.75, -1, 7.25, 7.5],
      ["ROI(1,2)", 6.5, -1, 5, 7.5],
    ]);
    // Cells holding no pixel center stay as empty rectangles, like Sigima.
    expectRects(rects(computeRoiGridPreview(NON_UNIFORM, DEFAULTS)), [
      ["ROI(1,1)", 0.75, -1, 2, 2],
      ["ROI(1,2)", 6.5, -1, 0, 2],
      ["ROI(1,3)", 6.5, -1, 5, 2],
      ["ROI(2,1)", 0.75, 3.5, 2, 0],
      ["ROI(2,2)", 6.5, 3.5, 0, 0],
      ["ROI(2,3)", 6.5, 3.5, 5, 0],
      ["ROI(3,1)", 0.75, 3.5, 2, 3],
      ["ROI(3,2)", 6.5, 3.5, 0, 3],
      ["ROI(3,3)", 6.5, 3.5, 5, 3],
    ]);
  });

  it("keeps empty cells and zero sizes like Sigima", () => {
    const small = makeImage({ width: 4, height: 4 });
    const narrow = { ...DEFAULTS, nx: 8, ny: 1, xsize: 100, ysize: 100 };
    expectRects(rects(computeRoiGridPreview(small, narrow)), [
      ["ROI(1,1)", -0.5, -0.5, 0, 4],
      ["ROI(1,2)", -0.5, -0.5, 1, 4],
      ["ROI(1,3)", 0.5, -0.5, 0, 4],
      ["ROI(1,4)", 0.5, -0.5, 1, 4],
      ["ROI(1,5)", 1.5, -0.5, 0, 4],
      ["ROI(1,6)", 1.5, -0.5, 1, 4],
      ["ROI(1,7)", 2.5, -0.5, 0, 4],
      ["ROI(1,8)", 2.5, -0.5, 1, 4],
    ]);
    const flat = { ...DEFAULTS, nx: 2, ny: 2, xsize: 0, ysize: 50 };
    expectRects(rects(computeRoiGridPreview(small, flat)), [
      ["ROI(1,1)", 0.5, -0.5, 0, 1],
      ["ROI(1,2)", 2.5, -0.5, 0, 1],
      ["ROI(2,1)", 0.5, 1.5, 0, 1],
      ["ROI(2,2)", 2.5, 1.5, 0, 1],
    ]);
  });
});
