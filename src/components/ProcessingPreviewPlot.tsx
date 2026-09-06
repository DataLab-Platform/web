import { useMemo } from "react";
import Plot from "react-plotly.js";
import type { Data } from "plotly.js";

import type { ProcessingPreviewResult } from "../runtime/runtime";
import { buildCurveTrace, getCurveStyle } from "../runtime/plotStyles";
import { buildColorscale } from "../utils/colormap";
import { toBins } from "../utils/imageCoords";
import { rasterizeImage, normalizeResampleMethod } from "../utils/imageRaster";
import { usePlotlyTheme } from "../utils/plotlyTheme";
import { reduceSignalForPlot } from "../utils/signalLod";

interface Props {
  result: ProcessingPreviewResult;
}

type SignalPreviewResult = Extract<ProcessingPreviewResult, { kind: "signal" }>;
type ImagePreviewResult = Extract<ProcessingPreviewResult, { kind: "image" }>;

const PLOT_STYLE = { width: "100%", height: "100%" } as const;
const PLOT_CONFIG = {
  responsive: true,
  displaylogo: false,
  scrollZoom: true,
} as const;

function axisTitle(label: string, unit: string): string {
  return unit ? `${label} (${unit})` : label;
}

function SignalPreviewPlot({ result }: { result: SignalPreviewResult }) {
  const data = result.data;
  const theme = usePlotlyTheme();
  const trace = useMemo(() => {
    const reduced = reduceSignalForPlot(data.x, data.y, { width: 900 });
    const style = getCurveStyle(0, 1.5);
    const fragment = buildCurveTrace(
      reduced.x,
      reduced.y,
      style.color,
      style.width,
      style.dash,
    );
    return {
      ...fragment,
      x: fragment.x ?? reduced.x,
      y: fragment.y ?? reduced.y,
      name: data.title,
      showlegend: false,
    };
  }, [data]);
  return (
    <Plot
      data={[trace as Data]}
      layout={{
        ...theme,
        autosize: true,
        uirevision: `${data.id}:${data.size}`,
        title: { text: data.title },
        margin: { l: 58, r: 22, t: 42, b: 48 },
        xaxis: {
          ...theme.xaxis,
          title: { text: axisTitle(data.xlabel, data.xunit) },
        },
        yaxis: {
          ...theme.yaxis,
          title: { text: axisTitle(data.ylabel, data.yunit) },
        },
      }}
      config={PLOT_CONFIG}
      style={PLOT_STYLE}
      useResizeHandler
    />
  );
}

function ImagePreviewPlot({ result }: { result: ImagePreviewResult }) {
  const data = result.data;
  const theme = usePlotlyTheme();
  const safeLut = useMemo<[number, number]>(() => {
    const lut = data.lut_default ?? [data.data_min, data.data_max];
    return lut[0] === lut[1] ? [lut[0] - 0.5, lut[1] + 0.5] : [lut[0], lut[1]];
  }, [data.data_max, data.data_min, data.lut_default]);
  const colormap = data.colormap ?? "Viridis";
  const colorscale = useMemo(
    () => buildColorscale(colormap, data.invert_colormap ?? false),
    [colormap, data.invert_colormap],
  );
  const raster = useMemo(() => {
    if (data.is_uniform_coords === false || typeof document === "undefined") {
      return null;
    }
    return rasterizeImage({
      rows: data.data,
      geometry: {
        width: data.width,
        height: data.height,
        x0: data.x0,
        y0: data.y0,
        dx: data.dx,
        dy: data.dy,
      },
      view: null,
      plotPx: { w: 900, h: 560 },
      dpr: window.devicePixelRatio || 1,
      lut: safeLut,
      colormap,
      inverted: data.invert_colormap ?? false,
      resampleMethod: normalizeResampleMethod(data.resample_method),
    });
  }, [colormap, data, safeLut]);
  const nonUniform = data.is_uniform_coords === false;
  const traces = nonUniform
    ? [
        {
          type: "heatmap" as const,
          z: data.data,
          x: toBins(data.xcoords ?? []),
          y: toBins(data.ycoords ?? []),
          zmin: safeLut[0],
          zmax: safeLut[1],
          colorscale: colorscale as unknown as "Viridis",
          hoverinfo: "skip" as const,
          showscale: true,
        },
      ]
    : [
        {
          type: "scatter" as const,
          x: [null],
          y: [null],
          mode: "markers" as const,
          hoverinfo: "skip" as const,
          showlegend: false,
          marker: {
            color: [safeLut[0]],
            colorscale: colorscale as unknown as "Viridis",
            cmin: safeLut[0],
            cmax: safeLut[1],
            showscale: true,
            opacity: 0,
          },
        },
      ];
  const xEnd = data.x0 + data.width * data.dx;
  const yEnd = data.y0 + data.height * data.dy;
  const images =
    raster && !nonUniform
      ? [
          {
            source: raster.source,
            xref: "x" as const,
            yref: "y" as const,
            x: raster.placement.x0,
            y: raster.placement.y0,
            sizex: raster.placement.cw * raster.placement.dx,
            sizey: raster.placement.ch * raster.placement.dy,
            xanchor: "left" as const,
            yanchor: "top" as const,
            sizing: "stretch" as const,
            layer: "below" as const,
          },
        ]
      : [];
  return (
    <Plot
      data={traces as Data[]}
      layout={{
        ...theme,
        autosize: true,
        uirevision: `${data.id}:${data.width}:${data.height}`,
        title: { text: data.title },
        margin: { l: 58, r: 56, t: 42, b: 48 },
        images,
        xaxis: {
          ...theme.xaxis,
          title: { text: axisTitle(data.xlabel, data.xunit) },
          range: nonUniform ? undefined : [data.x0, xEnd],
          autorange: nonUniform ? true : false,
        },
        yaxis: {
          ...theme.yaxis,
          title: { text: axisTitle(data.ylabel, data.yunit) },
          range: nonUniform ? undefined : [yEnd, data.y0],
          autorange: nonUniform ? "reversed" : false,
        },
      }}
      config={PLOT_CONFIG}
      style={PLOT_STYLE}
      useResizeHandler
    />
  );
}

export default function ProcessingPreviewPlot({ result }: Props) {
  return result.kind === "signal" ? (
    <SignalPreviewPlot result={result} />
  ) : (
    <ImagePreviewPlot result={result} />
  );
}
