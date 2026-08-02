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

export interface ImageRasterPlacement {
  x0: number;
  dx: number;
  y0: number;
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

function intersectsView(
  geometry: ImageGeometry,
  view: ViewRange | null,
): boolean {
  if (view === null) return true;
  const x1 = geometry.x0 + geometry.width * geometry.dx;
  const y1 = geometry.y0 + geometry.height * geometry.dy;
  const imageX0 = Math.min(geometry.x0, x1);
  const imageX1 = Math.max(geometry.x0, x1);
  const imageY0 = Math.min(geometry.y0, y1);
  const imageY1 = Math.max(geometry.y0, y1);
  const viewX0 = Math.min(...view.x);
  const viewX1 = Math.max(...view.x);
  const viewY0 = Math.min(...view.y);
  const viewY1 = Math.max(...view.y);
  return (
    imageX1 > viewX0 && imageX0 < viewX1 && imageY1 > viewY0 && imageY0 < viewY1
  );
}
