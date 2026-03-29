import { useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import { usePlotlyTheme } from "../utils/plotlyTheme";
import type {
  AnalysisResult,
  GeometryAnalysisResult,
  PlotlyAnnotations,
  SignalData,
  SignalRoiSegment,
} from "../sigima/runtime";
interface Props {
  data: SignalData;
  oid: string | null;
  annotations: PlotlyAnnotations;
  onAnnotationsChange: (payload: PlotlyAnnotations) => void;
  /** Persistent ROI segments to overlay. */
  roi?: SignalRoiSegment[];
  /** When true, ROI rectangles are draggable/resizable and the drawrect
   *  modebar tool produces new ROI segments instead of free annotations. */
  roiEditMode?: boolean;
  /** Called whenever the ROI list changed via direct plot interaction. */
  onRoiChange?: (segments: SignalRoiSegment[]) => void;
  /** Analysis results (FWHM, peaks, …) drawn as overlays on the plot. */
  results?: AnalysisResult[];
}

export function SignalPlot({
  data,
  oid,
  annotations,
  onAnnotationsChange,
  roi = [],
  roiEditMode = false,
  onRoiChange,
  results = [],
}: Props) {
  const plotlyTheme = usePlotlyTheme();
  const xAxisTitle = useMemo(
    () => formatAxis(data.xlabel || "X", data.xunit),
    [data.xlabel, data.xunit],
  );
  const yAxisTitle = useMemo(
    () => formatAxis(data.ylabel || "Y", data.yunit),
    [data.ylabel, data.yunit],
  );

  // Span used as default Y range for editable ROI rectangles (drag bounds).
  const { yMin, yMax } = useMemo(() => {
    if (data.y.length === 0) return { yMin: 0, yMax: 1 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of data.y) {
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      return { yMin: 0, yMax: 1 };
    }
    if (lo === hi) {
      return { yMin: lo - 0.5, yMax: hi + 0.5 };
    }
    const pad = (hi - lo) * 0.05;
    return { yMin: lo - pad, yMax: hi + pad };
  }, [data.y]);

  const [localShapes, setLocalShapes] = useState<unknown[]>(annotations.shapes);
  const [localAnnotations, setLocalAnnotations] = useState<unknown[]>(
    annotations.annotations,
  );

  // Sync from backend payload whenever the displayed signal or its
  // persisted annotations change.  The (oid, annotations) pair is the
  // authoritative source; any local edits are flushed back via the
  // debounced writer below.
  useEffect(() => {
    setLocalShapes(annotations.shapes);
    setLocalAnnotations(annotations.annotations);
  }, [oid, annotations]);

  // Debounced writeback to the Pyodide bridge.
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleWrite = (shapes: unknown[], anns: unknown[]) => {
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      onAnnotationsChange({ shapes, annotations: anns });
    }, 250);
  };

  const handleRelayout = (event: Record<string, unknown>) => {
    let touched = false;
    let nextShapes = localShapes;
    let nextAnns = localAnnotations;
    let roiChanged: SignalRoiSegment[] | null = null;

    if ("shapes" in event && Array.isArray(event.shapes)) {
      // Plotly returns the full shapes array, including ROI overlays we
      // injected at the head and result-geometry shapes right after.
      const allEv = event.shapes as Array<Record<string, unknown>>;
      const roiCount = roiShapes.length;
      const resultCount = resultShapes.length;
      // First N entries map back to the ROI list.
      if (roiEditMode && onRoiChange) {
        const updated: SignalRoiSegment[] = [];
        for (let i = 0; i < Math.min(roiCount, allEv.length); i++) {
          const s = allEv[i];
          const x0 = Number(s.x0);
          const x1 = Number(s.x1);
          if (Number.isFinite(x0) && Number.isFinite(x1)) {
            const xmin = Math.min(x0, x1);
            const xmax = Math.max(x0, x1);
            updated.push({ xmin, xmax, title: roi[i]?.title ?? "" });
          } else {
            updated.push(roi[i]);
          }
        }
        // Trailing entries beyond ROI+result blocks may be a newly drawn
        // rectangle: in edit mode we treat any extra "rect" shape with
        // numeric x bounds as a new ROI and consume it so it doesn't end
        // up persisted as an annotation.
        const extras: unknown[] = [];
        for (let i = roiCount + resultCount; i < allEv.length; i++) {
          const s = allEv[i];
          if (
            s.type === "rect" &&
            typeof s.x0 === "number" &&
            typeof s.x1 === "number"
          ) {
            const x0 = Number(s.x0);
            const x1 = Number(s.x1);
            if (x1 !== x0) {
              updated.push({
                xmin: Math.min(x0, x1),
                xmax: Math.max(x0, x1),
                title: "",
              });
              continue;
            }
          }
          extras.push(s);
        }
        // Detect deletion: shape count below initial ROI count means the
        // user hit "Erase active shape" on a ROI rectangle.  Plotly does
        // not tell us *which* index was removed; we re-sync to whatever
        // remained in the first roiCount slots.
        if (allEv.length < roiCount + resultCount) {
          // updated already has the surviving rects (less than roiCount).
        }
        roiChanged = updated;
        nextShapes = extras;
        touched = true;
      } else {
        nextShapes = allEv.slice(roiCount + resultCount);
        touched = true;
      }
    }
    if ("annotations" in event && Array.isArray(event.annotations)) {
      nextAnns = (event.annotations as unknown[]).slice(
        resultAnnotations.length,
      );
      touched = true;
    }
    for (const key of Object.keys(event)) {
      if (/^shapes\[\d+\]\./.test(key)) {
        // Single-shape drag/resize: figure out if it touched a ROI rect.
        const m = key.match(/^shapes\[(\d+)\]\.(x[01]|y[01])$/);
        if (m) {
          const idx = Number(m[1]);
          if (roiEditMode && idx < roiShapes.length && onRoiChange) {
            // Pull every "shapes[i].xN" key out of the event for this index
            // and update the corresponding ROI in place.
            const next = roi.slice();
            const x0Key = `shapes[${idx}].x0`;
            const x1Key = `shapes[${idx}].x1`;
            const x0 =
              x0Key in event ? Number(event[x0Key]) : roi[idx].xmin;
            const x1 =
              x1Key in event ? Number(event[x1Key]) : roi[idx].xmax;
            if (Number.isFinite(x0) && Number.isFinite(x1) && x0 !== x1) {
              next[idx] = {
                xmin: Math.min(x0, x1),
                xmax: Math.max(x0, x1),
                title: roi[idx].title,
              };
              roiChanged = next;
            }
          }
        }
        touched = true;
      } else if (/^annotations\[\d+\]\./.test(key)) {
        touched = true;
      }
    }
    if (!touched) return;
    setLocalShapes(nextShapes);
    setLocalAnnotations(nextAnns);
    scheduleWrite(nextShapes, nextAnns);
    if (roiChanged && onRoiChange) {
      onRoiChange(roiChanged);
    }
  };

  const roiShapes = useMemo(
    () =>
      roi.map((seg) => ({
        type: "rect" as const,
        xref: "x",
        // In edit mode we anchor the rect to the data Y-axis (so Plotly's\n        // editable shapes can be dragged) but we still ignore Y on persist.
        yref: roiEditMode ? ("y" as const) : ("paper" as const),
        x0: seg.xmin,
        x1: seg.xmax,
        y0: roiEditMode ? yMin : 0,
        y1: roiEditMode ? yMax : 1,
        fillcolor: roiEditMode
          ? "rgba(255, 165, 0, 0.10)"
          : "rgba(255, 165, 0, 0.18)",
        line: {
          color: roiEditMode ? "#ff8c00" : "rgba(255, 140, 0, 0.7)",
          width: roiEditMode ? 2 : 1,
          dash: roiEditMode ? "dot" : "solid",
        },
        layer: roiEditMode ? "above" : "below",
        editable: roiEditMode,
        label: roiEditMode
          ? {
              text: seg.title || "ROI",
              textposition: "top left",
              font: { color: "#ff8c00", size: 11 },
            }
          : undefined,
      })),
    [roi, roiEditMode, yMin, yMax],
  );

  // Convert each GeometryResult into Plotly shapes + a marker scatter trace
  // + textual annotations.  TableResults are *not* drawn here — they go to
  // the side panel.  Mirrors DataLab desktop's PlotPy overlay behaviour.
  const { resultShapes, resultAnnotations, resultTraces } = useMemo(
    () => buildGeometryOverlays(results),
    [results],
  );

  const allShapes = useMemo(
    () => [...roiShapes, ...resultShapes, ...localShapes],
    [roiShapes, resultShapes, localShapes],
  );
  const allAnnotations = useMemo(
    () => [...resultAnnotations, ...localAnnotations],
    [resultAnnotations, localAnnotations],
  );
  const allTraces = useMemo(
    () => [
      {
        x: data.x,
        y: data.y,
        type: "scatter" as const,
        mode: "lines" as const,
        line: { color: "#1f77b4", width: 1.5 },
        name: data.title,
      },
      ...resultTraces,
    ],
    [data.x, data.y, data.title, resultTraces],
  );

  return (
    <Plot
      data={allTraces as never}
      layout={
        {
          ...plotlyTheme,
          title: { text: data.title },
          autosize: true,
          margin: { l: 60, r: 20, t: 40, b: 50 },
          xaxis: { ...plotlyTheme.xaxis, title: { text: xAxisTitle } },
          yaxis: { ...plotlyTheme.yaxis, title: { text: yAxisTitle } },
          showlegend: resultTraces.length > 0,
          legend: { ...plotlyTheme.legend, orientation: "h", y: -0.2 },
          // In ROI edit mode, default newshape style matches the ROI overlay
          // so freshly drawn rectangles are visually consistent.
          newshape: roiEditMode
            ? {
                line: { color: "#ff8c00", width: 2, dash: "dot" },
                fillcolor: "rgba(255, 165, 0, 0.10)",
                opacity: 1,
              }
            : undefined,
          shapes: allShapes,
          annotations: allAnnotations,
        } as never
      }
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      config={
        {
          responsive: true,
          displaylogo: false,
          modeBarButtonsToAdd: roiEditMode
            ? ["drawrect", "eraseshape"]
            : ["drawline", "drawrect", "drawopenpath", "eraseshape"],
          editable: true,
        } as never
      }
      onRelayout={handleRelayout}
    />
  );
}

function formatAxis(label: string, unit: string): string {
  return unit ? `${label} (${unit})` : label;
}

// ---------------------------------------------------------------------------
// Geometry overlay rendering
// ---------------------------------------------------------------------------

const RESULT_PALETTE = [
  "#d62728", // brick red
  "#2ca02c", // green
  "#ff7f0e", // orange
  "#9467bd", // purple
  "#8c564b", // brown
  "#e377c2", // pink
  "#17becf", // cyan
];

function colorFor(funcName: string | null, fallback: number): string {
  if (!funcName) return RESULT_PALETTE[fallback % RESULT_PALETTE.length];
  // Deterministic hash so the same analysis func keeps the same colour.
  let h = 0;
  for (const c of funcName) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return RESULT_PALETTE[h % RESULT_PALETTE.length];
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e4)) return n.toExponential(3);
  return Number(n.toPrecision(5)).toString();
}

function buildGeometryOverlays(results: AnalysisResult[]): {
  resultShapes: unknown[];
  resultAnnotations: unknown[];
  resultTraces: unknown[];
} {
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];
  // Group point/marker rows into a single per-result scatter trace so the
  // legend stays compact.
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
        texts.push(`${name}<br>x=${fmt(row[0])}<br>y=${fmt(row[1])}`);
      }
      traces.push({
        x: xs,
        y: ys,
        type: "scatter",
        mode: geom.kind === "marker" ? "markers" : "markers+text",
        marker: {
          color,
          size: 10,
          symbol: geom.kind === "marker" ? "x" : "circle",
          line: { color, width: 2 },
        },
        text: geom.kind === "point" ? texts.map(() => "") : undefined,
        hovertext: texts,
        hoverinfo: "text",
        name,
        showlegend: true,
      });
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
          line: { color, width: 2 },
          layer: "above",
          editable: false,
        });
        annotations.push({
          x: (x0 + x1) / 2,
          y: (y0 + y1) / 2,
          xref: "x",
          yref: "y",
          text: `${name} = ${fmt(Math.hypot(x1 - x0, y1 - y0))}`,
          showarrow: false,
          font: { color, size: 11 },
          bgcolor: "rgba(255,255,255,0.7)",
          bordercolor: color,
          borderwidth: 1,
          borderpad: 2,
          yshift: 12,
        });
      }
      // Phantom legend trace so the user can see what each colour means.
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
    } else if (geom.kind === "circle") {
      for (const row of geom.coords) {
        const [cx, cy, r] = row;
        shapes.push({
          type: "circle",
          xref: "x",
          yref: "y",
          x0: cx - r,
          y0: cy - r,
          x1: cx + r,
          y1: cy + r,
          line: { color, width: 1.5 },
          layer: "above",
          editable: false,
        });
      }
    }
  }
  // Plot overlays attached to non-geometry results (currently only
  // emitted by pulse-features tables: baselines/plateau as segments,
  // x₀/x₅₀/x₁₀₀ as vertical markers).  We render them on top of the
  // signal trace so they read like DataLab desktop's PlotPy items.
  for (const r of results) {
    if (!r.overlays || r.overlays.length === 0) continue;
    const fallbackColor = colorFor(r.func_name, idx++);
    for (const ov of r.overlays) {
      const color = ov.color ?? fallbackColor;
      if (ov.kind === "segment") {
        shapes.push({
          type: "line",
          xref: "x",
          yref: "y",
          x0: ov.x0,
          y0: ov.y0,
          x1: ov.x1,
          y1: ov.y1,
          line: { color, width: 4 },
          layer: "above",
          editable: false,
        });
        if (ov.label) {
          annotations.push({
            x: (ov.x0 + ov.x1) / 2,
            y: (ov.y0 + ov.y1) / 2,
            xref: "x",
            yref: "y",
            text: ov.label,
            showarrow: false,
            font: { color: "#ffffff", size: 11 },
            bgcolor: "rgba(0,0,0,0.55)",
            bordercolor: color,
            borderwidth: 1,
            borderpad: 2,
            yshift: -14,
          });
        }
      } else if (ov.kind === "vline") {
        shapes.push({
          type: "line",
          xref: "x",
          yref: "paper",
          x0: ov.x,
          y0: 0,
          x1: ov.x,
          y1: 1,
          line: { color, width: 2, dash: "dot" },
          layer: "above",
          editable: false,
        });
        if (ov.label) {
          annotations.push({
            x: ov.x,
            y: 1,
            xref: "x",
            yref: "paper",
            text: ov.label,
            showarrow: false,
            font: { color: "#ffffff", size: 11, weight: 700 },
            bgcolor: "rgba(0,0,0,0.65)",
            bordercolor: color,
            borderwidth: 1,
            borderpad: 2,
            yshift: -2,
            xanchor: "center",
            yanchor: "top",
          });
        }
      } else if (ov.kind === "hline") {
        shapes.push({
          type: "line",
          xref: "paper",
          yref: "y",
          x0: 0,
          y0: ov.y,
          x1: 1,
          y1: ov.y,
          line: { color, width: 2, dash: "dot" },
          layer: "above",
          editable: false,
        });
        if (ov.label) {
          annotations.push({
            x: 1,
            y: ov.y,
            xref: "paper",
            yref: "y",
            text: ov.label,
            showarrow: false,
            font: { color: "#ffffff", size: 11 },
            bgcolor: "rgba(0,0,0,0.55)",
            bordercolor: color,
            borderwidth: 1,
            borderpad: 2,
            xshift: -4,
            xanchor: "right",
          });
        }
      }
    }
  }
  return {
    resultShapes: shapes,
    resultAnnotations: annotations,
    resultTraces: traces,
  };
}
