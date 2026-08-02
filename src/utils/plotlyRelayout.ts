import type { ViewRange } from "./imageLod";

type PlotlyModule = typeof import("plotly.js-dist-min");
type PlotlyImport = PlotlyModule & { default?: PlotlyModule };

let plotlyPromise: Promise<PlotlyModule> | null = null;

function loadPlotly() {
  plotlyPromise ??= import("plotly.js-dist-min").then((module) => {
    const imported = module as PlotlyImport;
    return imported.default ?? imported;
  });
  return plotlyPromise;
}

/** Apply a visible axis range directly without rerendering the React owner. */
export function relayoutViewRange(
  graphDiv: HTMLElement,
  range: ViewRange,
): void {
  void loadPlotly()
    .then((Plotly) => {
      if (!graphDiv.isConnected) return;
      return Plotly.relayout(
        graphDiv as never,
        {
          "xaxis.range": range.x,
          "yaxis.range": range.y,
        } as never,
      );
    })
    .catch((error: unknown) => {
      if (graphDiv.isConnected) {
        console.error("Failed to update Plotly view range:", error);
      }
    });
}
