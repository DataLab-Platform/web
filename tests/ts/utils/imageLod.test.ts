/**
 * Unit tests for the level-of-detail (LOD) image helpers.
 *
 * These pure functions decide which source pixels are visible, at what
 * stride they are rasterised, and where the resulting bitmap is placed.
 * Pixel-coordinate exactness matters: ``x0``/``y0`` are the centers of the
 * first pixel (Sigima convention), and an off-by-half-pixel here would shift
 * the displayed image relative to overlays, ROIs and the (full-resolution)
 * hover read-out.  The windowed paint helper is also checked to confirm the
 * three resampling methods aggregate the **data** (not colours) correctly.
 */
import { describe, it, expect } from "vitest";
import {
  type ImageGeometry,
  DEFAULT_MAX_RASTER_DIM,
  LOD_MIN_PIXELS,
  rasterPlan,
  shouldUseLod,
  visibleWindow,
  windowPlacement,
} from "../../../src/utils/imageLod";
import {
  planImageRaster,
  visibleRasterBudget,
} from "../../../src/utils/imageRaster";
import { paintImageWindow } from "../../../src/utils/colormap";

const GEOM: ImageGeometry = {
  width: 4096,
  height: 4096,
  x0: 0,
  y0: 0,
  dx: 1,
  dy: 1,
};

describe("shouldUseLod", () => {
  it("engages above 1 megapixel", () => {
    expect(shouldUseLod(4096, 4096)).toBe(true);
    expect(shouldUseLod(2000, 600)).toBe(true);
  });

  it("stays on the simple path at or below 1 megapixel", () => {
    expect(shouldUseLod(1024, 1024)).toBe(false); // exactly LOD_MIN_PIXELS
    expect(shouldUseLod(512, 512)).toBe(false);
    expect(LOD_MIN_PIXELS).toBe(1024 * 1024);
  });
});

describe("visibleWindow", () => {
  it("returns the full image for a null view", () => {
    expect(visibleWindow(GEOM, null)).toEqual({
      i0: 0,
      i1: 4096,
      j0: 0,
      j1: 4096,
    });
  });

  it("maps a zoom rectangle to pixel indices (Y reversed)", () => {
    // Plotly reports Y reversed; the helper normalises with min/max.  Pixel
    // ``i`` is centered on ``i`` and covers ``[i - 0.5, i + 0.5)``.
    const win = visibleWindow(GEOM, { x: [99.5, 199.5], y: [299.5, 199.5] });
    expect(win).toEqual({ i0: 100, i1: 200, j0: 200, j1: 300 });
  });

  it("includes the pixels whose half lies in the view", () => {
    // [100, 200] covers the right half of pixel 100 and the left half of 200.
    const win = visibleWindow(GEOM, { x: [100, 200], y: [300, 200] });
    expect(win).toEqual({ i0: 100, i1: 201, j0: 200, j1: 301 });
  });

  it("clamps a partially out-of-bounds view to the image", () => {
    const win = visibleWindow(GEOM, { x: [-50, 49.5], y: [49.5, -50] });
    expect(win).toEqual({ i0: 0, i1: 50, j0: 0, j1: 50 });
  });

  it("never returns an empty window past the right/bottom edge", () => {
    const win = visibleWindow(GEOM, { x: [5000, 6000], y: [6000, 5000] });
    expect(win.i1).toBeGreaterThan(win.i0);
    expect(win.j1).toBeGreaterThan(win.j0);
    expect(win).toEqual({ i0: 4095, i1: 4096, j0: 4095, j1: 4096 });
  });

  it("covers a sub-pixel view with at least one pixel", () => {
    const win = visibleWindow(GEOM, { x: [99.8, 100.2], y: [100.2, 99.8] });
    expect(win).toEqual({ i0: 100, i1: 101, j0: 100, j1: 101 });
  });

  it("honours a non-trivial origin and spacing", () => {
    const geom: ImageGeometry = {
      width: 100,
      height: 100,
      x0: 10,
      y0: 20,
      dx: 0.5,
      dy: 2,
    };
    // x: [19.75, 29.75] → (x-10)/0.5 + 0.5 = [20, 40];
    // y: [59, 39] → (y-20)/2 + 0.5 = [20, 10].
    const win = visibleWindow(geom, { x: [19.75, 29.75], y: [59, 39] });
    expect(win).toEqual({ i0: 20, i1: 40, j0: 10, j1: 20 });
  });
});

describe("rasterPlan", () => {
  it("renders 1:1 when zoomed in (window smaller than the display)", () => {
    const win = { i0: 100, i1: 110, j0: 200, j1: 215 };
    const plan = rasterPlan(win, 900, 900, 1);
    expect(plan).toEqual({
      i0: 100,
      j0: 200,
      cw: 10,
      ch: 15,
      strideX: 1,
      strideY: 1,
    });
  });

  it("decimates to the display resolution when zoomed out", () => {
    const win = { i0: 0, i1: 4096, j0: 0, j1: 4096 };
    const plan = rasterPlan(win, 900, 900, 1);
    // availX = min(2048, 900) = 900 → stride = ceil(4096/900) = 5.
    expect(plan.strideX).toBe(5);
    expect(plan.strideY).toBe(5);
    expect(plan.cw).toBe(Math.ceil(4096 / 5));
    expect(plan.ch).toBe(Math.ceil(4096 / 5));
  });

  it("caps the output at maxDim even on hi-DPI displays", () => {
    const win = { i0: 0, i1: 4096, j0: 0, j1: 4096 };
    const plan = rasterPlan(win, 4000, 4000, 2, DEFAULT_MAX_RASTER_DIM);
    // plotW*dpr = 8000 but capped to 2048 → stride = ceil(4096/2048) = 2.
    expect(plan.strideX).toBe(2);
    expect(plan.cw).toBe(2048);
  });

  it("accounts for the device pixel ratio when zooming in", () => {
    const win = { i0: 0, i1: 1500, j0: 0, j1: 1500 };
    // availX = min(2048, 800*2) = 1600 → 1500 ≤ 1600 → 1:1.
    const plan = rasterPlan(win, 800, 800, 2);
    expect(plan.strideX).toBe(1);
    expect(plan.cw).toBe(1500);
  });
});

describe("windowPlacement", () => {
  it("places a 1:1 window at the outer edge of its first pixel", () => {
    const plan = { i0: 100, j0: 200, cw: 10, ch: 15, strideX: 1, strideY: 1 };
    expect(windowPlacement(plan, GEOM)).toEqual({
      x: 99.5,
      dx: 1,
      y: 199.5,
      dy: 1,
    });
  });

  it("scales the cell size by the stride when decimating", () => {
    const plan = { i0: 0, j0: 0, cw: 820, ch: 820, strideX: 5, strideY: 5 };
    expect(windowPlacement(plan, GEOM)).toEqual({
      x: -0.5,
      dx: 5,
      y: -0.5,
      dy: 5,
    });
  });

  it("respects a non-trivial origin and spacing", () => {
    const geom: ImageGeometry = {
      width: 100,
      height: 100,
      x0: 10,
      y0: 20,
      dx: 0.5,
      dy: 2,
    };
    const plan = { i0: 100, j0: 10, cw: 5, ch: 5, strideX: 2, strideY: 3 };
    expect(windowPlacement(plan, geom)).toEqual({
      x: 10 + (100 - 0.5) * 0.5,
      dx: 0.5 * 2,
      y: 20 + (10 - 0.5) * 2,
      dy: 2 * 3,
    });
  });
});

describe("pixel-center convention (x0/y0 = center of the first pixel)", () => {
  it("draws a 4×4 image with x0 = y0 = 0 over [-0.5, 3.5]", () => {
    // Sigima pixel centers are at 0, 1, 2, 3: the image spans [-0.5, 3.5].
    const geometry = { width: 4, height: 4, x0: 0, y0: 0, dx: 1, dy: 1 };
    const raster = planImageRaster(geometry, null, { w: 400, h: 400 }, 1);
    expect(raster?.placement).toEqual({
      x: -0.5,
      dx: 1,
      y: -0.5,
      dy: 1,
      cw: 4,
      ch: 4,
    });
  });

  it("centers the pixels of a calibrated image on x0 + i·dx", () => {
    const geometry = { width: 8, height: 6, x0: 10, y0: -3, dx: 0.5, dy: 2 };
    const raster = planImageRaster(geometry, null, { w: 400, h: 400 }, 1);
    const p = raster!.placement;
    // Center of output cell ``i`` = x + (i + 0.5)·dx = x0 + i·dx.
    expect(p.x + 0.5 * p.dx).toBe(10);
    expect(p.y + 0.5 * p.dy).toBe(-3);
    expect(p.x + p.cw * p.dx).toBe(10 + 7.5 * 0.5);
    expect(p.y + p.ch * p.dy).toBe(-3 + 5.5 * 2);
  });

  it("keeps an image whose outer half-pixel only is in view", () => {
    const geometry = { width: 4, height: 4, x0: 0, y0: 0, dx: 1, dy: 1 };
    const view = {
      x: [-2, -0.25] as [number, number],
      y: [3.25, 2] as [number, number],
    };
    expect(planImageRaster(geometry, view, { w: 400, h: 400 }, 1)).not.toBe(
      null,
    );
    const outside = {
      x: [-2, -0.6] as [number, number],
      y: [3.25, 2] as [number, number],
    };
    expect(planImageRaster(geometry, outside, { w: 400, h: 400 }, 1)).toBe(
      null,
    );
  });
});

describe("shared spatial raster planning", () => {
  it("assigns four 2048² images their on-screen share of the viewport", () => {
    // The four images tile [-0.5, 4095.5]² (pixel centers 0…4095).
    const view = {
      x: [-0.5, 4095.5] as [number, number],
      y: [4095.5, -0.5] as [number, number],
    };
    const origins = [
      [0, 0],
      [2048, 0],
      [0, 2048],
      [2048, 2048],
    ];
    for (const [x0, y0] of origins) {
      const geometry = { ...GEOM, width: 2048, height: 2048, x0, y0 };
      const window = visibleWindow(geometry, view);
      expect(
        visibleRasterBudget(geometry, window, view, { w: 1000, h: 800 }),
      ).toEqual({ w: 500, h: 400 });
      const raster = planImageRaster(geometry, view, { w: 1000, h: 800 }, 1);
      expect(raster).not.toBeNull();
      expect(raster!.plan.cw).toBeLessThanOrEqual(500);
      expect(raster!.plan.ch).toBeLessThanOrEqual(400);
      // Upper-left corner = outer edge of the first pixel.
      expect(raster!.placement.x).toBe(x0 - 0.5);
      expect(raster!.placement.y).toBe(y0 - 0.5);
    }
  });

  it("skips off-screen images and restores exact pixels after zoom", () => {
    // Pixels 10…25 of the visible image (centers 2058…2073) and rows 0…15.
    const zoom = {
      x: [2057.5, 2073.5] as [number, number],
      y: [15.5, -0.5] as [number, number],
    };
    const visible = { ...GEOM, width: 2048, height: 2048, x0: 2048 };
    const hidden = { ...GEOM, width: 2048, height: 2048, x0: 0 };
    expect(planImageRaster(hidden, zoom, { w: 1000, h: 800 }, 1)).toBeNull();
    const raster = planImageRaster(visible, zoom, { w: 1000, h: 800 }, 1);
    expect(raster?.plan).toEqual({
      i0: 10,
      j0: 0,
      cw: 16,
      ch: 16,
      strideX: 1,
      strideY: 1,
    });
    expect(raster?.placement).toEqual({
      x: 2057.5,
      dx: 1,
      y: -0.5,
      dy: 1,
      cw: 16,
      ch: 16,
    });
  });
});

// ---------------------------------------------------------------------------
// paintImageWindow — resampling correctness
// ---------------------------------------------------------------------------

/** Minimal stand-in for ``createImageData`` so the helper runs under jsdom. */
function fakeCtx() {
  return {
    createImageData(w: number, h: number) {
      return {
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4),
        colorSpace: "srgb" as const,
      };
    },
  } as unknown as CanvasRenderingContext2D;
}

/** A 4×4 grid where ``rows[j][i] = j*4 + i`` (values 0…15). */
function ramp4(): number[][] {
  return [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [8, 9, 10, 11],
    [12, 13, 14, 15],
  ];
}

/** Decode the red channel of every output cell (the 'gray' colormap maps
 *  value → grey linearly, so R = round((v - zmin)/(zmax - zmin) * 255)). */
function reds(img: ImageData): number[] {
  const out: number[] = [];
  for (let p = 0; p < img.data.length; p += 4) out.push(img.data[p]);
  return out;
}

describe("paintImageWindow", () => {
  it("renders a 1:1 window exactly (fast path)", () => {
    const img = paintImageWindow(
      fakeCtx(),
      ramp4(),
      4,
      4,
      { i0: 0, j0: 0, cw: 4, ch: 4, strideX: 1, strideY: 1 },
      0,
      15,
      "gray",
      false,
      "nearest",
    );
    // R = round(v/15*255) for v = 0..15.
    expect(reds(img)).toEqual(
      ramp4()
        .flat()
        .map((v) => Math.round((v / 15) * 255)),
    );
  });

  it("samples the block top-left under 'nearest'", () => {
    const img = paintImageWindow(
      fakeCtx(),
      ramp4(),
      4,
      4,
      { i0: 0, j0: 0, cw: 2, ch: 2, strideX: 2, strideY: 2 },
      0,
      15,
      "gray",
      false,
      "nearest",
    );
    // Top-left of each 2×2 block: 0, 2, 8, 10.
    expect(reds(img)).toEqual(
      [0, 2, 8, 10].map((v) => Math.round((v / 15) * 255)),
    );
  });

  it("keeps the brightest pixel under 'max'", () => {
    const img = paintImageWindow(
      fakeCtx(),
      ramp4(),
      4,
      4,
      { i0: 0, j0: 0, cw: 2, ch: 2, strideX: 2, strideY: 2 },
      0,
      15,
      "gray",
      false,
      "max",
    );
    // max of each 2×2 block: 5, 7, 13, 15.
    expect(reds(img)).toEqual(
      [5, 7, 13, 15].map((v) => Math.round((v / 15) * 255)),
    );
  });

  it("averages the block under 'mean'", () => {
    const img = paintImageWindow(
      fakeCtx(),
      ramp4(),
      4,
      4,
      { i0: 0, j0: 0, cw: 2, ch: 2, strideX: 2, strideY: 2 },
      0,
      15,
      "gray",
      false,
      "mean",
    );
    // mean of each 2×2 block: 2.5, 4.5, 10.5, 12.5.
    expect(reds(img)).toEqual(
      [2.5, 4.5, 10.5, 12.5].map((v) => Math.round((v / 15) * 255)),
    );
  });

  it("ignores NaN in aggregation and clamps blocks to the image edge", () => {
    const rows = [
      [0, 1, 2],
      [4, NaN, 6],
      [8, 9, 10],
    ];
    // 3×3 image, stride 2 → 2×2 output; the right/bottom blocks are clipped.
    const img = paintImageWindow(
      fakeCtx(),
      rows,
      3,
      3,
      { i0: 0, j0: 0, cw: 2, ch: 2, strideX: 2, strideY: 2 },
      0,
      10,
      "gray",
      false,
      "mean",
    );
    // block(0,0): mean of 0,1,4 (NaN skipped) = 5/3.
    // block(0,1): mean of 2,6 = 4.   block(1,0): mean of 8,9 = 8.5.
    // block(1,1): single pixel 10.
    expect(reds(img)).toEqual(
      [5 / 3, 4, 8.5, 10].map((v) => Math.round((v / 10) * 255)),
    );
  });

  it("renders an all-NaN block as fully transparent", () => {
    const rows = [
      [NaN, NaN],
      [NaN, NaN],
    ];
    const img = paintImageWindow(
      fakeCtx(),
      rows,
      2,
      2,
      { i0: 0, j0: 0, cw: 1, ch: 1, strideX: 2, strideY: 2 },
      0,
      1,
      "gray",
      false,
      "max",
    );
    expect(img.data[3]).toBe(0); // alpha = 0
  });
});
