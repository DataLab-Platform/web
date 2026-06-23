/**
 * Helpers for rendering signal ROIs as filled "area under curve" traces.
 *
 * Mirrors the desktop reference (``feature/309-spectral-analysis``:
 * :class:`_CurveClippedXRangeSelection`) and the Plotly notebook
 * backend (:func:`plotly_backend._build_signal_roi_traces`) so the
 * three frontends converge on the same visual identity.
 */

import { roiFillColor, roiLineColor } from "../runtime/plotStyles";
import type { SignalRoiSegment } from "../runtime/runtime";

/** Linear interpolation of *y* at coordinate *xq*, assuming *x* is
 *  monotonically increasing.  Falls back to nearest-edge values when
 *  *xq* sits outside the array. */
export function interpY(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  xq: number,
): number {
  const n = x.length;
  if (n === 0) return 0;
  if (xq <= x[0]) return y[0];
  if (xq >= x[n - 1]) return y[n - 1];
  // Binary search for the bracketing pair.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (x[mid] <= xq) lo = mid;
    else hi = mid;
  }
  const dx = x[hi] - x[lo];
  if (dx === 0) return y[lo];
  return y[lo] + ((xq - x[lo]) / dx) * (y[hi] - y[lo]);
}

/**
 * Build a Plotly ``scatter`` trace that fills the area between the
 * primary curve and the X axis (``y = 0``) over a single ROI's X
 * interval.  Boundary X values are linearly interpolated on the curve
 * so the polygon edges align exactly with ``[xmin, xmax]`` and don't
 * snap to the nearest sample.  Returns ``null`` when the ROI doesn't
 * overlap the curve or when the data array is empty.
 */
export function buildRoiAreaTrace(
  seg: SignalRoiSegment,
  index: number,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): Record<string, unknown> | null {
  const n = x.length;
  if (n === 0) return null;
  const xmin = Math.min(seg.xmin, seg.xmax);
  const xmax = Math.max(seg.xmin, seg.xmax);
  if (xmax <= x[0] || xmin >= x[n - 1] || xmin === xmax) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  // Start boundary: interpolate at exactly xmin (clipped to data range).
  const x0 = Math.max(xmin, x[0]);
  xs.push(x0);
  ys.push(interpY(x, y, x0));
  for (let i = 0; i < n; i++) {
    if (x[i] > x0 && x[i] < xmax) {
      xs.push(x[i]);
      ys.push(y[i]);
    }
  }
  // End boundary: interpolate at exactly xmax (clipped to data range).
  const x1 = Math.min(xmax, x[n - 1]);
  if (x1 > x0) {
    xs.push(x1);
    ys.push(interpY(x, y, x1));
  }
  const lineColor = roiLineColor(index);
  const fillColor = roiFillColor(index);
  return {
    x: xs,
    y: ys,
    type: "scatter",
    mode: "lines",
    line: { color: lineColor, width: 1 },
    fill: "tozeroy",
    fillcolor: fillColor,
    name: seg.title || `ROI${index + 1}`,
    hoverinfo: "skip",
    showlegend: false,
  };
}

/**
 * Build the two dashed vertical boundary lines delimiting a single ROI's
 * X interval.  Each line spans the full plotting area (``yref: "paper"``,
 * ``0 → 1``) so it reaches the very top of the graph regardless of the
 * y-axis autorange, mirroring the desktop reference where the ROI edges
 * span the whole canvas height.  Lines are anchored to the raw
 * ``xmin``/``xmax`` (not clipped to the data extent) so the true ROI
 * bounds stay visible even when the interval reaches past the signal.
 */
export function buildRoiBoundaryShapes(
  seg: SignalRoiSegment,
  index: number,
): Record<string, unknown>[] {
  const lineColor = roiLineColor(index);
  return [seg.xmin, seg.xmax].map((x) => ({
    type: "line",
    xref: "x",
    yref: "paper",
    x0: x,
    x1: x,
    y0: 0,
    y1: 1,
    line: { color: lineColor, width: 1, dash: "dash" },
    layer: "above",
  }));
}
