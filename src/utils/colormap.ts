/**
 * Pure-JS scientific colormaps for fast canvas-based image previews.
 *
 * These polynomial approximations (originally derived by Inigo Quilez,
 * https://www.shadertoy.com/view/WlfXRN, public domain) reproduce the
 * matplotlib reference colormaps to within a few intensity levels —
 * indistinguishable at the few-hundred-pixel sizes used by the
 * multi-image grid.  Hardcoded polynomials avoid a full 256×3 LUT
 * round-trip across every colormap and let us skip pulling matplotlib
 * (≈10 MB) into Pyodide.
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

type RGB = [number, number, number];
type Polynom = [RGB, RGB, RGB, RGB, RGB, RGB, RGB];

/** Evaluate a 6th-order polynomial in *t* per RGB channel. */
function evalPoly(p: Polynom, t: number): RGB {
  const [c0, c1, c2, c3, c4, c5, c6] = p;
  const r =
    c0[0] +
    t *
      (c1[0] +
        t * (c2[0] + t * (c3[0] + t * (c4[0] + t * (c5[0] + t * c6[0])))));
  const g =
    c0[1] +
    t *
      (c1[1] +
        t * (c2[1] + t * (c3[1] + t * (c4[1] + t * (c5[1] + t * c6[1])))));
  const b =
    c0[2] +
    t *
      (c1[2] +
        t * (c2[2] + t * (c3[2] + t * (c4[2] + t * (c5[2] + t * c6[2])))));
  return [r, g, b];
}

const VIRIDIS_POLY: Polynom = [
  [0.2777273272, 0.0054872488, 0.3340111101],
  [0.105, 1.4046, 1.3845],
  [-0.33, 0.215, 0.0942],
  [-4.6342, -5.7991, -19.3324],
  [6.228, 14.179, 56.6905],
  [4.7765, -13.7457, -65.353],
  [-5.4354, 4.645, 26.3124],
];

const PLASMA_POLY: Polynom = [
  [0.05873234392399702, 0.02333670892565664, 0.5433401826748754],
  [2.176514634195958, 0.2383834171260182, 0.7539604599784036],
  [-2.689460476458034, -7.455851135738909, 3.110799939717086],
  [6.130348345893603, 42.3461881477227, -28.51885465332158],
  [-11.10743619062271, -82.66631109428045, 60.13984767418263],
  [10.02306557647065, 71.41361770095349, -54.07218655560067],
  [-3.658713842777788, -22.93153465461149, 18.19190778539828],
];

const INFERNO_POLY: Polynom = [
  [0.0002189403691192265, 0.001651004631001012, -0.01948089843709184],
  [0.1065134194856116, 0.5639564367884091, 3.932712388889277],
  [11.60249308247187, -3.972853965665698, -15.9423941062914],
  [-41.70399613139459, 17.43639888205313, 44.35414519872813],
  [77.162935699427, -33.40235894210092, -81.80730925738993],
  [-71.31942824499214, 32.62606426397723, 73.20951985803202],
  [25.13112622477341, -12.24266895238567, -23.07032500287172],
];

const MAGMA_POLY: Polynom = [
  [-0.002136485053939582, -0.000749655052795221, -0.005386127855323933],
  [0.2516605407371642, 0.6775232436837668, 2.494026599312351],
  [8.353717279216625, -3.577719514958484, 0.3144679030132573],
  [-27.66873308576866, 14.26473078096533, -13.64921318813922],
  [52.17613981234068, -27.94360607168351, 12.94416944238394],
  [-50.76852536473588, 29.04658282127291, 4.23415299384598],
  [18.65570506591883, -11.48977351997711, -5.601961508734096],
];

const CIVIDIS_POLY: Polynom = [
  [-0.0086, 0.1262, 0.2879],
  [0.6502, 0.6804, 1.7706],
  [-1.0871, -0.4329, -10.0571],
  [4.0857, 1.5938, 27.6739],
  [-7.6664, -1.9778, -35.1518],
  [7.0892, 1.0898, 21.4156],
  [-2.5527, -0.2865, -5.0598],
];

/** Channel-mean fit for matplotlib's classic ``jet`` colormap. */
function jetEval(t: number): RGB {
  // Standard piecewise-linear formula (Wikipedia / matplotlib source).
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1)));
  return [r, g, b];
}

/** Closed-form ``hot`` colormap (matplotlib): black → red → yellow → white. */
function hotEval(t: number): RGB {
  const r = Math.max(0, Math.min(1, t / (3 / 8)));
  const g = Math.max(0, Math.min(1, (t - 3 / 8) / (3 / 8)));
  const b = Math.max(0, Math.min(1, (t - 6 / 8) / (2 / 8)));
  return [r, g, b];
}

const POLYS: Record<string, Polynom> = {
  viridis: VIRIDIS_POLY,
  plasma: PLASMA_POLY,
  inferno: INFERNO_POLY,
  magma: MAGMA_POLY,
  cividis: CIVIDIS_POLY,
};

/** Resolve a colormap name (case-insensitive) to a sample function. */
function resolveColormap(name: string): (t: number) => RGB {
  const key = (name || "viridis").toLowerCase();
  if (key === "gray" || key === "greys" || key === "grey") {
    return (t) => [t, t, t];
  }
  if (key === "jet") return jetEval;
  if (key === "hot") return hotEval;
  const poly = POLYS[key];
  if (poly) return (t) => evalPoly(poly, t);
  // Unknown name → silently fall back to Viridis (matches DataLab Qt
  // default).  The single-image viewer still uses Plotly so the user
  // sees the correct colormap there.
  return (t) => evalPoly(VIRIDIS_POLY, t);
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
  const sample = resolveColormap(colormap);
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
        const [r, g, b] = sample(t);
        buf[p] = Math.round(r * 255);
        buf[p + 1] = Math.round(g * 255);
        buf[p + 2] = Math.round(b * 255);
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
  const sample = resolveColormap(colormap);
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
        const [rr, gg, bb] = sample(t);
        buf[p] = Math.round(rr * 255);
        buf[p + 1] = Math.round(gg * 255);
        buf[p + 2] = Math.round(bb * 255);
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

/** List of colormap names natively supported by :func:`paintImageData`
 *  / :func:`buildColorscale`.  Names outside this list silently fall
 *  back to Viridis when rasterising. */
export const SUPPORTED_COLORMAPS: readonly string[] = [
  "Viridis",
  "Plasma",
  "Inferno",
  "Magma",
  "Cividis",
  "Hot",
  "Jet",
  "Greys",
] as const;
