import { lazy } from "react";
import { preloadPlotly } from "../utils/plotlyLoader";

const loadSignalPlot = () => import("./SignalPlot");
const loadImagePlot = () => import("./ImagePlot");
const loadMultiImageSpatialPlot = () => import("./MultiImageSpatialPlot");

export const LazySignalPlot = lazy(() =>
  loadSignalPlot().then((module) => ({ default: module.SignalPlot })),
);
export const LazyImagePlot = lazy(() =>
  loadImagePlot().then((module) => ({ default: module.ImagePlot })),
);
export const LazyMultiImageSpatialPlot = lazy(() =>
  loadMultiImageSpatialPlot().then((module) => ({
    default: module.MultiImageSpatialPlot,
  })),
);
export const LazyProfileDefinitionDialog = lazy(() =>
  import("./ProfileDefinitionDialog").then((module) => ({
    default: module.ProfileDefinitionDialog,
  })),
);
export const LazyInteractiveFitDialog = lazy(() =>
  import("./InteractiveFitDialog").then((module) => ({
    default: module.InteractiveFitDialog,
  })),
);
export const LazyH5BrowserDialog = lazy(() =>
  import("./H5BrowserDialog").then((module) => ({
    default: module.H5BrowserDialog,
  })),
);
export const LazyRoiGridDialog = lazy(() =>
  import("./RoiGridDialog").then((module) => ({
    default: module.RoiGridDialog,
  })),
);
export const LazySeparateViewDialog = lazy(() =>
  import("./SeparateViewDialog").then((module) => ({
    default: module.SeparateViewDialog,
  })),
);
export const LazySignalAxisGroupsDialog = lazy(() =>
  import("./SignalAxisGroupsDialog").then((module) => ({
    default: module.SignalAxisGroupsDialog,
  })),
);

/** Warm the plotting path while Pyodide initializes. */
export async function preloadPrimaryPlots(): Promise<void> {
  await Promise.all([
    preloadPlotly(),
    loadSignalPlot(),
    loadImagePlot(),
    loadMultiImageSpatialPlot(),
  ]);
}
