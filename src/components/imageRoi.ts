/**
 * Pure helpers for building image-ROI Plotly overlays.
 *
 * Extracted from ``ImagePlot.tsx`` so the logic is testable in JSDOM
 * without importing Plotly (whose mapbox path crashes JSDOM via
 * ``window.URL.createObjectURL``).
 *
 * Mirrors the visual conventions of DataLab desktop and the Plotly
 * notebook backend (``DataLab-Kernel/datalab_kernel/plotly_backend.py``):
 * each ROI is drawn with its own color from the cycling
 * ``ROI_FILL_COLORS`` palette, and labels default to ``ROI{i+1}`` when
 * no explicit title is set.
 */
import type { ImageRoiSegment } from "../runtime/runtime";
import { hexToRgba, roiLineColor } from "../runtime/plotStyles";

/** Result of {@link buildRoiOverlays}. */
export interface RoiOverlayResult {
  /** Plotly ``shapes`` entries (one per ROI). */
  roiShapes: unknown[];
  /** Plotly ``annotations`` entries (label per ROI). */
  roiAnnotations: unknown[];
}

/**
 * Build Plotly ``shapes`` + ``annotations`` for a list of image ROIs.
 *
 * @param roi      ROI segments in display order. The index in this array
 *                 selects the ROI's color from {@link roiLineColor}.
 * @param editMode When ``true``, shapes are made editable (draggable /
 *                 resizable in the Plotly modebar) and rendered with a
 *                 thicker border + a faint translucent fill.
 */
export function buildRoiOverlays(
  roi: ImageRoiSegment[],
  editMode = false,
): RoiOverlayResult {
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];
  roi.forEach((seg, idx) => {
    const color = roiLineColor(idx);
    const fill = editMode ? hexToRgba(color, 0.1) : undefined;
    const title = seg.title || `ROI${idx + 1}`;
    const lineWidth = editMode ? 2 : 1.5;
    if (seg.geometry === "rectangle") {
      shapes.push({
        type: "rect",
        xref: "x",
        yref: "y",
        x0: seg.x0,
        y0: seg.y0,
        x1: seg.x0 + seg.dx,
        y1: seg.y0 + seg.dy,
        line: { color, width: lineWidth, dash: "dot" },
        fillcolor: fill,
        layer: "above",
        editable: editMode,
      });
      annotations.push({
        x: seg.x0,
        y: seg.y0,
        xref: "x",
        yref: "y",
        text: title,
        showarrow: false,
        font: { color, size: 10 },
        bgcolor: "rgba(0,0,0,0.6)",
        borderpad: 2,
        xanchor: "left",
        yanchor: "bottom",
        yshift: -2,
      });
    } else if (seg.geometry === "circle") {
      shapes.push({
        type: "circle",
        xref: "x",
        yref: "y",
        x0: seg.xc - seg.r,
        y0: seg.yc - seg.r,
        x1: seg.xc + seg.r,
        y1: seg.yc + seg.r,
        line: { color, width: lineWidth, dash: "dot" },
        fillcolor: fill,
        layer: "above",
        editable: editMode,
      });
      annotations.push({
        x: seg.xc - seg.r,
        y: seg.yc - seg.r,
        xref: "x",
        yref: "y",
        text: title,
        showarrow: false,
        font: { color, size: 10 },
        bgcolor: "rgba(0,0,0,0.6)",
        borderpad: 2,
        xanchor: "left",
        yanchor: "bottom",
        yshift: -2,
      });
    } else if (seg.geometry === "polygon" && seg.points.length >= 3) {
      // Plotly path syntax: M x,y L x,y L x,y Z
      const path =
        "M " + seg.points.map(([x, y]) => `${x},${y}`).join(" L ") + " Z";
      shapes.push({
        type: "path",
        path,
        xref: "x",
        yref: "y",
        line: { color, width: lineWidth, dash: "dot" },
        fillcolor: fill,
        layer: "above",
        editable: editMode,
      });
      annotations.push({
        x: seg.points[0][0],
        y: seg.points[0][1],
        xref: "x",
        yref: "y",
        text: title,
        showarrow: false,
        font: { color, size: 10 },
        bgcolor: "rgba(0,0,0,0.6)",
        borderpad: 2,
        xanchor: "left",
        yanchor: "bottom",
        yshift: -2,
      });
    }
  });
  return { roiShapes: shapes, roiAnnotations: annotations };
}
