import { useMemo } from "react";
import Plot from "react-plotly.js";
import type { Data } from "plotly.js";

import type { PluginInstrumentFrame } from "../runtime/runtime";
import { buildCurveTrace, getCurveStyle } from "../runtime/plotStyles";
import { usePlotlyTheme } from "../utils/plotlyTheme";
import { reduceSignalForPlot } from "../utils/signalLod";
import ProcessingPreviewPlot from "./ProcessingPreviewPlot";

interface Props {
  frame: PluginInstrumentFrame;
  /** Keeps the user's zoom from one live frame to the next. */
  revision: string;
}

const PLOT_STYLE = { width: "100%", height: "100%" } as const;
const PLOT_CONFIG = {
  responsive: true,
  displaylogo: false,
  scrollZoom: true,
} as const;

function axisTitle(label: string, unit: string): string {
  return unit ? `${label} (${unit})` : label;
}

function SignalsPlot({
  frame,
  revision,
}: Props & { frame: Extract<PluginInstrumentFrame, { kind: "signals" }> }) {
  const theme = usePlotlyTheme();
  const traces = useMemo(
    () =>
      frame.items.map((data, index) => {
        const reduced = reduceSignalForPlot(data.x, data.y, { width: 900 });
        const style = getCurveStyle(index, 1.5);
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
        };
      }),
    [frame.items],
  );
  const first = frame.items[0];
  const range = frame.value_range;
  return (
    <Plot
      data={traces as Data[]}
      layout={{
        ...theme,
        autosize: true,
        uirevision: revision,
        showlegend: frame.items.length > 1,
        legend: { orientation: "h", x: 0, y: 1.08 },
        margin: { l: 58, r: 22, t: 30, b: 48 },
        xaxis: {
          ...theme.xaxis,
          title: { text: axisTitle(first.xlabel, first.xunit) },
        },
        yaxis: {
          ...theme.yaxis,
          title: { text: axisTitle(first.ylabel, first.yunit) },
          ...(range ? { range: [range[0], range[1]], autorange: false } : {}),
        },
      }}
      config={PLOT_CONFIG}
      style={PLOT_STYLE}
      useResizeHandler
    />
  );
}

/** Live view of an instrument window: signals drawn together, or an image. */
export default function InstrumentPlot({ frame, revision }: Props) {
  if (frame.kind === "signals") {
    return <SignalsPlot frame={frame} revision={revision} />;
  }
  const image = frame.items[0];
  return (
    <ProcessingPreviewPlot
      result={{
        kind: "image",
        data: frame.value_range
          ? { ...image, lut_default: frame.value_range }
          : image,
      }}
    />
  );
}
