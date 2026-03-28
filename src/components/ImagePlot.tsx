import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import type {
  AnalysisResult,
  GeometryAnalysisResult,
  ImageData,
  ImageRoiSegment,
} from "../sigima/runtime";

/** Pure-visualization tools available in the image viewer toolbar. */
type ImageTool = "profiles" | "contrast" | "stats" | null;

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
  /** Optional LUT range override ``[zmin, zmax]``. When ``null``/omitted,
   *  the heatmap falls back to the image's intrinsic ``data_min``/
   *  ``data_max``. Driven by the contrast tool. */
  lutRange?: [number, number] | null;
  /** Called when the user commits a new LUT range from the contrast
   *  panel (slider release / Auto button). ``null`` clears the override. */
  onLutRangeChange?: (range: [number, number] | null) => void;
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
  lutRange = null,
  onLutRangeChange,
}: ImagePlotProps) {
  // ------------------------------------------------------------------
  // Tool state machine — mutually exclusive; ROI edit mode wins.
  // ------------------------------------------------------------------
  const [tool, setTool] = useState<ImageTool>(null);
  useEffect(() => {
    if (roiEditMode && tool !== null) setTool(null);
  }, [roiEditMode, tool]);

  // Reset transient tool state when the underlying image changes.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [statsRect, setStatsRect] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  // Local LUT range while the user is dragging contrast sliders. Committed
  // to ``onLutRangeChange`` only on slider release / Auto / panel close.
  const [draftLut, setDraftLut] = useState<[number, number] | null>(null);
  useEffect(() => {
    setCursor(null);
    setStatsRect(null);
    setDraftLut(null);
  }, [data.id]);

  const effectiveLut: [number, number] = useMemo(() => {
    if (draftLut) return draftLut;
    if (lutRange) return lutRange;
    return [data.data_min, data.data_max];
  }, [draftLut, lutRange, data.data_min, data.data_max]);

  const traces = useMemo(() => {
    const z = data.data;
    const h = data.height;
    const w = data.width;
    const x = Array.from({ length: w }, (_, i) => data.x0 + (i + 0.5) * data.dx);
    const y = Array.from({ length: h }, (_, j) => data.y0 + (j + 0.5) * data.dy);
    return [
      {
        type: "heatmap" as const,
        z,
        x,
        y,
        zmin: effectiveLut[0],
        zmax: effectiveLut[1],
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
  }, [data, effectiveLut]);

  const { roiShapes, roiAnnotations } = useMemo(
    () => buildRoiOverlays(roi, roiEditMode),
    [roi, roiEditMode],
  );

  const { resultShapes, resultAnnotations, resultTraces } = useMemo(
    () => buildImageGeometryOverlays(results),
    [results],
  );

  // Crosshair shapes (profiles tool) and stats rectangle shape.
  const toolShapes = useMemo(() => {
    const shapes: unknown[] = [];
    if (tool === "profiles" && cursor) {
      const xMin = data.x0;
      const xMax = data.x0 + data.width * data.dx;
      const yMin = data.y0;
      const yMax = data.y0 + data.height * data.dy;
      shapes.push({
        type: "line",
        xref: "x",
        yref: "y",
        x0: cursor.x,
        x1: cursor.x,
        y0: yMin,
        y1: yMax,
        line: { color: CROSSHAIR_COLOR, width: 1, dash: "dot" },
        layer: "above",
        editable: false,
      });
      shapes.push({
        type: "line",
        xref: "x",
        yref: "y",
        x0: xMin,
        x1: xMax,
        y0: cursor.y,
        y1: cursor.y,
        line: { color: CROSSHAIR_COLOR, width: 1, dash: "dot" },
        layer: "above",
        editable: false,
      });
    }
    if (tool === "stats" && statsRect) {
      shapes.push({
        type: "rect",
        xref: "x",
        yref: "y",
        x0: statsRect.x0,
        y0: statsRect.y0,
        x1: statsRect.x1,
        y1: statsRect.y1,
        line: { color: STATS_COLOR, width: 2, dash: "solid" },
        fillcolor: "rgba(0,200,200,0.10)",
        layer: "above",
        editable: true,
      });
    }
    return shapes;
  }, [tool, cursor, statsRect, data]);

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
      yaxis: {
        title: { text: ytitle },
        scaleanchor: "x" as const,
        scaleratio: data.dy / data.dx,
        autorange: "reversed" as const,
      },
      shapes: [...roiShapes, ...resultShapes, ...toolShapes],
      annotations: [...roiAnnotations, ...resultAnnotations],
      newshape: roiEditMode
        ? {
            line: { color: ROI_COLOR, width: 2, dash: "dot" },
            fillcolor: "rgba(255,136,0,0.10)",
            opacity: 1,
          }
        : tool === "stats"
          ? {
              line: { color: STATS_COLOR, width: 2, dash: "solid" },
              fillcolor: "rgba(0,200,200,0.10)",
              opacity: 1,
            }
          : undefined,
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
    };
  }, [
    data,
    roiShapes,
    roiAnnotations,
    resultShapes,
    resultAnnotations,
    toolShapes,
    roiEditMode,
    tool,
  ]);

  const handleHover = useCallback(
    (event: Record<string, unknown>) => {
      if (tool !== "profiles") return;
      const points = (event as { points?: Array<Record<string, unknown>> })
        .points;
      if (!points || points.length === 0) return;
      const p = points[0];
      const x = Number(p.x);
      const y = Number(p.y);
      if (Number.isFinite(x) && Number.isFinite(y)) setCursor({ x, y });
    },
    [tool],
  );

  const handleRelayout = useCallback(
    (event: Record<string, unknown>) => {
      // ROI edit mode — existing logic.
      if (roiEditMode && onRoiChange) {
        const roiCount = roiShapes.length;
        const resultCount = resultShapes.length;
        if ("shapes" in event && Array.isArray(event.shapes)) {
          const allEv = event.shapes as Array<Record<string, unknown>>;
          const updated: ImageRoiSegment[] = [];
          const headLen = Math.min(roiCount, allEv.length);
          for (let i = 0; i < headLen; i++) {
            const seg = shapeToRoi(allEv[i], roi[i]);
            if (seg) updated.push(seg);
          }
          for (let i = roiCount + resultCount; i < allEv.length; i++) {
            const seg = shapeToRoi(allEv[i], null);
            if (seg) updated.push(seg);
          }
          onRoiChange(updated);
          return;
        }
        let dirty = false;
        const next = roi.slice();
        for (const key of Object.keys(event)) {
          const m = key.match(/^shapes\[(\d+)\]\.(.+)$/);
          if (!m) continue;
          const idx = Number(m[1]);
          if (idx >= roiCount) continue;
          const seg = next[idx];
          if (!seg) continue;
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
        return;
      }

      // Stats tool — capture the last user-drawn rectangle.
      if (tool === "stats") {
        const headCount = roiShapes.length + resultShapes.length;
        if ("shapes" in event && Array.isArray(event.shapes)) {
          const allEv = event.shapes as Array<Record<string, unknown>>;
          // Find a rectangle in the trailing slots (skip the existing
          // ROI/result blocks; the in-flight stats rect itself sits at
          // ``headCount`` once Plotly has redrawn).
          let found: typeof statsRect | null = null;
          for (let i = headCount; i < allEv.length; i++) {
            const s = allEv[i];
            if (s.type !== "rect") continue;
            const x0 = Number(s.x0);
            const x1 = Number(s.x1);
            const y0 = Number(s.y0);
            const y1 = Number(s.y1);
            if (![x0, x1, y0, y1].every(Number.isFinite)) continue;
            found = {
              x0: Math.min(x0, x1),
              x1: Math.max(x0, x1),
              y0: Math.min(y0, y1),
              y1: Math.max(y0, y1),
            };
          }
          setStatsRect(found);
          return;
        }
        // Live drag/resize: ``shapes[i].x0`` etc. — only if i targets the
        // stats slot (i.e. the first index past ROI+result shapes).
        const targetIdx = headCount;
        const patch: Record<string, unknown> = {};
        for (const k of Object.keys(event)) {
          const m = k.match(/^shapes\[(\d+)\]\.(.+)$/);
          if (m && Number(m[1]) === targetIdx) patch[m[2]] = event[k];
        }
        if (statsRect && Object.keys(patch).length > 0) {
          const x0 = Number(patch.x0 ?? statsRect.x0);
          const x1 = Number(patch.x1 ?? statsRect.x1);
          const y0 = Number(patch.y0 ?? statsRect.y0);
          const y1 = Number(patch.y1 ?? statsRect.y1);
          if ([x0, x1, y0, y1].every(Number.isFinite)) {
            setStatsRect({
              x0: Math.min(x0, x1),
              x1: Math.max(x0, x1),
              y0: Math.min(y0, y1),
              y1: Math.max(y0, y1),
            });
          }
        }
      }
    },
    [
      roiEditMode,
      onRoiChange,
      roi,
      roiShapes.length,
      resultShapes.length,
      tool,
      statsRect,
    ],
  );

  // ------------------------------------------------------------------
  // Profiles
  // ------------------------------------------------------------------
  const profileData = useMemo(() => {
    if (tool !== "profiles" || !cursor) return null;
    const col = Math.round((cursor.x - data.x0) / data.dx - 0.5);
    const row = Math.round((cursor.y - data.y0) / data.dy - 0.5);
    if (col < 0 || col >= data.width || row < 0 || row >= data.height) return null;
    const xs = Array.from(
      { length: data.width },
      (_, i) => data.x0 + (i + 0.5) * data.dx,
    );
    const ys = Array.from(
      { length: data.height },
      (_, j) => data.y0 + (j + 0.5) * data.dy,
    );
    const xProfile = data.data[row].slice();
    const yProfile = data.data.map((r) => r[col]);
    return { xs, ys, xProfile, yProfile, row, col };
  }, [tool, cursor, data]);

  // ------------------------------------------------------------------
  // Stats over the user-drawn rectangle (pure JS over data.data).
  // ------------------------------------------------------------------
  const statsValues = useMemo(() => {
    if (tool !== "stats" || !statsRect) return null;
    const i0 = Math.max(
      0,
      Math.floor((Math.min(statsRect.x0, statsRect.x1) - data.x0) / data.dx),
    );
    const i1 = Math.min(
      data.width,
      Math.ceil((Math.max(statsRect.x0, statsRect.x1) - data.x0) / data.dx),
    );
    const j0 = Math.max(
      0,
      Math.floor((Math.min(statsRect.y0, statsRect.y1) - data.y0) / data.dy),
    );
    const j1 = Math.min(
      data.height,
      Math.ceil((Math.max(statsRect.y0, statsRect.y1) - data.y0) / data.dy),
    );
    if (i1 <= i0 || j1 <= j0) return null;
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let j = j0; j < j1; j++) {
      const row = data.data[j];
      for (let i = i0; i < i1; i++) {
        const v = row[i];
        if (!Number.isFinite(v)) continue;
        sum += v;
        sumSq += v * v;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
        count++;
      }
    }
    if (count === 0) return null;
    const mean = sum / count;
    const variance = Math.max(0, sumSq / count - mean * mean);
    return {
      count,
      sum,
      mean,
      std: Math.sqrt(variance),
      min: minV,
      max: maxV,
      bbox: { i0, i1, j0, j1 },
    };
  }, [tool, statsRect, data]);

  // ------------------------------------------------------------------
  // Histogram for the contrast tool (fixed 256 bins over data extent).
  // ------------------------------------------------------------------
  const histogram = useMemo(() => {
    if (tool !== "contrast") return null;
    return computeHistogram(data.data, data.data_min, data.data_max, 256);
  }, [tool, data]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const wrapperClass = `image-plot-wrapper${tool ? ` tool-${tool}` : ""}`;
  const showProfiles = tool === "profiles";

  const heatmapPlot = (
    <Plot
      data={allTraces as never}
      layout={layout as never}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      config={
        {
          responsive: true,
          displaylogo: false,
          editable: roiEditMode || tool === "stats",
          modeBarButtonsToAdd: roiEditMode
            ? ["drawrect", "drawcircle", "drawclosedpath", "eraseshape"]
            : tool === "stats"
              ? ["drawrect", "eraseshape"]
              : [],
        } as never
      }
      onRelayout={handleRelayout}
      onHover={handleHover}
    />
  );

  return (
    <div className={wrapperClass}>
      <ImageToolbar tool={tool} setTool={setTool} disabled={roiEditMode} />
      <div className="image-plot-area">
        {showProfiles ? (
          <div className="image-plot-grid">
            <div className="image-plot-cell image-plot-cell-xprofile">
              {profileData ? (
                <Plot
                  data={[
                    {
                      x: profileData.xs,
                      y: profileData.xProfile,
                      type: "scatter",
                      mode: "lines",
                      line: { color: CROSSHAIR_COLOR, width: 1.5 },
                      hoverinfo: "skip",
                    } as never,
                  ]}
                  layout={
                    {
                      autosize: true,
                      margin: { l: 60, r: 30, t: 5, b: 5 },
                      xaxis: {
                        range: [data.x0, data.x0 + data.width * data.dx],
                        showticklabels: false,
                      },
                      yaxis: { showticklabels: true, automargin: true },
                      paper_bgcolor: "rgba(0,0,0,0)",
                      plot_bgcolor: "rgba(0,0,0,0)",
                      showlegend: false,
                    } as never
                  }
                  style={{ width: "100%", height: "100%" }}
                  config={{ displayModeBar: false, responsive: true } as never}
                  useResizeHandler
                />
              ) : (
                <div className="image-plot-hint">
                  Hover the image to update profiles
                </div>
              )}
            </div>
            <div className="image-plot-cell image-plot-cell-corner" />
            <div className="image-plot-cell image-plot-cell-heatmap">
              {heatmapPlot}
            </div>
            <div className="image-plot-cell image-plot-cell-yprofile">
              {profileData ? (
                <Plot
                  data={[
                    {
                      x: profileData.yProfile,
                      y: profileData.ys,
                      type: "scatter",
                      mode: "lines",
                      line: { color: CROSSHAIR_COLOR, width: 1.5 },
                      hoverinfo: "skip",
                    } as never,
                  ]}
                  layout={
                    {
                      autosize: true,
                      margin: { l: 5, r: 5, t: 40, b: 50 },
                      xaxis: { showticklabels: true, automargin: true },
                      yaxis: {
                        range: [
                          data.y0 + data.height * data.dy,
                          data.y0,
                        ],
                        showticklabels: false,
                      },
                      paper_bgcolor: "rgba(0,0,0,0)",
                      plot_bgcolor: "rgba(0,0,0,0)",
                      showlegend: false,
                    } as never
                  }
                  style={{ width: "100%", height: "100%" }}
                  config={{ displayModeBar: false, responsive: true } as never}
                  useResizeHandler
                />
              ) : null}
            </div>
          </div>
        ) : (
          heatmapPlot
        )}
        {tool === "stats" && statsValues && (
          <div className="image-stats-overlay">
            <div className="image-stats-overlay-header">
              <strong>Stats</strong>
              <button
                type="button"
                className="image-stats-overlay-close"
                onClick={() => setStatsRect(null)}
                aria-label="Clear stats area"
                title="Clear stats area"
              >
                ×
              </button>
            </div>
            <div className="image-stats-overlay-body">
              <span>n: {statsValues.count}</span>
              <span>mean: {fmt(statsValues.mean)}</span>
              <span>std: {fmt(statsValues.std)}</span>
              <span>min: {fmt(statsValues.min)}</span>
              <span>max: {fmt(statsValues.max)}</span>
              <span>sum: {fmt(statsValues.sum)}</span>
            </div>
          </div>
        )}
      </div>
      {tool === "contrast" && (
        <ContrastPanel
          dataMin={data.data_min}
          dataMax={data.data_max}
          range={effectiveLut}
          histogram={histogram}
          onPreview={(r) => setDraftLut(r)}
          onCommit={(r) => {
            setDraftLut(null);
            onLutRangeChange?.(r);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function ImageToolbar({
  tool,
  setTool,
  disabled,
}: {
  tool: ImageTool;
  setTool: (t: ImageTool) => void;
  disabled: boolean;
}) {
  const buttons: Array<{ id: Exclude<ImageTool, null>; label: string; title: string }> = [
    {
      id: "profiles",
      label: "Cross profiles",
      title: "Show X/Y intensity profiles under the cursor",
    },
    {
      id: "contrast",
      label: "Contrast",
      title: "Adjust the LUT range with a histogram and dual-handle slider",
    },
    {
      id: "stats",
      label: "Stats area",
      title: "Draw a rectangle to display statistics over a region",
    },
  ];
  return (
    <div className="image-tools-toolbar" role="toolbar" aria-label="Image visualization tools">
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          className={`image-tools-button${tool === b.id ? " active" : ""}`}
          onClick={() => setTool(tool === b.id ? null : b.id)}
          title={
            disabled
              ? "Disabled while ROI edit mode is active"
              : b.title
          }
          disabled={disabled}
          aria-pressed={tool === b.id}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contrast panel — histogram + dual range slider + Auto.
// ---------------------------------------------------------------------------

function ContrastPanel({
  dataMin,
  dataMax,
  range,
  histogram,
  onPreview,
  onCommit,
}: {
  dataMin: number;
  dataMax: number;
  range: [number, number];
  histogram: { centers: number[]; counts: number[] } | null;
  onPreview: (r: [number, number]) => void;
  onCommit: (r: [number, number] | null) => void;
}) {
  const span = Math.max(dataMax - dataMin, Number.EPSILON);
  // Slider works on a normalised 0..1000 range to allow fine control over
  // arbitrary data extents.
  const STEPS = 1000;
  const toStep = (v: number) =>
    Math.round(((v - dataMin) / span) * STEPS);
  const fromStep = (s: number) => dataMin + (s / STEPS) * span;
  const lowStep = Math.max(0, Math.min(STEPS, toStep(range[0])));
  const highStep = Math.max(0, Math.min(STEPS, toStep(range[1])));
  const currentRangeRef = useRef<[number, number]>(range);
  currentRangeRef.current = range;

  const handleLow = (s: number) => {
    const v = Math.min(fromStep(s), currentRangeRef.current[1]);
    onPreview([v, currentRangeRef.current[1]]);
  };
  const handleHigh = (s: number) => {
    const v = Math.max(fromStep(s), currentRangeRef.current[0]);
    onPreview([currentRangeRef.current[0], v]);
  };

  return (
    <div className="contrast-panel">
      {histogram && (
        <Plot
          data={[
            {
              x: histogram.centers,
              y: histogram.counts,
              type: "bar",
              marker: { color: "var(--accent, #5b9bff)" },
              hoverinfo: "skip",
            } as never,
          ]}
          layout={
            {
              autosize: true,
              margin: { l: 40, r: 10, t: 5, b: 25 },
              height: 90,
              xaxis: { range: [dataMin, dataMax] },
              yaxis: { showticklabels: false, type: "log" },
              shapes: [
                {
                  type: "rect",
                  xref: "x",
                  yref: "paper",
                  x0: dataMin,
                  x1: range[0],
                  y0: 0,
                  y1: 1,
                  fillcolor: "rgba(0,0,0,0.35)",
                  line: { width: 0 },
                  layer: "above",
                },
                {
                  type: "rect",
                  xref: "x",
                  yref: "paper",
                  x0: range[1],
                  x1: dataMax,
                  y0: 0,
                  y1: 1,
                  fillcolor: "rgba(0,0,0,0.35)",
                  line: { width: 0 },
                  layer: "above",
                },
              ],
              paper_bgcolor: "rgba(0,0,0,0)",
              plot_bgcolor: "rgba(0,0,0,0)",
              font: { color: PLOT_FG_COLOR },
              showlegend: false,
              bargap: 0,
            } as never
          }
          style={{ width: "100%", height: 90 }}
          config={{ displayModeBar: false, responsive: true } as never}
          useResizeHandler
        />
      )}
      <div className="contrast-sliders">
        <label>
          min
          <input
            type="range"
            min={0}
            max={STEPS}
            value={lowStep}
            onChange={(e) => handleLow(Number(e.target.value))}
            onMouseUp={() => onCommit(currentRangeRef.current)}
            onTouchEnd={() => onCommit(currentRangeRef.current)}
            onKeyUp={() => onCommit(currentRangeRef.current)}
          />
          <span className="contrast-value">{fmt(range[0])}</span>
        </label>
        <label>
          max
          <input
            type="range"
            min={0}
            max={STEPS}
            value={highStep}
            onChange={(e) => handleHigh(Number(e.target.value))}
            onMouseUp={() => onCommit(currentRangeRef.current)}
            onTouchEnd={() => onCommit(currentRangeRef.current)}
            onKeyUp={() => onCommit(currentRangeRef.current)}
          />
          <span className="contrast-value">{fmt(range[1])}</span>
        </label>
        <button
          type="button"
          className="contrast-auto"
          onClick={() => onCommit(null)}
          title="Reset to the image's intrinsic data range"
        >
          Auto
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CROSSHAIR_COLOR = "#3da4ff";
const STATS_COLOR = "#00c8c8";
/** Foreground color for Plotly text (axes ticks/labels). The wrapper
 *  cells are transparent so the dark surface shows through; tick text
 *  needs an explicit light color to stay readable. */
const PLOT_FG_COLOR = "#d4d4d4";

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(3);
  return Number(v.toFixed(4)).toString();
}

function computeHistogram(
  data: number[][],
  minV: number,
  maxV: number,
  bins: number,
): { centers: number[]; counts: number[] } {
  const counts = new Array<number>(bins).fill(0);
  const span = Math.max(maxV - minV, Number.EPSILON);
  for (const row of data) {
    for (const v of row) {
      if (!Number.isFinite(v)) continue;
      let idx = Math.floor(((v - minV) / span) * bins);
      if (idx < 0) idx = 0;
      else if (idx >= bins) idx = bins - 1;
      counts[idx]++;
    }
  }
  const centers = Array.from(
    { length: bins },
    (_, i) => minV + (i + 0.5) * (span / bins),
  );
  return { centers, counts };
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

