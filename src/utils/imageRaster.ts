/** Shared uniform-image raster planning and canvas encoding. */

import { paintImageWindow } from "./colormap";
import {
  DEFAULT_MAX_RASTER_DIM,
  type ImageGeometry,
  type PixelWindow,
  type RasterPlan,
  type ResampleMethod,
  type ViewRange,
  isMagnified,
  rasterPlan,
  shouldUseLod,
  visibleWindow,
  windowPlacement,
} from "./imageLod";

/** Delay before encoding a new bitmap after a range or LUT change. */
export const RASTER_DEBOUNCE_MS = 80;

/** Placement of a rasterised bitmap in physical coordinates: ``(x, y)`` is its
 *  upper-left corner (the outer edge of its first pixel), ``dx``/``dy`` the
 *  physical size of one painted cell and ``cw``/``ch`` its size in cells (a
 *  magnified bitmap draws each cell as ``zoomX × zoomY`` bitmap pixels, see
 *  :func:`rasterPlan`). */
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

/** Plan the visible window, output stride, magnification and physical bitmap
 *  placement.
 *
 *  Large images (LOD) rasterise their visible window at display resolution.
 *  Smaller images are painted whole and 1:1.  When zoomed in, the pixels are
 *  magnified so that each stays a sharp block instead of being upscaled — and
 *  smoothed — by the browser: the whole image when it fits within the bitmap
 *  size cap once magnified (so panning never uncovers unpainted areas), else
 *  only its visible window. */
export function planImageRaster(
  geometry: ImageGeometry,
  view: ViewRange | null,
  plotPx: { w: number; h: number },
  dpr: number,
): ImageRasterPlan | null {
  const { width, height } = geometry;
  if (width <= 0 || height <= 0 || !intersectsView(geometry, view)) return null;
  const window = visibleWindow(geometry, view);
  const budget = visibleRasterBudget(geometry, window, view, plotPx);
  const windowed = rasterPlan(window, budget.w, budget.h, dpr);
  const zoomedIn =
    isMagnified(windowed) && windowed.strideX === 1 && windowed.strideY === 1;
  const whole: RasterPlan = {
    i0: 0,
    j0: 0,
    cw: width,
    ch: height,
    strideX: 1,
    strideY: 1,
    zoomX: zoomedIn ? windowed.zoomX : 1,
    zoomY: zoomedIn ? windowed.zoomY : 1,
  };
  const wholeFits = zoomedIn
    ? width * whole.zoomX <= DEFAULT_MAX_RASTER_DIM &&
      height * whole.zoomY <= DEFAULT_MAX_RASTER_DIM
    : !shouldUseLod(width, height);
  const plan = wholeFits ? whole : windowed;
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
  const { plan } = planned;
  const canvas = document.createElement("canvas");
  canvas.width = plan.cw;
  canvas.height = plan.ch;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = paintImageWindow(
    context,
    options.rows,
    options.geometry.width,
    options.geometry.height,
    plan,
    options.lut[0],
    options.lut[1],
    options.colormap,
    options.inverted,
    options.resampleMethod,
  );
  context.putImageData(image, 0, 0);
  return {
    ...planned,
    source: (magnifyCanvas(canvas, plan) ?? canvas).toDataURL("image/png"),
  };
}

/** Copy *canvas* onto a canvas magnified by the plan's integer factors,
 *  without smoothing, so each painted cell becomes a sharp block of bitmap
 *  pixels.  Returns ``null`` when the plan does not magnify (or no 2D context
 *  is available, in which case the browser upscales the painted bitmap). */
function magnifyCanvas(
  canvas: HTMLCanvasElement,
  plan: RasterPlan,
): HTMLCanvasElement | null {
  if (!isMagnified(plan)) return null;
  const magnified = document.createElement("canvas");
  magnified.width = canvas.width * plan.zoomX;
  magnified.height = canvas.height * plan.zoomY;
  const context = magnified.getContext("2d");
  if (!context) return null;
  context.imageSmoothingEnabled = false;
  context.drawImage(canvas, 0, 0, magnified.width, magnified.height);
  return magnified;
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

/**
 * Whether a rasterised bitmap shows the image pixels themselves (no
 * decimation) enlarged on screen — at least one device pixel per bitmap pixel
 * along both axes — when the plot area of *plotPx* CSS pixels shows the
 * physical *view*.
 *
 * The browser smooths enlarged bitmaps: views then set
 * ``image-rendering: pixelated`` (CSS class :data:`CRISP_PIXELS_CLASS`) so the
 * pixels — magnified into blocks when zoomed in — stay sharp.  It must not be
 * set on reduced bitmaps, which it would alias (nearest-pixel downscaling), nor
 * on decimated ones, whose cells aggregate several pixels.
 */
export function showsCrispPixels(
  raster: ImageRasterPlan,
  view: ViewRange,
  plotPx: { w: number; h: number },
  dpr: number,
): boolean {
  const { plan, placement } = raster;
  if (plan.strideX !== 1 || plan.strideY !== 1) return false;
  const spanX = Math.abs(view.x[1] - view.x[0]);
  const spanY = Math.abs(view.y[1] - view.y[0]);
  if (!(spanX > 0 && spanY > 0)) return false;
  const scaleX =
    (plotPx.w * dpr * Math.abs(placement.dx)) / (spanX * plan.zoomX);
  const scaleY =
    (plotPx.h * dpr * Math.abs(placement.dy)) / (spanY * plan.zoomY);
  return Math.min(scaleX, scaleY) >= 1 - 1e-9;
}

/** CSS class (see ``styles.css``) drawing the layout images of a Plotly plot
 *  with nearest-pixel scaling (``image-rendering: pixelated``). */
export const CRISP_PIXELS_CLASS = "image-crisp-pixels";

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
