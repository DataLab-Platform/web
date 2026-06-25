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

/**
 * Parse a Plotly path string into an array of `[x, y]` points.
 *
 * Handles both the spaced form we emit when re-rendering an existing ROI
 * (`"M x,y L x,y Z"`) and the *space-less* form Plotly's `drawclosedpath`
 * tool produces for a freshly drawn polygon (`"M100,200L150,250L120,300Z"`).
 * We extract every `number,number` coordinate pair, ignoring the M/L/Z
 * command letters, so both formats round-trip correctly.
 */
export function parsePolygonPath(path: string): [number, number][] {
  const pts: [number, number][] = [];
  const re = /(-?\d*\.?\d+(?:e[+-]?\d+)?),(-?\d*\.?\d+(?:e[+-]?\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
  }
  return pts;
}

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

// ---------------------------------------------------------------------------
// Manual ROI drag geometry
//
// Plotly emits no live ``plotly_relayouting`` stream while an image-trace
// shape is dragged (it only reports the final geometry on mouse release —
// the same dead-interaction family as the manual-pan workaround). To give
// continuous visual feedback we drive ROI move/resize ourselves in
// ``ImagePlot``; these pure helpers compute the new geometry each frame and
// are unit-tested in isolation.
// ---------------------------------------------------------------------------

/** Which part of a ROI a pointer grabbed.
 *
 * - ``move`` — translate the whole ROI.
 * - ``x0y0`` / ``x1y0`` / ``x0y1`` / ``x1y1`` — rectangle corner resize
 *   (the diagonally opposite corner stays fixed).
 * - ``x0`` / ``x1`` / ``y0`` / ``y1`` — rectangle edge resize (one side moves,
 *   the opposite side stays fixed).
 * - ``radius`` — circle radius resize. */
export type RoiHandle =
  | "move"
  | "x0y0"
  | "x1y0"
  | "x0y1"
  | "x1y1"
  | "x0"
  | "x1"
  | "y0"
  | "y1"
  | "radius";

/**
 * Compute the new ROI geometry for an in-progress manual drag.
 *
 * @param orig   The segment as it was when the drag started (fixed anchor —
 *               deltas are applied to this, never accumulated, so the drag
 *               never drifts).
 * @param handle Which handle the pointer grabbed.
 * @param mx     Current pointer X in data coordinates.
 * @param my     Current pointer Y in data coordinates.
 * @param ax     Pointer X in data coordinates at drag start.
 * @param ay     Pointer Y in data coordinates at drag start.
 * @returns A new segment (same kind/title/inverse) with updated geometry.
 */
export function computeDraggedSegment(
  orig: ImageRoiSegment,
  handle: RoiHandle,
  mx: number,
  my: number,
  ax: number,
  ay: number,
): ImageRoiSegment {
  const ddx = mx - ax;
  const ddy = my - ay;
  if (orig.geometry === "rectangle") {
    if (handle === "move") {
      return { ...orig, x0: orig.x0 + ddx, y0: orig.y0 + ddy };
    }
    // Resize: move the grabbed edge(s) to the pointer, keeping the opposite
    // edge(s) fixed. Corner handles move two edges, edge handles move one.
    let xL = orig.x0;
    let xR = orig.x0 + orig.dx;
    let yB = orig.y0;
    let yT = orig.y0 + orig.dy;
    if (handle === "x0y0" || handle === "x0y1" || handle === "x0") xL = mx;
    if (handle === "x1y0" || handle === "x1y1" || handle === "x1") xR = mx;
    if (handle === "x0y0" || handle === "x1y0" || handle === "y0") yB = my;
    if (handle === "x0y1" || handle === "x1y1" || handle === "y1") yT = my;
    return {
      ...orig,
      x0: Math.min(xL, xR),
      y0: Math.min(yB, yT),
      dx: Math.max(Math.abs(xR - xL), 1e-9),
      dy: Math.max(Math.abs(yT - yB), 1e-9),
    };
  }
  if (orig.geometry === "circle") {
    if (handle === "move") {
      return { ...orig, xc: orig.xc + ddx, yc: orig.yc + ddy };
    }
    return {
      ...orig,
      r: Math.max(Math.hypot(mx - orig.xc, my - orig.yc), 1e-9),
    };
  }
  // Polygon — translation only (per-vertex editing is out of scope).
  if (handle === "move") {
    return {
      ...orig,
      points: orig.points.map(
        ([x, y]) => [x + ddx, y + ddy] as [number, number],
      ),
    };
  }
  return orig;
}

/**
 * Hit-test a pointer (in DATA coordinates) against a list of ROIs, returning
 * the topmost (last-drawn) ROI under the pointer and which handle was grabbed,
 * or ``null`` on a miss.
 *
 * Tolerances are per-axis data distances (typically an ~8px handle band
 * converted to data units), so corner/edge bands stay a constant on-screen
 * width regardless of zoom. Priority: corner → edge → interior.
 */
export function roiHitTest(
  roi: ImageRoiSegment[],
  mdx: number,
  mdy: number,
  tolX: number,
  tolY: number,
): { index: number; handle: RoiHandle } | null {
  for (let i = roi.length - 1; i >= 0; i--) {
    const s = roi[i];
    if (s.geometry === "rectangle") {
      const xL = s.x0;
      const xR = s.x0 + s.dx;
      const yB = s.y0;
      const yT = s.y0 + s.dy;
      const nearL = Math.abs(mdx - xL) <= tolX;
      const nearR = Math.abs(mdx - xR) <= tolX;
      const nearB = Math.abs(mdy - yB) <= tolY;
      const nearT = Math.abs(mdy - yT) <= tolY;
      const inXspan = mdx >= xL - tolX && mdx <= xR + tolX;
      const inYspan = mdy >= yB - tolY && mdy <= yT + tolY;
      // Corners first.
      if (nearL && nearB) return { index: i, handle: "x0y0" };
      if (nearR && nearB) return { index: i, handle: "x1y0" };
      if (nearL && nearT) return { index: i, handle: "x0y1" };
      if (nearR && nearT) return { index: i, handle: "x1y1" };
      // Edges.
      if (nearL && inYspan) return { index: i, handle: "x0" };
      if (nearR && inYspan) return { index: i, handle: "x1" };
      if (nearB && inXspan) return { index: i, handle: "y0" };
      if (nearT && inXspan) return { index: i, handle: "y1" };
      // Interior.
      if (mdx >= xL && mdx <= xR && mdy >= yB && mdy <= yT)
        return { index: i, handle: "move" };
    } else if (s.geometry === "circle") {
      const dd = Math.hypot(mdx - s.xc, mdy - s.yc);
      const avgTol = (tolX + tolY) / 2;
      if (Math.abs(dd - s.r) <= avgTol) return { index: i, handle: "radius" };
      if (dd < s.r) return { index: i, handle: "move" };
    } else if (s.geometry === "polygon") {
      if (pointInPolygon([mdx, mdy], s.points))
        return { index: i, handle: "move" };
    }
  }
  return null;
}

/**
 * CSS cursor for a hovered ROI handle.
 *
 * Corner cursors are screen-correct: ``xIncreasesRight`` / ``yIncreasesDown``
 * describe the axis pixel orientation (image Y axes are usually inverted), so
 * the diagonal arrow points along the actual on-screen resize direction.
 */
export function resizeCursor(
  handle: RoiHandle,
  xIncreasesRight: boolean,
  yIncreasesDown: boolean,
): string {
  switch (handle) {
    case "move":
      return "move";
    case "x0":
    case "x1":
      return "ew-resize";
    case "y0":
    case "y1":
      return "ns-resize";
    case "radius":
      return "nwse-resize";
    default: {
      // Corner: derive the on-screen quadrant from the data corner + axis
      // pixel orientation.
      const isLeftData = handle === "x0y0" || handle === "x0y1";
      const isTopData = handle === "x0y1" || handle === "x1y1";
      const screenLeft = isLeftData === xIncreasesRight;
      const screenTop = isTopData !== yIncreasesDown;
      return screenLeft === screenTop ? "nwse-resize" : "nesw-resize";
    }
  }
}

/** Ray-casting point-in-polygon test (even-odd rule). Coordinates may be in
 *  data or pixel space — the test is affine-invariant. */
export function pointInPolygon(
  pt: [number, number],
  poly: [number, number][],
): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
