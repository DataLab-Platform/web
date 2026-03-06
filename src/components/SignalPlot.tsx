import { useMemo } from "react";
import Plot from "react-plotly.js";
import type { SignalData } from "../sigima/runtime";

interface Props {
  data: SignalData;
}

export function SignalPlot({ data }: Props) {
  const xAxisTitle = useMemo(
    () => formatAxis(data.xlabel || "X", data.xunit),
    [data.xlabel, data.xunit],
  );
  const yAxisTitle = useMemo(
    () => formatAxis(data.ylabel || "Y", data.yunit),
    [data.ylabel, data.yunit],
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
      }}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      config={{ responsive: true, displaylogo: false }}
    />
  );
}

function formatAxis(label: string, unit: string): string {
  return unit ? `${label} (${unit})` : label;
}
