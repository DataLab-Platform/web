type PlotlyModule = typeof import("plotly.js-dist-min");
type PlotlyImport = PlotlyModule & { default?: PlotlyModule };

let plotlyPromise: Promise<PlotlyModule> | null = null;
let reactPlotlyPromise: Promise<typeof import("react-plotly.js")> | null = null;

/** Load the imperative Plotly API once. */
export function loadPlotly(): Promise<PlotlyModule> {
  plotlyPromise ??= import("plotly.js-dist-min").then((module) => {
    const imported = module as PlotlyImport;
    return imported.default ?? imported;
  });
  return plotlyPromise;
}

/** Preload Plotly and its React adapter without blocking shell rendering. */
export async function preloadPlotly(): Promise<void> {
  reactPlotlyPromise ??= import("react-plotly.js");
  await Promise.all([loadPlotly(), reactPlotlyPromise]);
}
