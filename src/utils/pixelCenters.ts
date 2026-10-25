/**
 * Image axes following the Sigima convention: ``x0``/``y0`` are the physical
 * coordinates of the **center** of the first pixel, and images with
 * non-uniform coordinates carry the centers in ``xcoords``/``ycoords``.
 * Pixel ``i`` is centered on fractional index ``i`` and spans the indices
 * ``[i - ½, i + ½]``, so the image spans ``[x0 - dx/2, x0 + (width - ½)·dx]``.
 *
 * Sigima computations (profiles, ROIs, analyses) use these coordinates: every
 * conversion between physical coordinates and pixels in the viewers goes
 * through these helpers, which mirror ``ImageObj.axis_to_float_indices`` and
 * ``ImageObj.axis_to_physical``.
 */

import type { ImageData } from "../runtime/runtime";

/** Image fields describing its axes. */
export type ImageAxes = Pick<
  ImageData,
  | "width"
  | "height"
  | "x0"
  | "y0"
  | "dx"
  | "dy"
  | "is_uniform_coords"
  | "xcoords"
  | "ycoords"
>;

export type Axis = "x" | "y";

/** Tolerance (in pixel index units) under which a coordinate is considered to
 *  lie on a pixel boundary, so that rounding noise never adds or removes a
 *  pixel (Sigima's ``PIXEL_INDEX_TOLERANCE``). */
export const PIXEL_INDEX_TOLERANCE = 1e-9;

/** Number of pixels along an axis. */
function axisSize(img: ImageAxes, axis: Axis): number {
  return axis === "x" ? img.width : img.height;
}

/** Pixel-center coordinates of a non-uniform axis, or ``null`` when the axis
 *  is uniform (regular ``x0``/``dx`` grid). */
function nonUniformCenters(img: ImageAxes, axis: Axis): number[] | null {
  const coords = axis === "x" ? img.xcoords : img.ycoords;
  if (img.is_uniform_coords === false && coords?.length === axisSize(img, axis))
    return coords;
  return null;
}

/** Fractional index of ``v`` among monotonic (increasing or decreasing)
 *  pixel centers, extrapolated from the first and last intervals beyond the
 *  ends (slope 1 with a single center).  Mirrors Sigima's
 *  ``_extrapolated_interp`` with the indices as sample values. */
function floatIndexFromCenters(centers: ArrayLike<number>, v: number): number {
  const n = centers.length;
  if (n === 0) return NaN;
  if (n === 1) return v - centers[0];
  const ascending = centers[n - 1] >= centers[0];
  // Largest interval start ``k`` in ``[0, n - 2]`` whose center precedes ``v``.
  let lo = 0;
  let hi = n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ascending ? centers[mid] <= v : centers[mid] >= v) lo = mid;
    else hi = mid - 1;
  }
  return lo + (v - centers[lo]) / (centers[lo + 1] - centers[lo]);
}

/** Physical coordinate of fractional index ``index`` among pixel centers,
 *  extrapolated from the first and last intervals (inverse of
 *  :func:`floatIndexFromCenters`). */
function physicalFromCenters(
  centers: ArrayLike<number>,
  index: number,
): number {
  const n = centers.length;
  if (n === 0) return NaN;
  if (n === 1) return centers[0] + index;
  const k = Math.min(n - 2, Math.max(0, Math.floor(index)));
  return centers[k] + (index - k) * (centers[k + 1] - centers[k]);
}

/** Physical coordinates of the pixel centers along an axis. */
export function pixelCenters(img: ImageAxes, axis: Axis): number[] {
  const centers = nonUniformCenters(img, axis);
  if (centers) return centers;
  const origin = axis === "x" ? img.x0 : img.y0;
  const step = axis === "x" ? img.dx : img.dy;
  return Array.from(
    { length: axisSize(img, axis) },
    (_, i) => origin + i * step,
  );
}

/**
 * Convert a physical coordinate along one axis to a fractional pixel index.
 *
 * Pixel ``i`` is centered on index ``i``.  Values outside the image are
 * extrapolated linearly (first / last pixel spacing for non-uniform axes).
 */
export function axisToFloatIndex(
  img: ImageAxes,
  axis: Axis,
  v: number,
): number {
  const centers = nonUniformCenters(img, axis);
  if (centers) return floatIndexFromCenters(centers, v);
  const origin = axis === "x" ? img.x0 : img.y0;
  const step = axis === "x" ? img.dx : img.dy;
  return (v - origin) / step;
}

/**
 * Convert a fractional pixel index along one axis to a physical coordinate.
 *
 * Inverse of :func:`axisToFloatIndex`: index ``i - ½`` is the boundary between
 * pixels ``i - 1`` and ``i``.
 */
export function axisToPhysical(
  img: ImageAxes,
  axis: Axis,
  index: number,
): number {
  const centers = nonUniformCenters(img, axis);
  if (centers) return physicalFromCenters(centers, index);
  const origin = axis === "x" ? img.x0 : img.y0;
  const step = axis === "x" ? img.dx : img.dy;
  return origin + index * step;
}

/** Physical coordinates of the ``n + 1`` pixel boundaries along an axis, from
 *  the outer edge of the first pixel to the outer edge of the last one (the
 *  bin edges of PlotPy's ``to_bins`` for non-uniform axes). */
export function pixelEdges(img: ImageAxes, axis: Axis): number[] {
  return Array.from({ length: axisSize(img, axis) + 1 }, (_, i) =>
    axisToPhysical(img, axis, i - 0.5),
  );
}

/** Physical extent of an image, up to the outer edges of its pixels. */
export interface ImageExtent {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Physical extent of an image, up to the outer edges of its pixels. */
export function imageExtent(img: ImageAxes): ImageExtent {
  const bounds = (axis: Axis) => {
    const a = axisToPhysical(img, axis, -0.5);
    const b = axisToPhysical(img, axis, axisSize(img, axis) - 0.5);
    return [Math.min(a, b), Math.max(a, b)];
  };
  const [xMin, xMax] = bounds("x");
  const [yMin, yMax] = bounds("y");
  return { xMin, xMax, yMin, yMax };
}

/** Center of the pixel grid, midway between the centers of the first and last
 *  columns / rows (Sigima's ``ImageObj.xc``/``yc``). */
export function imageCenter(img: ImageAxes): { x: number; y: number } {
  const center = (axis: Axis) =>
    (axisToPhysical(img, axis, 0) +
      axisToPhysical(img, axis, axisSize(img, axis) - 1)) /
    2;
  return { x: center("x"), y: center("y") };
}

/**
 * Index of the pixel containing a physical coordinate along one axis.
 *
 * The pixel is the one whose center is the closest (``floor(f + ½)``, as in
 * Sigima's ``physical_to_indices``; a boundary belongs to the next pixel).
 * Returns ``-1`` outside the outer edges of the image (edges included).
 */
export function pixelIndexAt(img: ImageAxes, axis: Axis, v: number): number {
  const n = axisSize(img, axis);
  const f = axisToFloatIndex(img, axis, v);
  if (
    !Number.isFinite(f) ||
    f < -0.5 - PIXEL_INDEX_TOLERANCE ||
    f > n - 0.5 + PIXEL_INDEX_TOLERANCE
  )
    return -1;
  return Math.min(n - 1, Math.max(0, Math.floor(f + 0.5)));
}

/**
 * Pixels covered, even partly, by the physical interval ``[a, b]`` along one
 * axis (bounds in any order), clipped to the image.
 *
 * @returns ``[i0, i1]``: pixels ``i0`` to ``i1 - 1`` (empty when
 *  ``i1 <= i0``).
 */
export function pixelRangeOverlapping(
  img: ImageAxes,
  axis: Axis,
  a: number,
  b: number,
): [number, number] {
  const n = axisSize(img, axis);
  const fa = axisToFloatIndex(img, axis, a) + 0.5;
  const fb = axisToFloatIndex(img, axis, b) + 0.5;
  const i0 = Math.floor(Math.min(fa, fb) + PIXEL_INDEX_TOLERANCE);
  const i1 = Math.ceil(Math.max(fa, fb) - PIXEL_INDEX_TOLERANCE);
  return [Math.max(0, i0), Math.min(n, i1)];
}
