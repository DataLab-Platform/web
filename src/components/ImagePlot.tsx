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
  /** ROI overlays drawn on top of the heatmap (read-only). */
  roi?: ImageRoiSegment[];
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
export function ImagePlot({ data, roi = [], results = [] }: ImagePlotProps) {
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
    () => buildRoiOverlays(roi),
    [roi],
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
      paper_bgcolor: "var(--surface)",
      plot_bgcolor: "var(--surface)",
    };
  }, [data, roiShapes, roiAnnotations, resultShapes, resultAnnotations]);

  return (
    <Plot
      data={allTraces as never}
      layout={layout as never}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      config={{ responsive: true, displaylogo: false }}
    />
  );
}

// ---------------------------------------------------------------------------
// ROI overlay helpers
// ---------------------------------------------------------------------------

const ROI_COLOR = "#ff8800";

function buildRoiOverlays(roi: ImageRoiSegment[]): {
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
        line: { color: ROI_COLOR, width: 1.5, dash: "dot" },
        layer: "above",
        editable: false,
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
        line: { color: ROI_COLOR, width: 1.5, dash: "dot" },
        layer: "above",
        editable: false,
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
        line: { color: ROI_COLOR, width: 1.5, dash: "dot" },
        layer: "above",
        editable: false,
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

