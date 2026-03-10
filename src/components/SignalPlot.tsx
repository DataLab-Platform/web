import { useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import type {
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
}

export function SignalPlot({
  data,
  oid,
  annotations,
  onAnnotationsChange,
  roi = [],
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
      nextShapes = (event.shapes as unknown[]).slice(roiShapes.length);
      touched = true;
    }
    if ("annotations" in event && Array.isArray(event.annotations)) {
      nextAnns = event.annotations as unknown[];
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

  const allShapes = useMemo(
    () => [...roiShapes, ...localShapes],
    [roiShapes, localShapes],
  );

  return (
    <Plot
      data={[
        {
          x: data.x,
          y: data.y,
          type: "scatter",
          mode: "lines",
          line: { color: "#1f77b4", width: 1.5 },
          name: data.title,
        },
      ]}
      layout={{
        title: { text: data.title },
        autosize: true,
        margin: { l: 60, r: 20, t: 40, b: 50 },
        xaxis: { title: { text: xAxisTitle } },
        yaxis: { title: { text: yAxisTitle } },
        showlegend: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        shapes: allShapes as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        annotations: localAnnotations as any,
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
