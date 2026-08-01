import { useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import { registerActivePlot } from "../aiassistant/plotCapture";
import { usePlotlyTheme } from "../utils/plotlyTheme";
import {
  buildCurveTrace,
  getCurveStyle,
  hexToRgba,
  normalizeCurveStyle,
  plotlyDash,
  roiLineColor,
} from "../runtime/plotStyles";
import { buildRoiAreaTrace, buildRoiBoundaryShapes } from "./signalRoi";
import { buildResultAnnotationBox } from "./resultBox";
import {
  buildSignalPlotLayout,
  SIGNAL_LAYOUT_MODES,
  type SignalAxisAssignment,
  type SignalLayoutMode,
  type SignalResultBundle,
} from "./signalPlotLayout";
import { useTheme } from "../utils/theme";
import { t } from "../i18n/translate";
import type {
  AnalysisResult,
  GeometryAnalysisResult,
  PlotlyAnnotations,
  SignalData,
  SignalRoiSegment,
} from "../runtime/runtime";
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
  /** When set (and ``roiEditMode`` is on), arms a graphical draw tool so a
   *  ROI can be traced immediately. ``"segment"`` maps to the rectangle
   *  tool (a horizontal band over the signal). */
  drawGeometry?: "segment" | "rectangle" | "circle" | "polygon" | null;
  /** Analysis results (FWHM, peaks, …) drawn as overlays on the plot. */
  results?: AnalysisResult[];
  /** Analysis results attached to the other selected signals, retaining
   *  source ids so split layouts can use the corresponding axes. */
  extraResults?: SignalResultBundle[];
  /** When true, append a paper-coords summary annotation listing
   *  TableAnalysisResult values in the top-right corner. Defaults
   *  to ``false`` since the right-hand Results panel already shows
   *  the same numbers in a structured grid. */
  showResultsOverlay?: boolean;
  /** When true (default), draw textual labels on ROI rectangles and
   *  on geometry analysis results (segment lengths, peak names, …).
   *  Wired to the View > "Show graphical object titles" toggle. */
  showGraphicalTitles?: boolean;
  /** Additional signals displayed alongside ``data`` (multi-selection). */
  extraSignals?: SignalData[];
  /** Multi-signal arrangement. Defaults to the historical overlay mode. */
  layoutMode?: SignalLayoutMode;
  /** Change the browser-level multi-signal arrangement preference. */
  onLayoutModeChange?: (mode: SignalLayoutMode) => void;
}

export function SignalPlot({
  data,
  oid,
  annotations,
  onAnnotationsChange,
  roi = [],
  roiEditMode = false,
  onRoiChange,
  drawGeometry = null,
  results = [],
  extraResults = [],
  showResultsOverlay = false,
  showGraphicalTitles = true,
  extraSignals = [],
  layoutMode = "overlay",
  onLayoutModeChange,
}: Props) {
  const plotlyTheme = usePlotlyTheme();
  const allSignals = useMemo(
    () => [data, ...extraSignals],
    [data, extraSignals],
  );
  const signalLayout = useMemo(
    () => buildSignalPlotLayout(allSignals, layoutMode),
    [allSignals, layoutMode],
  );
  const axisBySignalId = useMemo(
    () =>
      new Map(
        signalLayout.assignments.map((assignment) => [
          assignment.signalId,
          assignment,
        ]),
      ),
    [signalLayout.assignments],
  );
  const primaryAxis = signalLayout.assignments[0];
  const splitLayout = signalLayout.effectiveMode !== "overlay";
  const themedAxes = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(signalLayout.axes).map(([key, axis]) => [
          key,
          {
            ...(key.startsWith("xaxis")
              ? plotlyTheme.xaxis
              : plotlyTheme.yaxis),
            ...axis,
          },
        ]),
      ),
    [plotlyTheme.xaxis, plotlyTheme.yaxis, signalLayout.axes],
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

  // Cancel any pending debounced writeback when the plot unmounts so we
  // never call ``onAnnotationsChange`` on a torn-down component.
  useEffect(() => {
    return () => {
      if (writeTimer.current) clearTimeout(writeTimer.current);
    };
  }, []);

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
      // Dashed boundary lines are injected (view mode only) right after the
      // ROI block; they are not user-editable and must be skipped when
      // recovering the trailing free-annotation shapes.
      const boundaryCount = roiBoundaryShapes.length;
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
        nextShapes = extras.map((shape, index) =>
          restorePrimaryPaperReferences(
            shape,
            localShapes[index],
            primaryAxis,
            splitLayout,
          ),
        );
        touched = true;
      } else {
        nextShapes = allEv
          .slice(roiCount + boundaryCount + resultCount)
          .map((shape, index) =>
            restorePrimaryPaperReferences(
              shape,
              localShapes[index],
              primaryAxis,
              splitLayout,
            ),
          );
        touched = true;
      }
    }
    if ("annotations" in event && Array.isArray(event.annotations)) {
      nextAnns = (event.annotations as unknown[])
        .slice(resultAnnotations.length + resultBoxAnnotations.length)
        .map((annotation, index) =>
          restorePrimaryPaperReferences(
            annotation,
            localAnnotations[index],
            primaryAxis,
            splitLayout,
          ),
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
            const x0 = x0Key in event ? Number(event[x0Key]) : roi[idx].xmin;
            const x1 = x1Key in event ? Number(event[x1Key]) : roi[idx].xmax;
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

  // Always-fresh handle to ``handleRelayout`` for the imperatively-bound
  // ``plotly_relayouting`` listener (see ``onInitialized``), so live drags
  // never call a stale closure.
  const relayoutHandlerRef = useRef(handleRelayout);
  relayoutHandlerRef.current = handleRelayout;

  // Edit-mode ROI rectangles: kept anchored to the data Y-axis so
  // Plotly's editable shapes can be dragged/resized.  Each rectangle is
  // tinted with the per-ROI color so multi-ROI editing stays readable.
  // In view mode we draw the ROI as a filled "area under curve" trace
  // (see ``roiFillTraces`` below) instead of a flat vertical band, so
  // ``roiShapes`` is empty there.
  const roiShapes = useMemo(() => {
    if (!roiEditMode) return [] as unknown[];
    return roi.map((seg, i) => {
      const lineColor = roiLineColor(i);
      const baseShape = {
        type: "rect" as const,
        xref: "x",
        yref: "y" as const,
        x0: seg.xmin,
        x1: seg.xmax,
        y0: yMin,
        y1: yMax,
        fillcolor: hexToRgba(lineColor, 0.1),
        line: { color: lineColor, width: 2, dash: "dot" },
        layer: "above" as const,
        editable: true,
      };
      if (!showGraphicalTitles) return baseShape;
      return {
        ...baseShape,
        label: {
          text: seg.title || `ROI${i + 1}`,
          textposition: "top left",
          font: { color: lineColor, size: 11 },
        },
      };
    });
  }, [roi, roiEditMode, yMin, yMax, showGraphicalTitles]);

  // View-mode "area under curve" overlay: one filled scatter trace per
  // ROI, clipping the primary signal between ``xmin`` and ``xmax`` and
  // filling down to ``y = 0``.  Mirrors the new desktop reference
  // (``feature/309-spectral-analysis``: ``_CurveClippedXRangeSelection``)
  // and the Plotly notebook backend (``plotly_backend.py``,
  // ``ROI_FILL_COLORS`` palette).  Boundary x-values are linearly
  // interpolated on the curve so the polygon edges align exactly with
  // the requested interval.
  const roiFillTraces = useMemo(() => {
    if (roiEditMode) return [] as unknown[];
    return roi
      .map((seg, i) => buildRoiAreaTrace(seg, i, data.x, data.y))
      .filter((t): t is Record<string, unknown> => t !== null);
  }, [roi, roiEditMode, data.x, data.y]);

  // View-mode dashed vertical boundary lines: two per ROI (at ``xmin`` and
  // ``xmax``) spanning the full plotting area (``yref: "paper"``) so they
  // reach the very top of the graph.  Empty in edit mode, where the
  // draggable rectangles already mark the boundaries.
  const roiBoundaryShapes = useMemo(() => {
    if (roiEditMode) return [] as unknown[];
    return roi.flatMap((seg, i) =>
      buildRoiBoundaryShapes(seg, i, splitLayout ? "y domain" : "paper"),
    );
  }, [roi, roiEditMode, splitLayout]);

  // Convert every signal's GeometryResults into source-axis-aware Plotly
  // overlays. TableResults remain in the side panel and primary summary box.
  const { resultShapes, resultAnnotations, resultTraces } = useMemo(() => {
    const bundles: SignalResultBundle[] = [
      { signalId: data.id, results },
      ...extraResults,
    ];
    const resultShapes: unknown[] = [];
    const resultAnnotations: unknown[] = [];
    const resultTraces: unknown[] = [];
    bundles.forEach((bundle, bundleIndex) => {
      const axis = axisBySignalId.get(bundle.signalId);
      if (!axis) return;
      const overlays = buildGeometryOverlays(
        bundle.results,
        showGraphicalTitles,
        axis,
        splitLayout,
        bundleIndex * RESULT_PALETTE.length,
      );
      resultShapes.push(...overlays.resultShapes);
      resultAnnotations.push(...overlays.resultAnnotations);
      resultTraces.push(
        ...overlays.resultTraces.map((trace, traceIndex) => ({
          ...(trace as Record<string, unknown>),
          legendgroup: bundle.signalId,
          uid: `${bundle.signalId}:result:${traceIndex}`,
        })),
      );
    });
    return { resultShapes, resultAnnotations, resultTraces };
  }, [
    axisBySignalId,
    data.id,
    extraResults,
    results,
    showGraphicalTitles,
    splitLayout,
  ]);
  // Top-right paper-coords summary box for TableAnalysisResult rows
  // (FWHM, centroid, peaks, …).  Mirrors PlotPy's "computing results"
  // annotation in DataLab desktop.
  const { theme } = useTheme();
  const { annotations: resultBoxAnnotations } = useMemo(
    () =>
      showResultsOverlay
        ? buildResultAnnotationBox(results, { dark: theme === "dark" })
        : { annotations: [] },
    [results, theme, showResultsOverlay],
  );
  const displayLocalShapes = useMemo(
    () =>
      localShapes.map((shape) =>
        scopePrimaryPaperReferences(shape, primaryAxis, splitLayout),
      ),
    [localShapes, primaryAxis, splitLayout],
  );
  const displayLocalAnnotations = useMemo(
    () =>
      localAnnotations.map((annotation) =>
        scopePrimaryPaperReferences(annotation, primaryAxis, splitLayout),
      ),
    [localAnnotations, primaryAxis, splitLayout],
  );

  const allShapes = useMemo(
    () => [
      ...roiShapes,
      ...roiBoundaryShapes,
      ...resultShapes,
      ...displayLocalShapes,
    ],
    [roiShapes, roiBoundaryShapes, resultShapes, displayLocalShapes],
  );
  const allAnnotations = useMemo(
    () => [
      ...resultAnnotations,
      ...resultBoxAnnotations,
      ...displayLocalAnnotations,
    ],
    [resultAnnotations, resultBoxAnnotations, displayLocalAnnotations],
  );
  const allTraces = useMemo(() => {
    const curveTraces = allSignals.map((sig, i) => {
      const axis = signalLayout.assignments[i];
      const auto = getCurveStyle(i);
      const color = sig.style?.color ?? auto.color;
      const dash = sig.style?.linestyle
        ? plotlyDash(sig.style.linestyle)
        : auto.dash;
      const width = sig.style?.linewidth ?? auto.width;
      const mode = normalizeCurveStyle(sig.style?.curvestyle);
      const partial = buildCurveTrace(sig.x, sig.y, color, width, dash, mode);
      return {
        x: partial.x ?? sig.x,
        y: partial.y ?? sig.y,
        type: partial.type,
        mode: partial.mode,
        ...(partial.line ? { line: partial.line } : {}),
        ...(partial.marker ? { marker: partial.marker } : {}),
        name: sig.title,
        showlegend: true,
        uid: sig.id,
        legendgroup: sig.id,
        xaxis: axis.xRef,
        yaxis: axis.yRef,
      };
    });
    const scopedRoiTraces = roiFillTraces.map((trace) => ({
      ...(trace as Record<string, unknown>),
      xaxis: primaryAxis.xRef,
      yaxis: primaryAxis.yRef,
      legendgroup: data.id,
    }));
    return [...scopedRoiTraces, ...curveTraces, ...resultTraces];
  }, [
    allSignals,
    data.id,
    primaryAxis,
    resultTraces,
    roiFillTraces,
    signalLayout.assignments,
  ]);
  const orderedSignalIds = allSignals.map((signal) => signal.id).join(",");
  const figureRevision = `${signalLayout.effectiveMode}:${orderedSignalIds}`;

  return (
    <div className="signal-plot-host">
      {extraSignals.length > 0 && onLayoutModeChange && (
        <div
          className="signal-layout-modebar"
          role="group"
          aria-label={t("Signal plot layout")}
        >
          <span className="signal-layout-label">
            {t("Signal plot layout")}:
          </span>
          {SIGNAL_LAYOUT_MODES.map((mode) => {
            const label =
              mode === "overlay"
                ? t("Overlay")
                : mode === "vertical"
                  ? t("Vertical")
                  : t("Horizontal");
            return (
              <button
                key={mode}
                type="button"
                className={`signal-layout-modebtn${layoutMode === mode ? " active" : ""}`}
                aria-pressed={layoutMode === mode}
                onClick={() => onLayoutModeChange(mode)}
                title={label}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      <div className="signal-plot-viewport">
        <div
          className="signal-plot-canvas"
          style={{
            minWidth: signalLayout.minWidth,
            minHeight: signalLayout.minHeight,
          }}
        >
          <Plot
            data={allTraces as never}
            layout={
              {
                ...plotlyTheme,
                ...themedAxes,
                title: { text: data.title },
                autosize: true,
                margin: { l: 70, r: 30, t: 40, b: 55 },
                showlegend: resultTraces.length > 0 || extraSignals.length > 0,
                uirevision: figureRevision,
                // Legend inside the plot, anchored top-right, mirroring the
                // DataLab desktop layout. A semi-transparent background keeps it
                // readable when it overlaps the curves.
                legend: {
                  ...plotlyTheme.legend,
                  x: 1,
                  y: 1,
                  xanchor: "right",
                  yanchor: "top",
                  bgcolor:
                    theme === "dark"
                      ? "rgba(30,30,30,0.7)"
                      : "rgba(255,255,255,0.7)",
                  bordercolor: theme === "dark" ? "#5a5a5a" : "#bdbdbd",
                  borderwidth: 1,
                  uirevision: orderedSignalIds,
                },
                // In ROI edit mode, the newshape default uses the next ROI's
                // color so the freshly drawn rectangle matches its position in
                // the cycling palette as soon as it is committed.
                newshape: roiEditMode
                  ? {
                      line: {
                        color: roiLineColor(roi.length),
                        width: 2,
                        dash: "dot",
                      },
                      fillcolor: hexToRgba(roiLineColor(roi.length), 0.1),
                      opacity: 1,
                    }
                  : undefined,
                // Auto-arm the rectangle-draw tool when the ROI panel requests it
                // so the user can trace a first ROI without hunting for a modebar
                // button (otherwise dragging would just pan/zoom).
                ...(roiEditMode && drawGeometry
                  ? { dragmode: "drawrect" as const }
                  : {}),
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
            onInitialized={(_fig, gd) => {
              registerActivePlot("signal", gd);
              // ``react-plotly.js`` does not type ``onRelayouting`` (the live,
              // per-frame drag event). Bind it imperatively so ROI drags update
              // the overlay/form continuously instead of only on mouse release.
              const g = gd as unknown as {
                on?: (
                  ev: string,
                  cb: (e: Record<string, unknown>) => void,
                ) => void;
              };
              g.on?.("plotly_relayouting", (e) =>
                relayoutHandlerRef.current(e),
              );
            }}
            onUpdate={(_fig, gd) => registerActivePlot("signal", gd)}
            onPurge={() => registerActivePlot("signal", null)}
          />
        </div>
      </div>
    </div>
  );
}

function isPlotlyRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scopePrimaryPaperReferences(
  value: unknown,
  axis: SignalAxisAssignment,
  split: boolean,
): unknown {
  if (!split || !isPlotlyRecord(value)) return value;
  return {
    ...value,
    xref: value.xref === "paper" ? `${axis.xRef} domain` : value.xref,
    yref: value.yref === "paper" ? `${axis.yRef} domain` : value.yref,
  };
}

function restorePrimaryPaperReferences(
  value: unknown,
  originalValue: unknown,
  axis: SignalAxisAssignment,
  split: boolean,
): unknown {
  if (!split || !isPlotlyRecord(value) || !isPlotlyRecord(originalValue)) {
    return value;
  }
  return {
    ...value,
    xref:
      originalValue.xref === "paper" && value.xref === `${axis.xRef} domain`
        ? "paper"
        : value.xref,
    yref:
      originalValue.yref === "paper" && value.yref === `${axis.yRef} domain`
        ? "paper"
        : value.yref,
  };
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

function buildGeometryOverlays(
  results: AnalysisResult[],
  showTitles: boolean,
  axis: SignalAxisAssignment,
  scopeToDomain: boolean,
  colorOffset = 0,
): {
  resultShapes: unknown[];
  resultAnnotations: unknown[];
  resultTraces: unknown[];
} {
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];
  // Group point/marker rows into a single per-result scatter trace so the
  // legend stays compact.
  const traces: unknown[] = [];
  let idx = colorOffset;
  const xDomainRef = scopeToDomain ? `${axis.xRef} domain` : "paper";
  const yDomainRef = scopeToDomain ? `${axis.yRef} domain` : "paper";
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
        xaxis: axis.xRef,
        yaxis: axis.yRef,
      });
    } else if (geom.kind === "segment") {
      for (const row of geom.coords) {
        const [x0, y0, x1, y1] = row;
        shapes.push({
          type: "line",
          xref: axis.xRef,
          yref: axis.yRef,
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
          xref: axis.xRef,
          yref: axis.yRef,
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
        xaxis: axis.xRef,
        yaxis: axis.yRef,
      });
    } else if (geom.kind === "rectangle") {
      for (const row of geom.coords) {
        const [x0, y0, w, h] = row;
        shapes.push({
          type: "rect",
          xref: axis.xRef,
          yref: axis.yRef,
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
          xref: axis.xRef,
          yref: axis.yRef,
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
          xref: axis.xRef,
          yref: axis.yRef,
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
            xref: axis.xRef,
            yref: axis.yRef,
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
          xref: axis.xRef,
          yref: yDomainRef,
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
            xref: axis.xRef,
            yref: yDomainRef,
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
          xref: xDomainRef,
          yref: axis.yRef,
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
            xref: xDomainRef,
            yref: axis.yRef,
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
    // When the user disabled "Show graphical object titles", drop every
    // textual annotation produced above (segment lengths, baseline
    // labels, x₀/x₅₀ vertical-line tags, …) while keeping the shapes
    // themselves visible.
    resultAnnotations: showTitles ? annotations : [],
    resultTraces: traces,
  };
}
