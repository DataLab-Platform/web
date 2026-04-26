/**
 * Shared Plotly style helpers — colors, dashes, ROI palette.
 *
 * Mirrors the constants used by ``DataLab-Kernel``'s
 * ``plotly_backend.py`` (``PLOTLY_COLORS``, ``PLOTLY_DASHES``,
 * ``ROI_FILL_COLORS``) so that DataLab-Web, DataLab-Kernel and the Qt
 * desktop converge on the same visual identity.
 */

/** ``tab10`` palette used by PlotPy's ``CurveStyles`` and the Plotly
 *  backend.  Curves cycle through these colors in selection order. */
export const PLOTLY_COLORS: readonly string[] = [
  "#1f77b4", // muted blue
  "#ff7f0e", // safety orange
  "#2ca02c", // cooked asparagus green
  "#d62728", // brick red
  "#9467bd", // muted purple
  "#8c564b", // chestnut brown
  "#e377c2", // raspberry yogurt pink
  "#7f7f7f", // middle gray
  "#bcbd22", // curry yellow-green
  "#17becf", // blue-teal
];

/** Plotly ``line.dash`` values cycled after a full color round.  Kept in
 *  sync with PlotPy's 4-style cycle (Solid / Dash / DashDot / DashDotDot). */
export const PLOTLY_DASHES: readonly string[] = [
  "solid",
  "dash",
  "dashdot",
  "longdashdot",
];

/** ROI fill palette (alpha-channel applied at draw time).  Index =
 *  ROI position so the color stays stable while the user drags. */
export const ROI_FILL_COLORS: readonly string[] = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#7f7f7f",
  "#bcbd22",
  "#17becf",
];

export interface CurveStyle {
  color: string;
  dash: string;
  width: number;
}

/** Compute the (color, dash) for the *index*-th curve in a multi-signal
 *  plot, cycling colors first then dashes. */
export function getCurveStyle(index: number, width = 1.5): CurveStyle {
  const n = PLOTLY_COLORS.length;
  return {
    color: PLOTLY_COLORS[index % n],
    dash: PLOTLY_DASHES[Math.floor(index / n) % PLOTLY_DASHES.length],
    width,
  };
}

/** Convert ``#rrggbb`` to ``rgba(r, g, b, a)``.  Returns the input as-is
 *  when it is already in ``rgb(a)`` form or unparseable. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Get an ROI fill color (rgba) for the *index*-th ROI. */
export function roiFillColor(index: number, alpha = 0.35): string {
  const c = ROI_FILL_COLORS[index % ROI_FILL_COLORS.length];
  return hexToRgba(c, alpha);
}

/** Get an ROI line color (full-opacity hex) for the *index*-th ROI. */
export function roiLineColor(index: number): string {
  return ROI_FILL_COLORS[index % ROI_FILL_COLORS.length];
}

/** Map common PlotPy / Qt linestyle names (``DashLine``, ``DashDotLine`` …)
 *  to Plotly ``line.dash`` values.  Unknown values fall through unchanged
 *  so callers can pass Plotly-native strings directly. */
export function plotlyDash(value: string | null | undefined): string {
  if (!value) return "solid";
  const v = value.trim();
  switch (v) {
    case "SolidLine":
    case "solid":
      return "solid";
    case "DashLine":
    case "dash":
      return "dash";
    case "DotLine":
    case "dot":
      return "dot";
    case "DashDotLine":
    case "dashdot":
      return "dashdot";
    case "DashDotDotLine":
    case "longdashdot":
      return "longdashdot";
    default:
      return v;
  }
}

/** Normalised curve display modes mirroring PlotPy's ``CurveItem``
 *  ``curvestyle``.  ``"lines"`` is the Plotly default; the others select
 *  alternative renderings handled by :func:`buildCurveTrace`. */
export type CurveMode = "lines" | "steps" | "sticks" | "dots";

/** Map PlotPy / Qt curvestyle names (``Lines``, ``Sticks``, ``Steps``,
 *  ``Dots``, ``NoCurve``) to the small set we render natively.  Unknown
 *  / null values default to ``"lines"`` so plain Sigima signals (no
 *  metadata) keep their historical look. */
export function normalizeCurveStyle(
  value: string | null | undefined,
): CurveMode {
  if (!value) return "lines";
  switch (value.trim().toLowerCase()) {
    case "sticks":
    case "stem":
      return "sticks";
    case "steps":
    case "step":
      return "steps";
    case "dots":
    case "nocurve":
    case "no_curve":
    case "markers":
      return "dots";
    case "lines":
    case "line":
    default:
      return "lines";
  }
}

/** Plotly trace fragment for a single curve.  Returned object is meant
 *  to be merged into a base trace ``{ x, y, name, … }`` via spread. */
export interface CurveTracePartial {
  type: "scatter";
  mode: "lines" | "markers";
  line?: { color: string; width: number; dash: string; shape?: "hv" };
  marker?: { color: string; size: number };
  /** Override ``x`` for stem rendering (``[xi, xi, NaN, …]``). */
  x?: number[];
  /** Override ``y`` for stem rendering (``[0, yi, NaN, …]``). */
  y?: number[];
}

/** Build the Plotly trace fragment for one curve, given its raw data
 *  arrays, the resolved color/width/dash and the normalised display mode. */
export function buildCurveTrace(
  x: readonly number[],
  y: readonly number[],
  color: string,
  width: number,
  dash: string,
  mode: CurveMode = "lines",
): CurveTracePartial {
  switch (mode) {
    case "dots":
      return {
        type: "scatter",
        mode: "markers",
        marker: { color, size: Math.max(3, Math.round(width * 2)) },
      };
    case "sticks": {
      // Stem: for each (xi, yi) emit [xi, xi, NaN] / [0, yi, NaN] so a
      // single ``lines`` trace renders all the vertical bars without
      // joining them.
      const xs: number[] = [];
      const ys: number[] = [];
      const n = Math.min(x.length, y.length);
      for (let i = 0; i < n; i++) {
        xs.push(x[i], x[i], NaN);
        ys.push(0, y[i], NaN);
      }
      return {
        type: "scatter",
        mode: "lines",
        line: { color, width, dash },
        x: xs,
        y: ys,
      };
    }
    case "steps":
      return {
        type: "scatter",
        mode: "lines",
        line: { color, width, dash, shape: "hv" },
      };
    case "lines":
    default:
      return {
        type: "scatter",
        mode: "lines",
        line: { color, width, dash },
      };
  }
}
