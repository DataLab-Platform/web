import { useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
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
  /** Persistent ROI segments to overlay (read-only here, edited via dialog). */
  roi?: SignalRoiSegment[];
  /** Analysis results (FWHM, peaks, …) drawn as overlays on the plot. */
  results?: AnalysisResult[];
}

export function SignalPlot({
  data,
  oid,
  annotations,
  onAnnotationsChange,
  roi = [],
  results = [],
}: Props) {
  const xAxisTitle = useMemo(
    () => formatAxis(data.xlabel || "X", data.xunit),
    [data.xlabel, data.xunit],
  );
  const yAxisTitle = useMemo(
    () => formatAxis(data.ylabel || "Y", data.yunit),
    [data.ylabel, data.yunit],
  );

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
    if ("shapes" in event && Array.isArray(event.shapes)) {
      // Plotly returns the full shapes array including the ROI overlays we
      // injected; drop the leading ROI block so we only persist user-drawn
      // annotations.
      nextShapes = (event.shapes as unknown[]).slice(
        roiShapes.length + resultShapes.length,
      );
      touched = true;
    }
    if ("annotations" in event && Array.isArray(event.annotations)) {
      nextAnns = (event.annotations as unknown[]).slice(
        resultAnnotations.length,
      );
      touched = true;
    }
    for (const key of Object.keys(event)) {
      if (/^shapes\[\d+\]\./.test(key) || /^annotations\[\d+\]\./.test(key)) {
        touched = true;
      }
    }
    if (!touched) return;
    setLocalShapes(nextShapes);
    setLocalAnnotations(nextAnns);
    scheduleWrite(nextShapes, nextAnns);
  };

  const roiShapes = useMemo(
    () =>
      roi.map((seg) => ({
        type: "rect" as const,
        xref: "x",
        yref: "paper",
        x0: seg.xmin,
        x1: seg.xmax,
        y0: 0,
        y1: 1,
        fillcolor: "rgba(255, 165, 0, 0.18)",
        line: { color: "rgba(255, 140, 0, 0.7)", width: 1 },
        layer: "below",
        editable: false,
      })),
    [roi],
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
      layout={{
        title: { text: data.title },
        autosize: true,
        margin: { l: 60, r: 20, t: 40, b: 50 },
        xaxis: { title: { text: xAxisTitle } },
        yaxis: { title: { text: yAxisTitle } },
        showlegend: resultTraces.length > 0,
        legend: { orientation: "h", y: -0.2 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        shapes: allShapes as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        annotations: allAnnotations as any,
      }}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      config={{
        responsive: true,
        displaylogo: false,
        modeBarButtonsToAdd: [
          "drawline",
          "drawrect",
          "drawopenpath",
          "eraseshape",
        ],
        editable: true,
      }}
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
  return {
    resultShapes: shapes,
    resultAnnotations: annotations,
    resultTraces: traces,
  };
}
