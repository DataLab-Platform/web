/**
 * resultBox — build a Plotly annotation summarising scalar / table
 * analysis results, displayed as a single multi-line text box pinned
 * to the top-right corner of the plot (paper coordinates).
 *
 * This mirrors PlotPy's "computing results" annotation in DataLab
 * desktop: after running e.g. *Analysis ▸ FWHM* or *Centroid* the
 * user sees the actual numeric values directly on the plot, in
 * addition to the geometry overlays already drawn by
 * ``buildGeometryOverlays`` / ``buildImageGeometryOverlays``.
 *
 * Only :type:`TableAnalysisResult` rows are formatted here — geometry
 * results carry their own visual representation (segments, circles,
 * markers …) and would just clutter the box if listed numerically.
 */

import type { AnalysisResult } from "../runtime/runtime";

/** Maximum number of rows formatted per result block (extra rows are
 *  truncated with a final "…(N more)" line). */
export const RESULT_BOX_MAX_ROWS = 4;

/** Maximum number of columns formatted per row. */
export const RESULT_BOX_MAX_COLS = 4;

interface BuildOptions {
  /** ``true`` for dark theme (white text on dark panel), ``false``
   *  for light.  Defaults to ``false``. */
  dark?: boolean;
}

/**
 * Build a single Plotly annotation summarising every TableAnalysisResult
 * in *results*.  Returns an empty list when no row qualifies so callers
 * can spread it unconditionally.
 */
export function buildResultAnnotationBox(
  results: AnalysisResult[],
  options: BuildOptions = {},
): { annotations: unknown[] } {
  const tableResults = results.filter((r) => r.category === "table");
  if (tableResults.length === 0) return { annotations: [] };

  const lines: string[] = [];
  for (const r of tableResults) {
    const heads = r.headers.slice(0, RESULT_BOX_MAX_COLS);
    lines.push(`<b>${escapeHtml(r.title)}</b>`);
    const rows = r.data.slice(0, RESULT_BOX_MAX_ROWS);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const roiLabel =
        r.roi_indices && r.roi_indices[i] !== undefined
          ? `ROI${r.roi_indices[i] + 1}`
          : `#${i + 1}`;
      const cells = heads.map((h, k) => {
        const v = row[k];
        return `${escapeHtml(h)}=${formatValue(v)}`;
      });
      lines.push(`  ${roiLabel}: ${cells.join("  ")}`);
    }
    if (r.data.length > RESULT_BOX_MAX_ROWS) {
      const more = r.data.length - RESULT_BOX_MAX_ROWS;
      lines.push(`  …(${more} more)`);
    }
  }

  const dark = options.dark ?? false;
  const fontColor = dark ? "#f0f0f0" : "#202020";
  const bgColor = dark ? "rgba(30,30,30,0.85)" : "rgba(255,255,255,0.85)";
  const borderColor = dark ? "#555555" : "#cccccc";

  return {
    annotations: [
      {
        xref: "paper",
        yref: "paper",
        x: 0.99,
        y: 0.99,
        xanchor: "right",
        yanchor: "top",
        showarrow: false,
        align: "left",
        text: lines.join("<br>"),
        font: { family: "monospace", size: 11, color: fontColor },
        bgcolor: bgColor,
        bordercolor: borderColor,
        borderwidth: 1,
        borderpad: 4,
      },
    ],
  };
}

function formatValue(v: number | string | null): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    const abs = Math.abs(v);
    if (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) return v.toExponential(3);
    return Number(v.toFixed(4)).toString();
  }
  return escapeHtml(String(v));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
