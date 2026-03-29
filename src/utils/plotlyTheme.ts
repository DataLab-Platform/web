/* Plotly theming helpers — keep our Plotly widgets in sync with the
 * application's light/dark theme.
 *
 * The hook returns a partial Plotly layout object (font + axis colors +
 * transparent backgrounds) that callers spread into their own ``layout``
 * prop, e.g.::
 *
 *     const plotlyTheme = usePlotlyTheme();
 *     <Plot layout={{ ...plotlyTheme, title: ... }} />
 */
import { useTheme, type ResolvedTheme } from "./theme";

export interface PlotlyThemeLayout {
  paper_bgcolor: string;
  plot_bgcolor: string;
  font: { color: string };
  xaxis: { gridcolor: string; zerolinecolor: string; linecolor: string; tickcolor: string };
  yaxis: { gridcolor: string; zerolinecolor: string; linecolor: string; tickcolor: string };
  legend: { font: { color: string } };
}

export function getPlotlyThemeLayout(theme: ResolvedTheme): PlotlyThemeLayout {
  if (theme === "dark") {
    return {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#d4d4d4" },
      xaxis: {
        gridcolor: "#3c3c3c",
        zerolinecolor: "#5a5a5a",
        linecolor: "#858585",
        tickcolor: "#858585",
      },
      yaxis: {
        gridcolor: "#3c3c3c",
        zerolinecolor: "#5a5a5a",
        linecolor: "#858585",
        tickcolor: "#858585",
      },
      legend: { font: { color: "#d4d4d4" } },
    };
  }
  return {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#1f1f1f" },
    xaxis: {
      gridcolor: "#e0e0e0",
      zerolinecolor: "#bdbdbd",
      linecolor: "#444",
      tickcolor: "#444",
    },
    yaxis: {
      gridcolor: "#e0e0e0",
      zerolinecolor: "#bdbdbd",
      linecolor: "#444",
      tickcolor: "#444",
    },
    legend: { font: { color: "#1f1f1f" } },
  };
}

/** React hook returning Plotly layout fragments matching the active theme. */
export function usePlotlyTheme(): PlotlyThemeLayout {
  const { theme } = useTheme();
  return getPlotlyThemeLayout(theme);
}

/** Merge a per-axis theme partial with caller-supplied axis options. */
export function mergeAxis<T extends object>(
  themeAxis: PlotlyThemeLayout["xaxis"],
  axis: T,
): T & PlotlyThemeLayout["xaxis"] {
  return { ...themeAxis, ...axis };
}
