/**
 * Pure-JS scientific colormaps for fast canvas-based image previews.
 *
 * The colormaps reproduce PlotPy's full set of default lookup tables
 * (the same matplotlib-derived data used by the desktop application).
 * Each map is stored as a sparse list of stops in ``colormapData.ts``
 * (auto-generated from PlotPy) and expanded on first use into a cached
 * 256-entry RGB lookup table.  Indexing a precomputed LUT per pixel is
 * both faithful (no polynomial approximation) and fast, and lets us
 * skip pulling matplotlib (≈10 MB) into Pyodide.
 *
 * Usage:
 *
 * ```ts
 * const ctx = canvas.getContext("2d")!;
 * const img = paintImageData(ctx, floats, w, h, zmin, zmax, "Viridis", false);
 * ctx.putImageData(img, 0, 0);
 * ```
 */

import type { ResampleMethod } from "./imageLod";
import {
  COLORMAP_NAMES,
  COLORMAP_STOPS,
  type ColormapStops,
} from "./colormapData";

type RGB = [number, number, number];

/** Number of entries in each precomputed lookup table. */
const LUT_SIZE = 256;

/** Fallback colormap when a name is unknown (matches DataLab Qt default). */
const FALLBACK = "viridis";

/** Cache of built 256-entry RGB lookup tables, keyed by lowercase name. */
const lutCache = new Map<string, Uint8ClampedArray>();

/**
 * Build a dense ``LUT_SIZE``-entry RGB lookup table by linearly interpolating
 * between the (sparse) colormap *stops*.  Stops are ``[position, r, g, b]``
 * with ``position`` in ``[0, 1]`` and channels in ``0..255``.  Duplicated
 * positions encode hard transitions (qualitative maps) and are honoured.
 */
function buildLut(stops: ColormapStops): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(LUT_SIZE * 3);
  const last = LUT_SIZE - 1;
  let seg = 0;
  for (let i = 0; i < LUT_SIZE; i += 1) {
    const t = i / last;
    // Advance to the segment [stops[seg], stops[seg+1]] containing ``t``.
    while (seg < stops.length - 2 && stops[seg + 1][0] < t) seg += 1;
    const a = stops[seg];
    const b = stops[seg + 1];
    const span = b[0] - a[0];
    const f = span > 0 ? (t - a[0]) / span : 0;
    const o = i * 3;
    lut[o] = a[1] + (b[1] - a[1]) * f;
    lut[o + 1] = a[2] + (b[2] - a[2]) * f;
    lut[o + 2] = a[3] + (b[3] - a[3]) * f;
  }
  return lut;
}

/** Get (building + caching on first use) the LUT for a colormap name. */
function getLut(name: string): Uint8ClampedArray {
  const key = (name || FALLBACK).toLowerCase();
  let lut = lutCache.get(key);
  if (lut) return lut;
  const stops = COLORMAP_STOPS[key] ?? COLORMAP_STOPS[FALLBACK];
  lut = buildLut(stops);
  lutCache.set(key, lut);
  return lut;
}

/**
 * Resolve a colormap name (case-insensitive) to a fast sample function.
 *
 * The returned function maps a normalised ``t`` in ``[0, 1]`` to an RGB
 * triple with channels in ``[0, 1]``.  ``t`` is expected to be pre-clamped by
 * callers; out-of-range values are clamped to the LUT bounds.  Unknown names
 * silently fall back to Viridis.
 */
function resolveColormap(name: string): (t: number) => RGB {
  const lut = getLut(name);
  return (t) => {
    let idx = ((t < 0 ? 0 : t > 1 ? 1 : t) * 255 + 0.5) | 0;
    if (idx > 255) idx = 255;
    const o = idx * 3;
    return [lut[o] / 255, lut[o + 1] / 255, lut[o + 2] / 255];
  };
}

/**
 * Paint *floats* into an ``ImageData`` using the given colormap.
 *
 * ``floats`` may be either a flat ``Float32Array`` of length ``w*h``
 * (preferred — the bridge format) or an array of row arrays.  Values
 * outside ``[zmin, zmax]`` are clamped.  ``NaN`` pixels become fully
 * transparent so missing data is visually distinct from low values.
 */
export function paintImageData(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  floats: Float32Array | ArrayLike<ArrayLike<number>>,
  w: number,
  h: number,
  zmin: number,
  zmax: number,
  colormap: string,
  inverted: boolean,
): ImageData {
  const lut = getLut(colormap);
  const range = zmax > zmin ? zmax - zmin : 1;
  const img = ctx.createImageData(w, h);
  const buf = img.data;
  // Pre-flatten row-major access. ``Float32Array`` is the fast path
  // (single bounds check); the nested-list fallback keeps the helper
  // usable from tests / legacy callers.
  const isFlat = ArrayBuffer.isView(floats);
  let p = 0;
  for (let j = 0; j < h; j += 1) {
    const row = isFlat ? null : (floats as ArrayLike<ArrayLike<number>>)[j];
    for (let i = 0; i < w; i += 1) {
      const v = isFlat
        ? (floats as Float32Array)[j * w + i]
        : (row as ArrayLike<number>)[i];
      if (Number.isNaN(v)) {
        buf[p] = 0;
        buf[p + 1] = 0;
        buf[p + 2] = 0;
        buf[p + 3] = 0;
      } else {
        let t = (v - zmin) / range;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        if (inverted) t = 1 - t;
        // Index the cached LUT directly: avoids allocating an RGB array
        // per pixel and the redundant /255 then *255 round-trip.
        let idx = (t * 255 + 0.5) | 0;
        if (idx > 255) idx = 255;
        const o = idx * 3;
        buf[p] = lut[o];
        buf[p + 1] = lut[o + 1];
        buf[p + 2] = lut[o + 2];
        buf[p + 3] = 255;
      }
      p += 4;
    }
  }
  return img;
}

/**
 * Paint a decimated **sub-window** of an image into an ``ImageData``.
 *
 * Unlike :func:`paintImageData`, this indexes the source as row arrays
 * (``rows[j][i]``) so it never assumes a single contiguous buffer, and it
 * aggregates ``strideX × strideY`` source pixels into each output cell using
 * *method* before applying the colormap.  Aggregating the **data** (not the
 * colours) keeps hot pixels visible under ``max`` and avoids colour-space
 * averaging artefacts under ``mean``.  ``NaN`` source pixels are ignored by
 * the aggregation; a cell with only ``NaN`` becomes fully transparent.
 *
 * @param ctx Target 2D context (only used to allocate the ``ImageData``).
 * @param rows Full-resolution source rows (``Float32Array`` or ``number[]``).
 * @param fullW Source width (columns).
 * @param fullH Source height (rows).
 * @param plan Window + stride from :func:`rasterPlan`.
 * @param zmin LUT lower bound.
 * @param zmax LUT upper bound.
 * @param colormap Colormap name.
 * @param inverted Reverse the colormap.
 * @param method Aggregation method when ``stride > 1``.
 */
export function paintImageWindow(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  rows: ArrayLike<ArrayLike<number>>,
  fullW: number,
  fullH: number,
  plan: {
    i0: number;
    j0: number;
    cw: number;
    ch: number;
    strideX: number;
    strideY: number;
  },
  zmin: number,
  zmax: number,
  colormap: string,
  inverted: boolean,
  method: ResampleMethod,
): ImageData {
  const lut = getLut(colormap);
  const range = zmax > zmin ? zmax - zmin : 1;
  const { i0, j0, cw, ch, strideX, strideY } = plan;
  const img = ctx.createImageData(cw, ch);
  const buf = img.data;
  const fast = strideX === 1 && strideY === 1;
  let p = 0;
  for (let r = 0; r < ch; r += 1) {
    const sj0 = j0 + r * strideY;
    // Fast path (zoomed in, 1:1): hoist the row fetch out of the column
    // loop so each source row is dereferenced once, not once per pixel.
    const fastRow = fast ? rows[sj0] : null;
    for (let c = 0; c < cw; c += 1) {
      const si0 = i0 + c * strideX;
      let v: number;
      if (fast) {
        v = fastRow ? (fastRow[si0] as number) : NaN;
      } else {
        v = aggregate(rows, fullW, fullH, si0, sj0, strideX, strideY, method);
      }
      if (Number.isNaN(v)) {
        buf[p] = 0;
        buf[p + 1] = 0;
        buf[p + 2] = 0;
        buf[p + 3] = 0;
      } else {
        let t = (v - zmin) / range;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        if (inverted) t = 1 - t;
        // Index the cached LUT directly (see paintImageData).
        let idx = (t * 255 + 0.5) | 0;
        if (idx > 255) idx = 255;
        const o = idx * 3;
        buf[p] = lut[o];
        buf[p + 1] = lut[o + 1];
        buf[p + 2] = lut[o + 2];
        buf[p + 3] = 255;
      }
      p += 4;
    }
  }
  return img;
}

/** Aggregate a ``strideX × strideY`` block starting at (si0, sj0), clamped to
 *  the image bounds, ignoring ``NaN``.  Returns ``NaN`` for an all-``NaN``
 *  block. */
function aggregate(
  rows: ArrayLike<ArrayLike<number>>,
  fullW: number,
  fullH: number,
  si0: number,
  sj0: number,
  strideX: number,
  strideY: number,
  method: ResampleMethod,
): number {
  if (method === "nearest") {
    const row = rows[sj0];
    return row ? (row[si0] as number) : NaN;
  }
  const sj1 = Math.min(sj0 + strideY, fullH);
  const si1 = Math.min(si0 + strideX, fullW);
  let acc = method === "max" ? -Infinity : 0;
  let count = 0;
  for (let j = sj0; j < sj1; j += 1) {
    const row = rows[j];
    if (!row) continue;
    for (let i = si0; i < si1; i += 1) {
      const v = row[i] as number;
      if (Number.isNaN(v)) continue;
      if (method === "max") {
        if (v > acc) acc = v;
      } else {
        acc += v;
      }
      count += 1;
    }
  }
  if (count === 0) return NaN;
  return method === "max" ? acc : acc / count;
}

/**
 * Build a Plotly colorscale ``[[t, "rgb(r,g,b)"], …]`` sampled from the
 * same lookup table as :func:`paintImageData`.
 *
 * Used by :class:`ImagePlot` so its standalone colorbar (a hidden
 * scatter trace) is guaranteed to match the canvas-rasterised image,
 * even for colormaps Plotly does not know natively or that we
 * approximate with a polynomial fit.
 */
export function buildColorscale(
  colormap: string,
  inverted: boolean,
  steps: number = 32,
): Array<[number, string]> {
  const sample = resolveColormap(colormap);
  const out: Array<[number, string]> = new Array(steps);
  const last = steps - 1;
  for (let i = 0; i < steps; i += 1) {
    const t = i / last;
    const [r, g, b] = sample(inverted ? 1 - t : t);
    out[i] = [
      t,
      `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`,
    ];
  }
  return out;
}

/** All colormap names supported by :func:`paintImageData` /
 *  :func:`buildColorscale` — the full set of PlotPy default colormaps
 *  (lowercase, e.g. ``"viridis"``, ``"jet"``, ``"gist_earth"``).  Names
 *  outside this list silently fall back to Viridis when rasterising. */
export const SUPPORTED_COLORMAPS: readonly string[] = COLORMAP_NAMES;

/** Re-export the category grouping for the colormap selector UI. */
export { COLORMAP_CATEGORIES } from "./colormapData";

/**
 * Human-readable label for a colormap *name* (e.g. ``"gist_earth"`` →
 * ``"Gist earth"``).  Underscores become spaces and the first letter is
 * capitalised; the rest is left untouched to preserve embedded acronyms.
 */
export function colormapLabel(name: string): string {
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
