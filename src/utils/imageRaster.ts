/** Shared uniform-image raster planning and canvas encoding. */

import { paintImageWindow } from "./colormap";
import {
  type ImageGeometry,
  type PixelWindow,
  type RasterPlan,
  type ResampleMethod,
  type ViewRange,
  rasterPlan,
  shouldUseLod,
  visibleWindow,
  windowPlacement,
} from "./imageLod";

/** Delay before encoding a new bitmap after a range or LUT change. */
export const RASTER_DEBOUNCE_MS = 80;

/** Placement of a rasterised bitmap in physical coordinates: ``(x, y)`` is its
 *  upper-left corner (the outer edge of its first pixel), ``dx``/``dy`` the
 *  physical size of one bitmap cell and ``cw``/``ch`` its size in cells. */
export interface ImageRasterPlacement {
  x: number;
  dx: number;
  y: number;
  dy: number;
  cw: number;
  ch: number;
}

export interface ImageRasterPlan {
  plan: RasterPlan;
  placement: ImageRasterPlacement;
}

export interface ImageRasterResult extends ImageRasterPlan {
  source: string;
}

interface ImageRasterOptions {
  rows: ArrayLike<ArrayLike<number>>;
  geometry: ImageGeometry;
  view: ViewRange | null;
  plotPx: { w: number; h: number };
  dpr: number;
  lut: readonly [number, number];
  colormap: string;
  inverted: boolean;
  resampleMethod: ResampleMethod;
}

/** Coerce persisted metadata to a supported display resampling method. */
export function normalizeResampleMethod(
  value: string | null | undefined,
): ResampleMethod {
  return value === "max" || value === "mean" ? value : "nearest";
}

/**
 * Return the CSS-pixel budget occupied by an image window in the current
 * shared view. Images arranged in a 2×2 spatial grid therefore each receive
 * roughly one quarter of the full plot-area raster budget.
 */
export function visibleRasterBudget(
  geometry: ImageGeometry,
  window: PixelWindow,
  view: ViewRange | null,
  plotPx: { w: number; h: number },
): { w: number; h: number } {
  if (view === null) return plotPx;
  const viewWidth = Math.abs(view.x[1] - view.x[0]);
  const viewHeight = Math.abs(view.y[1] - view.y[0]);
  const imageWidth = (window.i1 - window.i0) * Math.abs(geometry.dx);
  const imageHeight = (window.j1 - window.j0) * Math.abs(geometry.dy);
  return {
    w: Math.max(
      1,
      Math.min(plotPx.w, (plotPx.w * imageWidth) / Math.max(viewWidth, 1e-12)),
    ),
    h: Math.max(
      1,
      Math.min(
        plotPx.h,
        (plotPx.h * imageHeight) / Math.max(viewHeight, 1e-12),
      ),
    ),
  };
}

/** Plan the visible window, output stride and physical bitmap placement. */
export function planImageRaster(
  geometry: ImageGeometry,
  view: ViewRange | null,
  plotPx: { w: number; h: number },
  dpr: number,
): ImageRasterPlan | null {
  const { width, height } = geometry;
  if (width <= 0 || height <= 0 || !intersectsView(geometry, view)) return null;
  const useLod = shouldUseLod(width, height);
  const window = useLod
    ? visibleWindow(geometry, view)
    : { i0: 0, i1: width, j0: 0, j1: height };
  const budget = useLod
    ? visibleRasterBudget(geometry, window, view, plotPx)
    : plotPx;
  const plan = useLod
    ? rasterPlan(window, budget.w, budget.h, dpr)
    : { i0: 0, j0: 0, cw: width, ch: height, strideX: 1, strideY: 1 };
  return {
    plan,
    placement: { ...windowPlacement(plan, geometry), cw: plan.cw, ch: plan.ch },
  };
}

/** Rasterise a planned uniform image into a Plotly-compatible data URL. */
export function rasterizeImage(
  options: ImageRasterOptions,
): ImageRasterResult | null {
  const planned = planImageRaster(
    options.geometry,
    options.view,
    options.plotPx,
    options.dpr,
  );
  if (planned === null) return null;
  const canvas = document.createElement("canvas");
  canvas.width = planned.plan.cw;
  canvas.height = planned.plan.ch;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = paintImageWindow(
    context,
    options.rows,
    options.geometry.width,
    options.geometry.height,
    planned.plan,
    options.lut[0],
    options.lut[1],
    options.colormap,
    options.inverted,
    options.resampleMethod,
  );
  context.putImageData(image, 0, 0);
  return {
    ...planned,
    source: canvas.toDataURL("image/png"),
  };
}

/** Plotly ``layout.images`` entry drawing a rasterised bitmap below the data
 *  at its physical placement.  A layout image (unlike an ``image`` trace)
 *  imposes no axis constraint, so both axes stay free to pan. */
export function rasterLayoutImage(raster: ImageRasterResult) {
  const { placement } = raster;
  return {
    source: raster.source,
    xref: "x" as const,
    yref: "y" as const,
    x: placement.x,
    y: placement.y,
    sizex: placement.cw * placement.dx,
    sizey: placement.ch * placement.dy,
    xanchor: "left" as const,
    yanchor: "top" as const,
    sizing: "stretch" as const,
    layer: "below" as const,
  };
}

function intersectsView(
  geometry: ImageGeometry,
  view: ViewRange | null,
): boolean {
  if (view === null) return true;
  // Outer edges of the first and last pixels (``x0``/``y0`` are pixel centers).
  const xa = geometry.x0 - 0.5 * geometry.dx;
  const xb = xa + geometry.width * geometry.dx;
  const ya = geometry.y0 - 0.5 * geometry.dy;
  const yb = ya + geometry.height * geometry.dy;
  const imageX0 = Math.min(xa, xb);
  const imageX1 = Math.max(xa, xb);
  const imageY0 = Math.min(ya, yb);
  const imageY1 = Math.max(ya, yb);
  const viewX0 = Math.min(...view.x);
  const viewX1 = Math.max(...view.x);
  const viewY0 = Math.min(...view.y);
  const viewY1 = Math.max(...view.y);
  return (
    imageX1 > viewX0 && imageX0 < viewX1 && imageY1 > viewY0 && imageY0 < viewY1
  );
}
