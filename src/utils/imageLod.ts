/**
 * Level-of-detail (LOD) helpers for the single-image viewer.
 *
 * Scientific imaging requires the *display* bitmap to stay faithful to the
 * underlying pixels: when the user zooms to a few pixels the viewer must show
 * exact, crisp samples; when zoomed out it must not invent or hide hot pixels.
 * At the same time, rasterising a full 4096² (or larger) image into an RGBA
 * canvas on every render is expensive in both CPU and transient memory (a
 * 4096² canvas is 64 MiB of RGBA plus a multi-MB base64 PNG).
 *
 * The functions below are **pure** (no DOM, no Plotly) so they can be unit
 * tested exhaustively.  They compute, from the current axis ranges and the
 * on-screen plot size, *which* source pixels are visible and at *what* stride
 * they should be rasterised, plus the exact image-trace placement so the
 * decimated bitmap lands on the same physical coordinates as the full image.
 *
 * Invariant: these helpers only drive the **display bitmap**.  Profiles,
 * statistics, histograms and hover read-outs always read the full-resolution
 * ``data.data`` and are never affected by the LOD path.
 */

/** Uniform-image geometry: pixel (i, j) covers physical X in
 *  ``[x0 + i*dx, x0 + (i+1)*dx)`` and Y in ``[y0 + j*dy, y0 + (j+1)*dy)``.
 *  ``x0``/``y0`` are the upper-left corner of the first pixel (the Plotly
 *  ``image``-trace convention, with no half-pixel offset). */
export interface ImageGeometry {
  width: number;
  height: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
}

/** Axis ranges in physical (data) coordinates.  Order-agnostic: Plotly
 *  reports the Y range reversed (``[yMax, yMin]``) for images. */
export interface ViewRange {
  x: [number, number];
  y: [number, number];
}

/** Integer pixel window ``[i0, i1) × [j0, j1)`` (i1/j1 exclusive), clamped to
 *  the image bounds.  Always non-empty (at least 1×1). */
export interface PixelWindow {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

/** Rasterisation plan: which window, at what stride, producing a
 *  ``cw × ch`` output bitmap. */
export interface RasterPlan {
  /** Top-left source pixel of the window. */
  i0: number;
  j0: number;
  /** Output bitmap dimensions (pixels actually rasterised). */
  cw: number;
  ch: number;
  /** Number of source pixels aggregated per output cell along each axis. */
  strideX: number;
  strideY: number;
}

/** How source pixels are aggregated into one output cell when downsampling
 *  (stride > 1).  ``nearest`` is fastest and matches a plain decimation;
 *  ``max`` preserves bright/hot pixels (important for peak imaging);
 *  ``mean`` smooths noise.  Ignored when stride is 1 (zoomed in). */
export type ResampleMethod = "nearest" | "max" | "mean";

/** Default upper bound on the rasterised bitmap's largest dimension. Keeps
 *  the transient canvas / PNG small even on very large displays. */
export const DEFAULT_MAX_RASTER_DIM = 2048;

/** Images with at most this many pixels are always rasterised at full
 *  resolution (stride 1, whole image) — the LOD machinery brings no benefit
 *  and the simple path is the safest for fidelity. */
export const LOD_MIN_PIXELS = 1024 * 1024;

/** Whether the LOD path should engage for an image of ``width × height``. */
export function shouldUseLod(width: number, height: number): boolean {
  return width * height > LOD_MIN_PIXELS;
}

/**
 * Compute the integer pixel window visible for the given axis ranges.
 *
 * The returned window is clamped to ``[0, width] × [0, height]`` and is always
 * non-empty.  When ``view`` is ``null`` the whole image is returned.
 *
 * @param geom Uniform-image geometry.
 * @param view Current axis ranges in physical coords, or ``null`` for the full
 *  extent.
 */
export function visibleWindow(
  geom: ImageGeometry,
  view: ViewRange | null,
): PixelWindow {
  const { width, height, x0, y0, dx, dy } = geom;
  if (view === null) {
    return { i0: 0, i1: width, j0: 0, j1: height };
  }
  const xa = (view.x[0] - x0) / dx;
  const xb = (view.x[1] - x0) / dx;
  const ya = (view.y[0] - y0) / dy;
  const yb = (view.y[1] - y0) / dy;
  let i0 = Math.floor(Math.min(xa, xb));
  let i1 = Math.ceil(Math.max(xa, xb));
  let j0 = Math.floor(Math.min(ya, yb));
  let j1 = Math.ceil(Math.max(ya, yb));
  i0 = clamp(i0, 0, width);
  i1 = clamp(i1, 0, width);
  j0 = clamp(j0, 0, height);
  j1 = clamp(j1, 0, height);
  if (i1 <= i0) {
    if (i0 >= width) i0 = width - 1;
    i1 = i0 + 1;
  }
  if (j1 <= j0) {
    if (j0 >= height) j0 = height - 1;
    j1 = j0 + 1;
  }
  return { i0, i1, j0, j1 };
}

/**
 * Decide the rasterisation stride and output bitmap size for a window.
 *
 * When the window is smaller than the available display resolution (the user
 * is zoomed in) the stride is 1 and the output matches the window 1:1 — every
 * source pixel is shown.  When the window is larger (zoomed out) the stride is
 * the smallest integer that brings the output at or below the display
 * resolution, capped at ``maxDim``.
 *
 * @param win Visible pixel window.
 * @param plotW On-screen plot-area width in CSS pixels.
 * @param plotH On-screen plot-area height in CSS pixels.
 * @param dpr Device pixel ratio (``window.devicePixelRatio``).
 * @param maxDim Hard cap on the output's largest dimension.
 */
export function rasterPlan(
  win: PixelWindow,
  plotW: number,
  plotH: number,
  dpr: number,
  maxDim: number = DEFAULT_MAX_RASTER_DIM,
): RasterPlan {
  const nx = win.i1 - win.i0;
  const ny = win.j1 - win.j0;
  const availX = Math.max(1, Math.min(maxDim, Math.round(plotW * dpr)));
  const availY = Math.max(1, Math.min(maxDim, Math.round(plotH * dpr)));
  const strideX = nx > availX ? Math.ceil(nx / availX) : 1;
  const strideY = ny > availY ? Math.ceil(ny / availY) : 1;
  const cw = Math.ceil(nx / strideX);
  const ch = Math.ceil(ny / strideY);
  return { i0: win.i0, j0: win.j0, cw, ch, strideX, strideY };
}

/**
 * Physical placement of the rasterised bitmap as a Plotly ``image`` trace.
 *
 * Each output cell spans ``strideX × strideY`` source pixels, so the cell
 * size is ``dx*strideX`` / ``dy*strideY`` and the origin is the upper-left
 * corner of the first source pixel of the window — no half-pixel offset, as
 * the Plotly ``image`` trace expects.
 *
 * @param plan Rasterisation plan from :func:`rasterPlan`.
 * @param geom Uniform-image geometry.
 */
export function windowPlacement(
  plan: RasterPlan,
  geom: ImageGeometry,
): { x0: number; dx: number; y0: number; dy: number } {
  return {
    x0: geom.x0 + plan.i0 * geom.dx,
    dx: geom.dx * plan.strideX,
    y0: geom.y0 + plan.j0 * geom.dy,
    dy: geom.dy * plan.strideY,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
