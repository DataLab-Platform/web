/**
 * Unit tests for the image axis helpers (Sigima pixel-center convention).
 *
 * ``x0``/``y0`` are the centers of the first pixel and ``xcoords``/``ycoords``
 * the pixel centers of non-uniform images: every conversion between physical
 * coordinates and pixels in the viewers relies on these helpers, which mirror
 * Sigima's ``axis_to_float_indices`` / ``axis_to_physical``.
 */
import { describe, it, expect } from "vitest";
import {
  type ImageAxes,
  axisToFloatIndex,
  axisToPhysical,
  imageCenter,
  imageExtent,
  pixelCenters,
  pixelEdges,
  pixelIndexAt,
  pixelRangeOverlapping,
} from "../../../src/utils/pixelCenters";
import { toBins } from "../../../src/utils/imageCoords";

/** Example of DataLab-Platform/web#69: 4×4 image, ``x0 = y0 = 0``. */
const SQUARE: ImageAxes = { width: 4, height: 4, x0: 0, y0: 0, dx: 1, dy: 1 };

/** Calibrated image with rectangular pixels. */
const CALIBRATED: ImageAxes = {
  width: 8,
  height: 6,
  x0: 10,
  y0: -3,
  dx: 0.5,
  dy: 2,
};

/** Non-uniform image (PlotPy ``to_bins`` reference centers). */
const NON_UNIFORM: ImageAxes = {
  width: 4,
  height: 3,
  x0: 0,
  y0: 0,
  dx: 1,
  dy: 1,
  is_uniform_coords: false,
  xcoords: [0, 1.5, 4, 9],
  ycoords: [0, 2, 5],
};

describe("pixel centers and edges", () => {
  it("centers the pixels on x0 + i·dx", () => {
    expect(pixelCenters(SQUARE, "x")).toEqual([0, 1, 2, 3]);
    expect(pixelCenters(CALIBRATED, "x")).toEqual([
      10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5,
    ]);
    expect(pixelCenters(CALIBRATED, "y")).toEqual([-3, -1, 1, 3, 5, 7]);
  });

  it("puts the outer edges half a pixel before the first center", () => {
    expect(pixelEdges(SQUARE, "x")).toEqual([-0.5, 0.5, 1.5, 2.5, 3.5]);
    expect(pixelEdges(CALIBRATED, "y")).toEqual([-4, -2, 0, 2, 4, 6, 8]);
  });

  it("uses the PlotPy bin edges of non-uniform images", () => {
    expect(pixelCenters(NON_UNIFORM, "x")).toEqual([0, 1.5, 4, 9]);
    expect(pixelEdges(NON_UNIFORM, "x")).toEqual(toBins([0, 1.5, 4, 9]));
    expect(pixelEdges(NON_UNIFORM, "y")).toEqual(toBins([0, 2, 5]));
  });

  it("ignores coordinate arrays of uniform images", () => {
    const img = { ...SQUARE, xcoords: [5, 6, 7, 8], is_uniform_coords: true };
    expect(pixelCenters(img, "x")).toEqual([0, 1, 2, 3]);
  });
});

describe("axisToFloatIndex / axisToPhysical", () => {
  it("converts uniform coordinates both ways", () => {
    expect(axisToFloatIndex(CALIBRATED, "x", 11.25)).toBe(2.5);
    expect(axisToPhysical(CALIBRATED, "x", 2.5)).toBe(11.25);
    expect(axisToFloatIndex(CALIBRATED, "y", -4)).toBe(-0.5);
  });

  it("interpolates between non-uniform centers", () => {
    expect(axisToFloatIndex(NON_UNIFORM, "x", 2.75)).toBe(1.5);
    expect(axisToPhysical(NON_UNIFORM, "x", 1.5)).toBe(2.75);
  });

  it("extrapolates beyond non-uniform ends with the end spacing", () => {
    // First spacing 1.5, last spacing 5 (Sigima ``_extrapolated_interp``).
    expect(axisToPhysical(NON_UNIFORM, "x", -1)).toBe(-1.5);
    expect(axisToPhysical(NON_UNIFORM, "x", 4)).toBe(14);
    expect(axisToFloatIndex(NON_UNIFORM, "x", -1.5)).toBe(-1);
    expect(axisToFloatIndex(NON_UNIFORM, "x", 14)).toBe(4);
  });

  it("supports decreasing non-uniform centers", () => {
    const img = { ...NON_UNIFORM, xcoords: [9, 4, 1.5, 0] };
    expect(axisToFloatIndex(img, "x", 2.75)).toBe(1.5);
    expect(axisToPhysical(img, "x", 1.5)).toBe(2.75);
    expect(axisToFloatIndex(img, "x", 14)).toBe(-1);
  });

  it("uses a unit slope for a single non-uniform center", () => {
    const img: ImageAxes = {
      ...NON_UNIFORM,
      width: 1,
      xcoords: [3],
    };
    expect(axisToPhysical(img, "x", -0.5)).toBe(2.5);
    expect(axisToFloatIndex(img, "x", 3.5)).toBe(0.5);
  });
});

describe("imageExtent / imageCenter", () => {
  it("spans the outer edges of the pixels", () => {
    expect(imageExtent(SQUARE)).toEqual({
      xMin: -0.5,
      xMax: 3.5,
      yMin: -0.5,
      yMax: 3.5,
    });
    expect(imageExtent(CALIBRATED)).toEqual({
      xMin: 9.75,
      xMax: 13.75,
      yMin: -4,
      yMax: 8,
    });
    expect(imageExtent(NON_UNIFORM)).toEqual({
      xMin: -0.75,
      xMax: 11.5,
      yMin: -1,
      yMax: 6.5,
    });
  });

  it("returns the center of the pixel grid (Sigima ImageObj.xc/yc)", () => {
    expect(imageCenter(SQUARE)).toEqual({ x: 1.5, y: 1.5 });
    expect(imageCenter(CALIBRATED)).toEqual({ x: 11.75, y: 2 });
    expect(imageCenter(NON_UNIFORM)).toEqual({ x: 4.5, y: 2.5 });
  });
});

describe("pixelIndexAt", () => {
  it("returns the pixel whose center is the closest", () => {
    expect(pixelIndexAt(SQUARE, "x", 0)).toBe(0);
    expect(pixelIndexAt(SQUARE, "x", 0.49)).toBe(0);
    expect(pixelIndexAt(SQUARE, "x", 0.51)).toBe(1);
    expect(pixelIndexAt(CALIBRATED, "y", 2.1)).toBe(3);
  });

  it("assigns a boundary to the next pixel", () => {
    expect(pixelIndexAt(SQUARE, "x", 0.5)).toBe(1);
    expect(pixelIndexAt(NON_UNIFORM, "x", 0.75)).toBe(1);
    expect(pixelIndexAt(NON_UNIFORM, "x", 2.75)).toBe(2);
    expect(pixelIndexAt(NON_UNIFORM, "x", 6.5)).toBe(3);
  });

  it("locates non-uniform pixels", () => {
    expect(pixelIndexAt(NON_UNIFORM, "x", 0)).toBe(0);
    expect(pixelIndexAt(NON_UNIFORM, "x", 1.5)).toBe(1);
    expect(pixelIndexAt(NON_UNIFORM, "x", 4)).toBe(2);
    expect(pixelIndexAt(NON_UNIFORM, "x", 9)).toBe(3);
  });

  it("includes both outer edges of the image", () => {
    expect(pixelIndexAt(SQUARE, "x", -0.5)).toBe(0);
    expect(pixelIndexAt(SQUARE, "x", 3.5)).toBe(3);
    expect(pixelIndexAt(NON_UNIFORM, "x", -0.75)).toBe(0);
    expect(pixelIndexAt(NON_UNIFORM, "x", 11.5)).toBe(3);
  });

  it("returns -1 outside the image", () => {
    expect(pixelIndexAt(SQUARE, "x", -0.51)).toBe(-1);
    expect(pixelIndexAt(SQUARE, "y", 3.51)).toBe(-1);
    expect(pixelIndexAt(NON_UNIFORM, "x", -1)).toBe(-1);
    expect(pixelIndexAt(NON_UNIFORM, "x", 12)).toBe(-1);
    expect(pixelIndexAt(SQUARE, "x", NaN)).toBe(-1);
  });
});

describe("pixelRangeOverlapping", () => {
  it("selects every pixel the interval covers, even partly", () => {
    // [0.2, 1.7] covers pixel 0 ([-0.5, 0.5]) to pixel 2 ([1.5, 2.5]).
    expect(pixelRangeOverlapping(SQUARE, "x", 0.2, 1.7)).toEqual([0, 3]);
    expect(pixelRangeOverlapping(SQUARE, "x", 1.7, 0.2)).toEqual([0, 3]);
  });

  it("does not add a pixel merely touched by a bound", () => {
    expect(pixelRangeOverlapping(SQUARE, "x", 0.5, 2.5)).toEqual([1, 3]);
    expect(
      pixelRangeOverlapping(CALIBRATED, "x", 9.75 + 0.5, 9.75 + 1.5),
    ).toEqual([1, 3]);
  });

  it("clips the range to the image", () => {
    expect(pixelRangeOverlapping(SQUARE, "x", -10, 10)).toEqual([0, 4]);
    const [i0, i1] = pixelRangeOverlapping(SQUARE, "x", 5, 6);
    expect(i1).toBeLessThanOrEqual(i0);
  });

  it("uses the bin edges of non-uniform images", () => {
    expect(pixelRangeOverlapping(NON_UNIFORM, "x", 1, 3)).toEqual([1, 3]);
    expect(pixelRangeOverlapping(NON_UNIFORM, "x", 0.75, 2.75)).toEqual([1, 2]);
  });
});
