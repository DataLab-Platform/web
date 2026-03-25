import { useMemo } from "react";
import Plot from "react-plotly.js";
import type {
  AnalysisResult,
  GeometryAnalysisResult,
  ImageData,
  ImageRoiSegment,
} from "../sigima/runtime";

interface ImagePlotProps {
  data: ImageData;
  /** ROI overlays drawn on top of the heatmap. */
  roi?: ImageRoiSegment[];
  /** When true, ROI shapes become draggable/resizable and the
   *  drawrect/drawcircle/drawclosedpath modebar tools produce new ROI
   *  segments instead of free annotations. */
  roiEditMode?: boolean;
  /** Called whenever the ROI list changed via direct plot interaction. */
  onRoiChange?: (segments: ImageRoiSegment[]) => void;
  /** Analysis results (centroid, peaks, blobs, …) drawn as overlays. */
  results?: AnalysisResult[];
}

/**
 * Read-only image viewer using Plotly.js's ``heatmap`` trace.
 *
 * Mirrors DataLab desktop's image plot defaults: equal axes (1 px = 1 px),
 * top-left origin (Y axis reversed), and a colormap close to the desktop
 * default ``jet``-like one.  Pixel coordinates respect the image's
 * ``x0`` / ``y0`` / ``dx`` / ``dy`` metadata.  Optional overlays:
 *
 * * ``roi`` — orange dotted shapes for each user-defined ROI;
 * * ``results`` — geometry results (peaks, blobs, contours…) coloured per
 *   analysis function.
 */
export function ImagePlot({
  data,
  roi = [],
  roiEditMode = false,
  onRoiChange,
  results = [],
}: ImagePlotProps) {
  const traces = useMemo(() => {
    const z = data.data;
    const h = data.height;
    const w = data.width;
    // Centre coordinates so a pixel of size dx*dy is rendered as a square
    // of that size around (x0+i*dx, y0+j*dy).
    const x = Array.from({ length: w }, (_, i) => data.x0 + (i + 0.5) * data.dx);
    const y = Array.from({ length: h }, (_, j) => data.y0 + (j + 0.5) * data.dy);
    return [
      {
        type: "heatmap" as const,
        z,
        x,
        y,
        zmin: data.data_min,
        zmax: data.data_max,
        colorscale: "Jet" as const,
        showscale: true,
        colorbar: {
          title: { text: data.zunit ? `${data.zlabel} (${data.zunit})` : data.zlabel },
          thickness: 12,
        },
        hovertemplate:
          `${data.xlabel || "x"}: %{x}<br>` +
          `${data.ylabel || "y"}: %{y}<br>` +
          `${data.zlabel || "z"}: %{z}<extra></extra>`,
      },
    ];
  }, [data]);

  const { roiShapes, roiAnnotations } = useMemo(
    () => buildRoiOverlays(roi, roiEditMode),
    [roi, roiEditMode],
  );

  const { resultShapes, resultAnnotations, resultTraces } = useMemo(
    () => buildImageGeometryOverlays(results),
    [results],
  );

  const allTraces = useMemo(
    () => [...traces, ...resultTraces],
    [traces, resultTraces],
  );

  const layout = useMemo(() => {
    const xtitle = data.xunit ? `${data.xlabel} (${data.xunit})` : data.xlabel;
    const ytitle = data.yunit ? `${data.ylabel} (${data.yunit})` : data.ylabel;
    return {
      title: { text: data.title || "" },
      autosize: true,
      margin: { l: 60, r: 30, t: 40, b: 50 },
      xaxis: { title: { text: xtitle }, constrain: "domain" as const },
      // ``scaleanchor: "x"`` enforces 1:1 aspect ratio.  ``autorange:
      // "reversed"`` mirrors DataLab desktop's top-left origin convention.
      yaxis: {
        title: { text: ytitle },
        scaleanchor: "x" as const,
        scaleratio: data.dy / data.dx,
        autorange: "reversed" as const,
      },
      shapes: [...roiShapes, ...resultShapes],
      annotations: [...roiAnnotations, ...resultAnnotations],
      // Newly drawn shapes inherit the ROI overlay style in edit mode so
      // the user can immediately see what will become a ROI.
      newshape: roiEditMode
        ? {
            line: { color: ROI_COLOR, width: 2, dash: "dot" },
            fillcolor: "rgba(255,136,0,0.10)",
            opacity: 1,
          }
        : undefined,
      paper_bgcolor: "var(--surface)",
      plot_bgcolor: "var(--surface)",
    };
  }, [
    data,
    roiShapes,
    roiAnnotations,
    resultShapes,
    resultAnnotations,
    roiEditMode,
  ]);

  const handleRelayout = (event: Record<string, unknown>) => {
    if (!roiEditMode || !onRoiChange) return;
    const roiCount = roiShapes.length;
    const resultCount = resultShapes.length;

    // Case 1 — Plotly returned the full ``shapes`` array (drag end, draw,
    // or erase).  Reconcile it with the ROI list.
    if ("shapes" in event && Array.isArray(event.shapes)) {
      const allEv = event.shapes as Array<Record<string, unknown>>;
      const updated: ImageRoiSegment[] = [];
      // Surviving ROI shapes (first roiCount slots — but the user may have
      // erased some, in which case fewer remain).
      const headLen = Math.min(roiCount, allEv.length);
      for (let i = 0; i < headLen; i++) {
        const seg = shapeToRoi(allEv[i], roi[i]);
        if (seg) updated.push(seg);
      }
      // Trailing extras (after ROI + result blocks) ⇒ newly drawn shapes.
      for (let i = roiCount + resultCount; i < allEv.length; i++) {
        const seg = shapeToRoi(allEv[i], null);
        if (seg) updated.push(seg);
      }
      onRoiChange(updated);
      return;
    }

    // Case 2 — single-shape live drag/resize: ``shapes[i].x0`` etc.
    let dirty = false;
    const next = roi.slice();
    for (const key of Object.keys(event)) {
      const m = key.match(/^shapes\[(\d+)\]\.(.+)$/);
      if (!m) continue;
      const idx = Number(m[1]);
      if (idx >= roiCount) continue; // result shape, ignore
      const seg = next[idx];
      if (!seg) continue;
      // Pull every shapes[idx].* key for this index and rebuild the seg.
      const patch: Record<string, unknown> = {};
      for (const k2 of Object.keys(event)) {
        const m2 = k2.match(/^shapes\[(\d+)\]\.(.+)$/);
        if (m2 && Number(m2[1]) === idx) patch[m2[2]] = event[k2];
      }
      const updated = patchRoi(seg, patch);
      if (updated) {
        next[idx] = updated;
        dirty = true;
      }
    }
    if (dirty) onRoiChange(next);
  };

  return (
    <Plot
      data={allTraces as never}
      layout={layout as never}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      config={
        {
          responsive: true,
          displaylogo: false,
          editable: roiEditMode,
          modeBarButtonsToAdd: roiEditMode
            ? ["drawrect", "drawcircle", "drawclosedpath", "eraseshape"]
            : undefined,
        } as never
      }
      onRelayout={handleRelayout}
    />
  );
}

// ---------------------------------------------------------------------------
// ROI overlay helpers
// ---------------------------------------------------------------------------

const ROI_COLOR = "#ff8800";

function buildRoiOverlays(
  roi: ImageRoiSegment[],
  editMode = false,
): {
  roiShapes: unknown[];
  roiAnnotations: unknown[];
} {
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];
  roi.forEach((seg, idx) => {
    const title =
      seg.title ||
      `${seg.geometry === "rectangle" ? "Rect" : seg.geometry === "circle" ? "Circle" : "Poly"} ${idx + 1}`;
    if (seg.geometry === "rectangle") {
      shapes.push({
        type: "rect",
        xref: "x",
        yref: "y",
        x0: seg.x0,
        y0: seg.y0,
        x1: seg.x0 + seg.dx,
        y1: seg.y0 + seg.dy,
        line: { color: ROI_COLOR, width: editMode ? 2 : 1.5, dash: "dot" },
        fillcolor: editMode ? "rgba(255,136,0,0.10)" : undefined,
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
        font: { color: ROI_COLOR, size: 10 },
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
        line: { color: ROI_COLOR, width: editMode ? 2 : 1.5, dash: "dot" },
        fillcolor: editMode ? "rgba(255,136,0,0.10)" : undefined,
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
        font: { color: ROI_COLOR, size: 10 },
        bgcolor: "rgba(0,0,0,0.6)",
        borderpad: 2,
        xanchor: "left",
        yanchor: "bottom",
        yshift: -2,
      });
    } else if (seg.geometry === "polygon" && seg.points.length >= 3) {
      // Plotly path syntax: M x,y L x,y L x,y Z
      const path =
        "M " +
        seg.points.map(([x, y]) => `${x},${y}`).join(" L ") +
        " Z";
      shapes.push({
        type: "path",
        path,
        xref: "x",
        yref: "y",
        line: { color: ROI_COLOR, width: editMode ? 2 : 1.5, dash: "dot" },
        fillcolor: editMode ? "rgba(255,136,0,0.10)" : undefined,
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
        font: { color: ROI_COLOR, size: 10 },
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

// Parse a Plotly path string ("M x,y L x,y ... Z") into an array of points.
function parsePolygonPath(path: string): [number, number][] {
  const pts: [number, number][] = [];
  // Tokens separated by whitespace; each one is a command (M/L/Z) optionally
  // followed by "x,y", or just "x,y".
  for (const tok of path.split(/\s+/)) {
    if (!tok) continue;
    const cleaned = tok.replace(/^[MmLlZz]/, "");
    if (!cleaned.includes(",")) continue;
    const [xs, ys] = cleaned.split(",");
    const x = Number(xs);
    const y = Number(ys);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
  }
  return pts;
}

/** Convert a Plotly shape (rect/circle/path) to an ImageRoiSegment.
 *  ``existing`` provides defaults (title, inverse) for in-place updates. */
function shapeToRoi(
  shape: Record<string, unknown>,
  existing: ImageRoiSegment | null,
): ImageRoiSegment | null {
  const title = existing?.title ?? "";
  const inverse = existing?.inverse ?? false;
  const stype = shape.type;
  if (stype === "rect") {
    const x0 = Number(shape.x0);
    const x1 = Number(shape.x1);
    const y0 = Number(shape.y0);
    const y1 = Number(shape.y1);
    if (![x0, x1, y0, y1].every(Number.isFinite)) return null;
    const xmin = Math.min(x0, x1);
    const ymin = Math.min(y0, y1);
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    if (dx <= 0 || dy <= 0) return null;
    return { geometry: "rectangle", title, inverse, x0: xmin, y0: ymin, dx, dy };
  }
  if (stype === "circle") {
    const x0 = Number(shape.x0);
    const x1 = Number(shape.x1);
    const y0 = Number(shape.y0);
    const y1 = Number(shape.y1);
    if (![x0, x1, y0, y1].every(Number.isFinite)) return null;
    const xc = (x0 + x1) / 2;
    const yc = (y0 + y1) / 2;
    // The user can deform the circle into an ellipse by dragging — keep it
    // a circle by averaging the bbox half-extents.
    const r = (Math.abs(x1 - x0) + Math.abs(y1 - y0)) / 4;
    if (r <= 0) return null;
    return { geometry: "circle", title, inverse, xc, yc, r };
  }
  if (stype === "path" && typeof shape.path === "string") {
    const points = parsePolygonPath(shape.path);
    if (points.length < 3) return null;
    return { geometry: "polygon", title, inverse, points };
  }
  return null;
}

/** Apply a patch (subset of "x0"/"y0"/"x1"/"y1"/"path") to an existing
 *  ROI segment, preserving its kind/title/inverse. */
function patchRoi(
  seg: ImageRoiSegment,
  patch: Record<string, unknown>,
): ImageRoiSegment | null {
  if (seg.geometry === "rectangle") {
    const x0a = "x0" in patch ? Number(patch.x0) : seg.x0;
    const y0a = "y0" in patch ? Number(patch.y0) : seg.y0;
    const x1a = "x1" in patch ? Number(patch.x1) : seg.x0 + seg.dx;
    const y1a = "y1" in patch ? Number(patch.y1) : seg.y0 + seg.dy;
    if (![x0a, x1a, y0a, y1a].every(Number.isFinite)) return null;
    const xmin = Math.min(x0a, x1a);
    const ymin = Math.min(y0a, y1a);
    const dx = Math.abs(x1a - x0a);
    const dy = Math.abs(y1a - y0a);
    if (dx <= 0 || dy <= 0) return null;
    return { ...seg, x0: xmin, y0: ymin, dx, dy };
  }
  if (seg.geometry === "circle") {
    const x0a = "x0" in patch ? Number(patch.x0) : seg.xc - seg.r;
    const y0a = "y0" in patch ? Number(patch.y0) : seg.yc - seg.r;
    const x1a = "x1" in patch ? Number(patch.x1) : seg.xc + seg.r;
    const y1a = "y1" in patch ? Number(patch.y1) : seg.yc + seg.r;
    if (![x0a, x1a, y0a, y1a].every(Number.isFinite)) return null;
    const xc = (x0a + x1a) / 2;
    const yc = (y0a + y1a) / 2;
    const r = (Math.abs(x1a - x0a) + Math.abs(y1a - y0a)) / 4;
    if (r <= 0) return null;
    return { ...seg, xc, yc, r };
  }
  if (seg.geometry === "polygon") {
    if (typeof patch.path !== "string") return null;
    const points = parsePolygonPath(patch.path);
    if (points.length < 3) return null;
    return { ...seg, points };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Geometry-result overlays (peaks / blobs / contours / centroid …)
// ---------------------------------------------------------------------------

const RESULT_COLORS = [
  "#00b894",
  "#0984e3",
  "#fd79a8",
  "#fdcb6e",
  "#a29bfe",
  "#e17055",
];

function colorFor(funcName: string | null, idx: number): string {
  // Stable per-function colour: hash the name; fallback to round-robin.
  if (funcName) {
    let h = 0;
    for (let i = 0; i < funcName.length; i++) {
      h = (h * 31 + funcName.charCodeAt(i)) | 0;
    }
    return RESULT_COLORS[Math.abs(h) % RESULT_COLORS.length];
  }
  return RESULT_COLORS[idx % RESULT_COLORS.length];
}

function buildImageGeometryOverlays(results: AnalysisResult[]): {
  resultShapes: unknown[];
  resultAnnotations: unknown[];
  resultTraces: unknown[];
} {
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];
  const traces: unknown[] = [];
  let idx = 0;
  for (const r of results) {
    if (r.category !== "geometry") continue;
    const geom = r as GeometryAnalysisResult;
    const color = colorFor(geom.func_name, idx++);
    const name = geom.title || geom.func_name || geom.kind;
    if (geom.kind === "point" || geom.kind === "marker") {
      const xs: number[] = [];
      const ys: number[] = [];
      const texts: string[] = [];
      for (const row of geom.coords) {
        xs.push(row[0]);
        ys.push(row[1]);
        texts.push(`${name}<br>x=${row[0]}<br>y=${row[1]}`);
      }
      traces.push({
        x: xs,
        y: ys,
        type: "scatter",
        mode: "markers",
        marker: {
          color,
          size: 10,
          symbol: geom.kind === "marker" ? "x" : "circle-open",
          line: { color, width: 2 },
        },
        hovertext: texts,
        hoverinfo: "text",
        name,
        showlegend: true,
      });
    } else if (geom.kind === "circle") {
      for (const row of geom.coords) {
        const [cx, cy, rad] = row;
        shapes.push({
          type: "circle",
          xref: "x",
          yref: "y",
          x0: cx - rad,
          y0: cy - rad,
          x1: cx + rad,
          y1: cy + rad,
          line: { color, width: 1.5 },
          layer: "above",
          editable: false,
        });
      }
      // Legend phantom trace so the user knows what colour means what.
      traces.push({
        x: [null],
        y: [null],
        type: "scatter",
        mode: "lines",
        line: { color, width: 2 },
        name,
        showlegend: true,
      });
    } else if (geom.kind === "rectangle") {
      for (const row of geom.coords) {
        const [x0, y0, w, h] = row;
        shapes.push({
          type: "rect",
          xref: "x",
          yref: "y",
          x0,
          y0,
          x1: x0 + w,
          y1: y0 + h,
          line: { color, width: 1.5 },
          fillcolor: color + "22",
          layer: "above",
          editable: false,
        });
      }
    } else if (geom.kind === "ellipse") {
      // GeometryResult ellipse: (cx, cy, a, b, theta)
      // Plotly has no native rotated ellipse → approximate with a polygon.
      for (const row of geom.coords) {
        const [cx, cy, a, b, theta = 0] = row;
        const N = 64;
        const xs: number[] = [];
        const ys: number[] = [];
        const ct = Math.cos(theta);
        const st = Math.sin(theta);
        for (let i = 0; i <= N; i++) {
          const t = (i / N) * 2 * Math.PI;
          const ex = a * Math.cos(t);
          const ey = b * Math.sin(t);
          xs.push(cx + ex * ct - ey * st);
          ys.push(cy + ex * st + ey * ct);
        }
        traces.push({
          x: xs,
          y: ys,
          type: "scatter",
          mode: "lines",
          line: { color, width: 1.5 },
          name,
          showlegend: true,
          hoverinfo: "skip",
        });
      }
    } else if (geom.kind === "polygon") {
      for (const row of geom.coords) {
        const xs: number[] = [];
        const ys: number[] = [];
        for (let i = 0; i < row.length; i += 2) {
          xs.push(row[i]);
          ys.push(row[i + 1]);
        }
        if (xs.length > 0) {
          xs.push(xs[0]);
          ys.push(ys[0]);
        }
        traces.push({
          x: xs,
          y: ys,
          type: "scatter",
          mode: "lines",
          line: { color, width: 1.5 },
          name,
          showlegend: true,
          hoverinfo: "skip",
        });
      }
    } else if (geom.kind === "segment") {
      for (const row of geom.coords) {
        const [x0, y0, x1, y1] = row;
        shapes.push({
          type: "line",
          xref: "x",
          yref: "y",
          x0,
          y0,
          x1,
          y1,
          line: { color, width: 1.5 },
          layer: "above",
          editable: false,
        });
      }
    }
  }
  return {
    resultShapes: shapes,
    resultAnnotations: annotations,
    resultTraces: traces,
  };
}

