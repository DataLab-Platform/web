import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import { registerActivePlot } from "../aiassistant/plotCapture";
import { usePlotlyTheme } from "../utils/plotlyTheme";
import { hexToRgba, roiLineColor } from "../runtime/plotStyles";
import { buildRoiOverlays, parsePolygonPath } from "./imageRoi";
import { buildResultAnnotationBox } from "./resultBox";
import { useTheme } from "../utils/theme";
import { t } from "../i18n/translate";
import {
  COLORMAP_CATEGORIES,
  buildColorscale,
  colormapLabel,
  paintImageWindow,
} from "../utils/colormap";
import {
  type ImageGeometry,
  type ResampleMethod,
  type ViewRange,
  aspectFitRanges,
  rasterPlan,
  shouldUseLod,
  visibleWindow,
  windowPlacement,
} from "../utils/imageLod";
import { toBins, binSearchCell } from "../utils/imageCoords";
import { usePersistedBool, IMAGE_GRID_PREF_KEY } from "../utils/persisted";
import type {
  AnalysisResult,
  GeometryAnalysisResult,
  ImageData,
  ImageRoiSegment,
} from "../runtime/runtime";

/** Pure-visualization tools available in the image viewer toolbar. */
type ImageTool = "profiles" | "contrast" | "stats" | null;

/** Localised label for a colormap category.  The ``t("…")`` calls use
 *  literals so the i18n extractor picks them up automatically; the
 *  category strings themselves come from the generated colormap data. */
function colormapCategoryLabel(label: string): string {
  switch (label) {
    case "Perceptually uniform":
      return t("Perceptually uniform");
    case "Sequential":
      return t("Sequential");
    case "Diverging":
      return t("Diverging");
    case "Cyclic":
      return t("Cyclic");
    case "Qualitative":
      return t("Qualitative");
    case "Miscellaneous":
      return t("Miscellaneous");
    default:
      return label;
  }
}

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
  /** When set (and ``roiEditMode`` is on), arms the matching graphical draw
   *  tool (rectangle / circle / polygon) so a ROI can be traced immediately
   *  without picking a modebar button. */
  drawGeometry?: "segment" | "rectangle" | "circle" | "polygon" | null;
  /** Polygon vertex to emphasise on the plot while its coordinate cell is
   *  being edited in the ROI panel (``null`` ⇒ none). */
  highlightedVertex?: { roiIndex: number; vertexIndex: number } | null;
  /** Analysis results (centroid, peaks, blobs, …) drawn as overlays. */
  results?: AnalysisResult[];
  /** When true, append a paper-coords summary annotation listing
   *  TableAnalysisResult values in the top-right corner. Defaults
   *  to ``false`` since the right-hand Results panel already shows
   *  the same numbers in a structured grid. */
  showResultsOverlay?: boolean;
  /** When true (default), draw textual labels on ROI shapes and on
   *  geometry analysis results.  Wired to View > "Show graphical
   *  object titles". */
  showGraphicalTitles?: boolean;
  /** Optional LUT range override ``[zmin, zmax]``. When ``null``/omitted,
   *  the heatmap falls back to the image's intrinsic ``data_min``/
   *  ``data_max``. Driven by the contrast tool. */
  lutRange?: [number, number] | null;
  /** Called when the user commits a new LUT range from the contrast
   *  panel (slider release / Auto button). ``null`` clears the override. */
  onLutRangeChange?: (range: [number, number] | null) => void;
  /** Called when the user picks a new colormap or toggles the invert
   *  checkbox in the toolbar.  The new (name, inverted) pair should be
   *  persisted on the image object so it survives panel switches. */
  onColormapChange?: (name: string, inverted: boolean) => void;
  /** Called when the user picks a new display resampling method in the
   *  toolbar.  Persisted on the image object so it survives panel
   *  switches.  Only affects the downsampled display bitmap. */
  onResampleChange?: (method: ResampleMethod) => void;
  /** Called when the user clicks one of the "extract profile" buttons next
   *  to a frozen cross-section preview.  ``direction`` selects the horizontal
   *  (top preview, fixed ``row``) or vertical (right preview, fixed ``col``)
   *  slice.  The host wires this to the Sigima ``line_profile`` feature so a
   *  new signal is created, mirroring DataLab desktop's "Process signal". */
  onExtractProfile?: (params: {
    direction: "horizontal" | "vertical";
    row: number;
    col: number;
  }) => void;
}

/**
 * Read-only image viewer using Plotly.js's ``heatmap`` trace.
 *
 * Mirrors DataLab desktop's image plot defaults: equal axes (1 px = 1 px),
 * top-left origin (Y axis reversed), and the same default ``viridis``
 * colormap (overridable via the image's ``colormap`` metadata).  Pixel
 * coordinates respect the image's ``x0`` / ``y0`` / ``dx`` / ``dy``
 * metadata.  Optional overlays:
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
  drawGeometry = null,
  highlightedVertex = null,
  results = [],
  showResultsOverlay = false,
  showGraphicalTitles = true,
  lutRange = null,
  onLutRangeChange,
  onColormapChange,
  onResampleChange,
  onExtractProfile,
}: ImagePlotProps) {
  const plotlyTheme = usePlotlyTheme();
  // ------------------------------------------------------------------
  // Tool state machine — mutually exclusive; ROI edit mode wins.
  // ------------------------------------------------------------------
  const [tool, setTool] = useState<ImageTool>(null);
  useEffect(() => {
    if (roiEditMode && tool !== null) setTool(null);
  }, [roiEditMode, tool]);

  // Reset transient tool state when the underlying image changes.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  // When ``frozen`` is true the crosshair / profiles stop following the mouse
  // and stay pinned at the last cursor position (toggled by clicking the
  // image in profiles mode), mirroring DataLab desktop's placed cross-section
  // marker.  Only meaningful while the profiles tool is active.
  const [frozen, setFrozen] = useState(false);
  // Leaving the profiles tool always unfreezes so the next activation starts
  // in the live-tracking state.
  useEffect(() => {
    if (tool !== "profiles" && frozen) setFrozen(false);
  }, [tool, frozen]);
  const [statsRect, setStatsRect] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  // Local LUT range while the user is dragging contrast sliders. Committed
  // to ``onLutRangeChange`` only on slider release / Auto / panel close.
  const [draftLut, setDraftLut] = useState<[number, number] | null>(null);
  // Local colormap state, initialised from the image's metadata and
  // resync'd whenever it changes upstream (e.g. after switching images).
  // Names are normalised to lowercase so the controlled <select> value
  // matches its (lowercase) options regardless of metadata casing.
  const [colormapName, setColormapName] = useState<string>(
    (data.colormap || "viridis").toLowerCase(),
  );
  const [colormapInverted, setColormapInverted] = useState<boolean>(
    Boolean(data.invert_colormap),
  );
  useEffect(() => {
    setColormapName((data.colormap || "viridis").toLowerCase());
    setColormapInverted(Boolean(data.invert_colormap));
  }, [data.id, data.colormap, data.invert_colormap]);
  // Display resampling method (downsampled large images only). Resync'd
  // from metadata when the image changes.
  const [resampleMethod, setResampleMethod] = useState<ResampleMethod>(
    normalizeResample(data.resample_method),
  );
  useEffect(() => {
    setResampleMethod(normalizeResample(data.resample_method));
  }, [data.id, data.resample_method]);
  useEffect(() => {
    setCursor(null);
    setStatsRect(null);
    setDraftLut(null);
    setFrozen(false);
  }, [data.id]);

  const effectiveLut: [number, number] = useMemo(() => {
    if (draftLut) return draftLut;
    if (lutRange) return lutRange;
    return [data.data_min, data.data_max];
  }, [draftLut, lutRange, data.data_min, data.data_max]);

  // ------------------------------------------------------------------
  // Non-uniform images carry explicit per-column / per-row pixel-center
  // coordinates instead of a regular ``x0``/``dx`` grid.  They are rendered
  // exactly (matching desktop PlotPy ``XYImageItem``) via a Plotly ``heatmap``
  // trace fed with *bin edges* — the cell boundaries — rather than through the
  // uniform image-trace + canvas pipeline (which can only stretch a regular
  // pixel grid linearly and would quantise the coordinates).
  // ------------------------------------------------------------------
  const isUniform = data.is_uniform_coords !== false;
  const xEdges = useMemo(
    () => (isUniform || !data.xcoords?.length ? null : toBins(data.xcoords)),
    [isUniform, data.xcoords],
  );
  const yEdges = useMemo(
    () => (isUniform || !data.ycoords?.length ? null : toBins(data.ycoords)),
    [isUniform, data.ycoords],
  );
  // Physical extent of the image, used for axis ranges and crosshairs.
  // For non-uniform images it spans the first/last bin edges; for uniform
  // images it is the regular ``x0 + width·dx`` rectangle.
  const extent = useMemo(() => {
    if (xEdges && yEdges && xEdges.length > 1 && yEdges.length > 1) {
      return {
        xMin: xEdges[0],
        xMax: xEdges[xEdges.length - 1],
        yMin: yEdges[0],
        yMax: yEdges[yEdges.length - 1],
      };
    }
    return {
      xMin: data.x0,
      xMax: data.x0 + data.width * data.dx,
      yMin: data.y0,
      yMax: data.y0 + data.height * data.dy,
    };
  }, [
    xEdges,
    yEdges,
    data.x0,
    data.y0,
    data.width,
    data.height,
    data.dx,
    data.dy,
  ]);

  // ------------------------------------------------------------------
  // Canvas rasterisation pipeline.
  //
  // Plotly's ``heatmap`` trace renders each cell through SVG/Canvas2D
  // primitives, which scales poorly past ~10⁶ cells (a 2048×2048
  // image freezes the UI for several seconds on every relayout).
  // Instead we colormap the pixels into an offscreen ``<canvas>`` —
  // O(W·H) tight loop, ~30–80 ms on 2048² — encode the result as a
  // blob, and hand the resulting URL to a Plotly ``image`` trace as
  // its ``source``.  The image trace rasterises in a single
  // ``drawImage`` call, so pan/zoom/relayout cost a few milliseconds
  // independent of resolution.
  //
  // We re-rasterise only when the data, LUT or colormap actually
  // change (``useEffect`` dependency list).  The colorbar is rendered
  // by a separate hidden ``scatter`` trace whose ``marker.colorscale``
  // is sampled from the same LUT (see ``buildColorscale``) so it
  // matches the canvas exactly — even for colormaps Plotly does not
  // know natively.
  //
  // Plotly's ``image`` trace requires a *data URL* for ``source``
  // (``blob:`` URLs are rejected by its loader).  We therefore use
  // ``canvas.toDataURL`` rather than ``toBlob`` + ``createObjectURL``.
  //
  // Level-of-detail (LOD): for large images we rasterise only the
  // *visible window* at *display resolution* (see ``imageLod.ts``).
  // A 4096² image zoomed out to a 900-px viewport produces a ~900²
  // bitmap instead of a 4096² one — an ~20× smaller canvas + PNG —
  // while a zoom to a few pixels rasterises them 1:1 (crisp, exact).
  // Profiles / stats / hover always read the full-resolution
  // ``data.data``; only this display bitmap is decimated.
  // ------------------------------------------------------------------
  // Current axis ranges (raw Plotly arrays: X ascending, Y reversed) and
  // on-screen plot-area size, both used to size the LOD raster. ``null``
  // view = full extent (fresh image / double-click reset).
  const [viewRange, setViewRange] = useState<ViewRange | null>(null);
  // User-selected modebar drag mode ("zoom" / "pan"). Echoed back into the
  // layout so a re-render never resets it to the default. ``null`` ⇒ Plotly
  // default ("zoom"). Reset when the image changes.
  const [userDragmode, setUserDragmode] = useState<"zoom" | "pan" | null>(null);
  // "Show grid over the image" toggle (off by default — matching DataLab
  // desktop — since the bitmap is a ``layout.images`` background drawn below
  // the grid).  Persisted so it applies across images and the spatial view.
  const [showGrid, setShowGrid] = usePersistedBool(IMAGE_GRID_PREF_KEY, false);
  const [plotPx, setPlotPx] = useState<{ w: number; h: number }>({
    w: 1024,
    h: 1024,
  });
  const plotPxRef = useRef(plotPx);
  // Physical placement of the (possibly windowed) bitmap, plus its pixel
  // dimensions (``cw``/``ch``) so it can be sized as a ``layout.images``
  // background image. ``null`` falls back to the full-image geometry.
  const [bitmapPlacement, setBitmapPlacement] = useState<{
    x0: number;
    dx: number;
    y0: number;
    dy: number;
    cw: number;
    ch: number;
  } | null>(null);
  // Reset the view whenever the underlying image changes so a new image
  // opens at full extent.
  useEffect(() => {
    setViewRange(null);
    setUserDragmode(null);
  }, [data.id]);

  // Displayed axis ranges with square image pixels.  The uniform-image bitmap
  // is drawn as a ``layout.images`` background (no axis constraint), so we
  // aspect-fit the desired window (``viewRange`` or the full extent) into the
  // current plot-area pixel size ourselves.  Both axes stay independently
  // pan-/zoom-able while pixels remain square.  Used by both the layout and
  // the LOD raster so the bitmap matches the view.
  const displayRange = useMemo(() => {
    const winX: [number, number] = viewRange
      ? viewRange.x
      : [extent.xMin, extent.xMax];
    const winY: [number, number] = viewRange
      ? viewRange.y
      : [extent.yMax, extent.yMin];
    const scaleratio = isUniform ? data.dy / data.dx : 1;
    return aspectFitRanges(winX, winY, plotPx, scaleratio);
  }, [viewRange, extent, isUniform, data.dx, data.dy, plotPx]);
  const [bitmapUrl, setBitmapUrl] = useState<string | null>(null);
  useEffect(() => {
    // Non-uniform images are rendered by a ``heatmap`` trace (see below),
    // not the canvas bitmap — skip the rasterisation entirely.
    if (data.is_uniform_coords === false) {
      setBitmapUrl(null);
      setBitmapPlacement(null);
      return;
    }
    const w = data.width;
    const h = data.height;
    if (w <= 0 || h <= 0) return;
    const geom: ImageGeometry = {
      width: w,
      height: h,
      x0: data.x0,
      y0: data.y0,
      dx: data.dx,
      dy: data.dy,
    };
    const useLod = shouldUseLod(w, h);
    const win = useLod
      ? visibleWindow(geom, displayRange)
      : { i0: 0, i1: w, j0: 0, j1: h };
    const dpr = window.devicePixelRatio || 1;
    const plan = useLod
      ? rasterPlan(win, plotPx.w, plotPx.h, dpr)
      : { i0: 0, j0: 0, cw: w, ch: h, strideX: 1, strideY: 1 };
    const rows = data.data as ArrayLike<ArrayLike<number>>;
    // Debounce the heavy raster: rapid pan/zoom re-runs this effect and
    // clears the pending timeout, so we only encode the final view.
    const handle = window.setTimeout(() => {
      const canvas = document.createElement("canvas");
      canvas.width = plan.cw;
      canvas.height = plan.ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const img = paintImageWindow(
        ctx,
        rows,
        w,
        h,
        plan,
        effectiveLut[0],
        effectiveLut[1],
        colormapName,
        colormapInverted,
        resampleMethod,
      );
      ctx.putImageData(img, 0, 0);
      setBitmapUrl(canvas.toDataURL("image/png"));
      setBitmapPlacement({
        ...windowPlacement(plan, geom),
        cw: plan.cw,
        ch: plan.ch,
      });
    }, RASTER_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [
    data.id,
    data.data,
    data.width,
    data.height,
    data.x0,
    data.y0,
    data.dx,
    data.dy,
    data.is_uniform_coords,
    effectiveLut,
    colormapName,
    colormapInverted,
    resampleMethod,
    displayRange,
    plotPx,
  ]);

  // Precomputed colorscale shared by the colorbar trace; matches the
  // canvas LUT bit-for-bit.
  const plotlyColorscale = useMemo(
    () => buildColorscale(colormapName, colormapInverted),
    [colormapName, colormapInverted],
  );

  // Live reference to the Plotly graph div, used by the custom hover
  // handler to convert pixel coordinates to data coordinates without
  // depending on Plotly's hover events (which the ``image`` trace
  // does not emit when ``hoverinfo`` is ``"skip"``).
  const gdRef = useRef<
    | (HTMLElement & {
        _fullLayout?: {
          xaxis?: {
            p2c: (px: number) => number;
            _offset?: number;
            _length?: number;
            range?: [number, number];
          };
          yaxis?: {
            p2c: (px: number) => number;
            _offset?: number;
            _length?: number;
            range?: [number, number];
          };
        };
      })
    | null
  >(null);
  // Hover state for the custom tooltip and the profiles tool.
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    z: number;
    px: number;
    py: number;
  } | null>(null);
  useEffect(() => {
    setHoverInfo(null);
  }, [data.id]);

  // Read the on-screen plot-area size (in CSS px) from Plotly's resolved
  // layout so the LOD raster targets the actual display resolution. Only
  // updates state on a material change to avoid re-render churn.
  const readPlotPx = useCallback((gd: typeof gdRef.current) => {
    const fl = gd?._fullLayout;
    const w = fl?.xaxis?._length;
    const h = fl?.yaxis?._length;
    if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) {
      const prev = plotPxRef.current;
      if (Math.abs(prev.w - w) > 2 || Math.abs(prev.h - h) > 2) {
        plotPxRef.current = { w, h };
        setPlotPx({ w, h });
      }
    }
  }, []);

  const traces = useMemo(() => {
    // Background image trace — rasterised by Plotly with a single
    // ``drawImage`` from the blob URL.  When ``bitmapUrl`` is still
    // null (first paint or in-flight repaint) we omit the trace so
    // only the axes/shapes layer is shown.
    const out: unknown[] = [];
    // ------------------------------------------------------------------
    // Non-uniform images: exact ``heatmap`` rendering with bin edges.
    //
    // Feeding ``x``/``y`` arrays one longer than ``z``'s dimensions makes
    // Plotly treat them as cell boundaries, so each variable-width cell is
    // drawn vectorially at its true physical coordinates (no quantisation).
    // The trace carries its own colorbar — the hidden-scatter trick used by
    // the uniform path is not needed here.  Hover is still served by our
    // custom tooltip (``hoverinfo: "skip"``) for UI parity and to look ``z``
    // up in the original array.
    // ------------------------------------------------------------------
    if (xEdges && yEdges) {
      out.push({
        type: "heatmap" as const,
        z: data.data,
        x: xEdges,
        y: yEdges,
        zmin: effectiveLut[0],
        zmax: effectiveLut[1],
        colorscale: plotlyColorscale as unknown as "Viridis",
        hoverinfo: "skip" as const,
        colorbar: {
          title: {
            text: data.zunit ? `${data.zlabel} (${data.zunit})` : data.zlabel,
          },
          thickness: 12,
        },
      });
      return out;
    }
    // Uniform images: the canvas bitmap is drawn as a ``layout.images``
    // background (see ``layout`` below) rather than an ``image`` trace, so
    // Plotly does not force a ``scaleanchor`` constraint on the axes (which
    // would make vertical pan impossible).  Only the hidden colorbar scatter
    // is a real trace here.
    // Hidden scatter trace whose sole purpose is to render the
    // colorbar.  ``marker.colorscale`` is sampled from the same LUT
    // as ``paintImageData`` so the bar and the image stay in sync,
    // including for colormaps Plotly does not know natively (Hot,
    // approximate Viridis/Plasma/…).
    out.push({
      type: "scatter" as const,
      x: [null],
      y: [null],
      mode: "markers" as const,
      hoverinfo: "skip" as const,
      showlegend: false,
      marker: {
        color: [effectiveLut[0]],
        colorscale: plotlyColorscale as unknown as "Viridis",
        cmin: effectiveLut[0],
        cmax: effectiveLut[1],
        showscale: true,
        opacity: 0,
        colorbar: {
          title: {
            text: data.zunit ? `${data.zlabel} (${data.zunit})` : data.zlabel,
          },
          thickness: 12,
        },
      },
    });
    return out;
  }, [
    xEdges,
    yEdges,
    data.data,
    data.zlabel,
    data.zunit,
    effectiveLut,
    plotlyColorscale,
  ]);

  const { roiShapes, roiAnnotations: rawRoiAnnotations } = useMemo(
    () => buildRoiOverlays(roi, roiEditMode),
    [roi, roiEditMode],
  );
  // ROI titles are dropped when the user disabled them via the View
  // menu; the colored shapes themselves stay visible.
  const roiAnnotations = useMemo(
    () => (showGraphicalTitles ? rawRoiAnnotations : []),
    [rawRoiAnnotations, showGraphicalTitles],
  );

  const { resultShapes, resultAnnotations, resultTraces } = useMemo(
    () => buildImageGeometryOverlays(results, showGraphicalTitles),
    [results, showGraphicalTitles],
  );
  // Top-right paper-coords summary box for TableAnalysisResult rows
  // (centroid, blob coordinates, peak positions, …).  Mirrors
  // PlotPy's "computing results" annotation in DataLab desktop.
  const { theme } = useTheme();
  const { annotations: resultBoxAnnotations } = useMemo(
    () =>
      showResultsOverlay
        ? buildResultAnnotationBox(results, { dark: theme === "dark" })
        : { annotations: [] },
    [results, theme, showResultsOverlay],
  );

  // Crosshair shapes (profiles tool) and stats rectangle shape.
  const toolShapes = useMemo(() => {
    const shapes: unknown[] = [];
    if (tool === "profiles" && cursor) {
      const xMin = extent.xMin;
      const xMax = extent.xMax;
      const yMin = extent.yMin;
      const yMax = extent.yMax;
      // Pinned crosshair is drawn solid (and slightly thicker) so the user
      // can tell at a glance that the profiles no longer follow the mouse.
      const crossLine = frozen
        ? { color: CROSSHAIR_COLOR, width: 1.5, dash: "solid" }
        : { color: CROSSHAIR_COLOR, width: 1, dash: "dot" };
      shapes.push({
        type: "line",
        xref: "x",
        yref: "y",
        x0: cursor.x,
        x1: cursor.x,
        y0: yMin,
        y1: yMax,
        line: crossLine,
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
        line: crossLine,
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
  }, [tool, cursor, statsRect, extent, frozen]);

  // Bright marker emphasising the polygon vertex whose coordinate cell is
  // being edited in the ROI panel.  Empty unless a valid vertex is targeted.
  const highlightTrace = useMemo(() => {
    if (!highlightedVertex) return [] as unknown[];
    const seg = roi[highlightedVertex.roiIndex];
    if (!seg || seg.geometry !== "polygon") return [] as unknown[];
    const pt = seg.points[highlightedVertex.vertexIndex];
    if (!pt) return [] as unknown[];
    const [x, y] = pt;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [] as unknown[];
    const color = roiLineColor(highlightedVertex.roiIndex);
    return [
      {
        type: "scatter" as const,
        x: [x],
        y: [y],
        mode: "markers" as const,
        hoverinfo: "skip" as const,
        showlegend: false,
        cliponaxis: false,
        marker: {
          symbol: "circle",
          size: 16,
          color,
          line: { color: "#ffffff", width: 2 },
        },
      },
    ];
  }, [highlightedVertex, roi]);

  const allTraces = useMemo(
    () => [...traces, ...resultTraces, ...highlightTrace],
    [traces, resultTraces, highlightTrace],
  );

  // Uniform-image bitmap drawn as a ``layout.images`` background.  Unlike the
  // ``image`` trace it replaces, a layout image imposes no axis constraint,
  // so the axes stay free and both directions can be panned (square pixels
  // are kept via the aspect-fitted ``displayRange``).  ``bitmapPlacement``
  // carries the windowed sub-bitmap origin / per-cell spacing / pixel size so
  // the (possibly decimated) LOD bitmap lands on the right physical extent.
  const layoutImages = useMemo(() => {
    if (!bitmapUrl || data.is_uniform_coords === false) return [];
    const p = bitmapPlacement ?? {
      x0: data.x0,
      dx: data.dx,
      y0: data.y0,
      dy: data.dy,
      cw: data.width,
      ch: data.height,
    };
    return [
      {
        source: bitmapUrl,
        xref: "x" as const,
        yref: "y" as const,
        x: p.x0,
        y: p.y0,
        sizex: p.cw * p.dx,
        sizey: p.ch * p.dy,
        xanchor: "left" as const,
        yanchor: "top" as const,
        sizing: "stretch" as const,
        layer: "below" as const,
      },
    ];
  }, [
    bitmapUrl,
    bitmapPlacement,
    data.is_uniform_coords,
    data.x0,
    data.y0,
    data.dx,
    data.dy,
    data.width,
    data.height,
  ]);

  const layout = useMemo(() => {
    const xtitle = data.xunit ? `${data.xlabel} (${data.xunit})` : data.xlabel;
    const ytitle = data.yunit ? `${data.ylabel} (${data.yunit})` : data.ylabel;
    // Controlled axis ranges fed back so the view sticks across re-renders
    // (react-plotly drives the plot in controlled mode and would otherwise
    // revert the user's view).  ``displayRange`` aspect-fits the desired
    // window so image pixels stay square without Plotly's ``scaleanchor``
    // (which the old ``image`` trace forced, breaking vertical pan); it also
    // sizes the windowed LOD bitmap so the decimated image matches the view.
    const xRange = displayRange.x;
    const yRange = displayRange.y;
    return {
      ...plotlyTheme,
      title: { text: data.title || "" },
      autosize: true,
      margin: {
        l: 60,
        // Reserve extra room on the right so the legend can sit past
        // the colorbar without overlapping it (only needed when there
        // are analysis results to label).
        r: resultTraces.length > 0 ? 140 : 30,
        t: 40,
        b: 50,
      },
      images: layoutImages,
      xaxis: {
        ...plotlyTheme.xaxis,
        title: { text: xtitle },
        range: xRange,
        autorange: false as const,
        // The bitmap is a ``layout.images`` background drawn *below* the grid
        // (Plotly only offers below-grid or above-all-traces for images), so a
        // visible grid sits on top of the image.  Off by default to match the
        // old ``image`` trace and DataLab desktop; toggled from the toolbar.
        showgrid: showGrid,
        zeroline: showGrid,
      },
      yaxis: {
        ...plotlyTheme.yaxis,
        title: { text: ytitle },
        range: yRange,
        autorange: false as const,
        showgrid: showGrid,
        zeroline: showGrid,
      },
      // Stats tool mirrors PlotPy's ``ImageStatsTool``: activating it
      // immediately puts the plot into rectangle-drawing mode so the user
      // can drag out a region right away (instead of having to pick the
      // ``drawrect`` modebar button first — otherwise dragging just zooms).
      // ROI edit mode does the same, honouring the geometry armed by the
      // ROI panel (rectangle / circle / polygon) so a first ROI is always
      // immediately drawable.  Otherwise we echo the user's modebar choice
      // (``userDragmode``) back into the layout so a re-render never resets
      // it to the default "zoom" mid-interaction (which used to make Pan
      // unusable — the mode flipped back the instant the view re-rendered).
      dragmode:
        roiEditMode && drawGeometry
          ? drawGeometry === "circle"
            ? ("drawcircle" as const)
            : drawGeometry === "polygon"
              ? ("drawclosedpath" as const)
              : ("drawrect" as const)
          : tool === "stats"
            ? ("drawrect" as const)
            : (userDragmode ?? undefined),
      // Legend positioned to the right of the colorbar (paper coords),
      // outside the plot area, so it never overlaps the image or the
      // colorbar. The right margin is widened above to make room.
      showlegend: resultTraces.length > 0,
      legend: {
        ...plotlyTheme.legend,
        x: 1.15,
        y: 1,
        xanchor: "left" as const,
        yanchor: "top" as const,
      },
      shapes: [...roiShapes, ...resultShapes, ...toolShapes],
      annotations: [
        ...roiAnnotations,
        ...resultAnnotations,
        ...resultBoxAnnotations,
      ],
      newshape: roiEditMode
        ? {
            line: { color: roiLineColor(roi.length), width: 2, dash: "dot" },
            fillcolor: hexToRgba(roiLineColor(roi.length), 0.1),
            opacity: 1,
          }
        : tool === "stats"
          ? {
              line: { color: STATS_COLOR, width: 2, dash: "solid" },
              fillcolor: "rgba(0,200,200,0.10)",
              opacity: 1,
            }
          : undefined,
    };
  }, [
    plotlyTheme,
    data,
    displayRange,
    layoutImages,
    userDragmode,
    showGrid,
    roiShapes,
    roiAnnotations,
    resultShapes,
    resultAnnotations,
    resultBoxAnnotations,
    resultTraces.length,
    toolShapes,
    roiEditMode,
    roi.length,
    tool,
    drawGeometry,
  ]);

  const handleHover = useCallback(
    (event: Record<string, unknown>) => {
      if (tool !== "profiles" || frozen) return;
      const points = (event as { points?: Array<Record<string, unknown>> })
        .points;
      if (!points || points.length === 0) return;
      const p = points[0];
      const x = Number(p.x);
      const y = Number(p.y);
      if (Number.isFinite(x) && Number.isFinite(y)) setCursor({ x, y });
    },
    [tool, frozen],
  );

  // ------------------------------------------------------------------
  // Custom hover handler.
  //
  // The ``image`` trace has ``hoverinfo: "skip"`` so Plotly does not
  // emit hover events for it (and could not show the original ``z``
  // value anyway — it only sees rasterised RGBA).  We listen to the
  // wrapper's mousemove, convert client pixel coords to data coords
  // through the graph-div axis helpers, then look ``z`` up directly
  // in the original ``Float32Array``.  This also drives the profiles
  // crosshair, replacing the old plotly-hover-driven path.
  // ------------------------------------------------------------------
  const handleWrapperMouseMove = useCallback(
    (evt: React.MouseEvent<HTMLDivElement>) => {
      // While a mouse button is held (zoom rubber band, manual pan, ROI
      // drag), skip the hover read-out: every ``setHoverInfo`` re-renders the
      // component and ``Plotly.react`` re-applies the layout, which disrupts
      // the in-progress gesture (box-zoom used to behave erratically).  The
      // manual pan does not need hover — it tracks the pointer itself.
      if (evt.buttons !== 0) {
        if (hoverInfo) setHoverInfo(null);
        return;
      }
      const gd = gdRef.current;
      const fl = gd?._fullLayout;
      const xa = fl?.xaxis;
      const ya = fl?.yaxis;
      if (!gd || !xa || !ya || typeof xa.p2c !== "function") return;
      const rect = gd.getBoundingClientRect();
      const px = evt.clientX - rect.left;
      const py = evt.clientY - rect.top;
      const xOff = xa._offset ?? 0;
      const yOff = ya._offset ?? 0;
      const xData = xa.p2c(px - xOff);
      const yData = ya.p2c(py - yOff);
      if (!Number.isFinite(xData) || !Number.isFinite(yData)) {
        if (hoverInfo) setHoverInfo(null);
        return;
      }
      // Map data coords → cell indices.  Uniform images use the regular
      // grid; non-uniform images binary-search the bin edges so the
      // reported ``z`` is exact (no quantisation).
      const i = xEdges
        ? binSearchCell(xEdges, xData)
        : Math.floor((xData - data.x0) / data.dx);
      const j = yEdges
        ? binSearchCell(yEdges, yData)
        : Math.floor((yData - data.y0) / data.dy);
      if (i < 0 || i >= data.width || j < 0 || j >= data.height) {
        if (hoverInfo) setHoverInfo(null);
        return;
      }
      const row = data.data[j] as Float32Array | number[];
      const z = row ? row[i] : NaN;
      setHoverInfo({ x: xData, y: yData, z, px, py });
      if (tool === "profiles" && !frozen) setCursor({ x: xData, y: yData });
    },
    [data, tool, hoverInfo, xEdges, yEdges, frozen],
  );

  const handleWrapperMouseLeave = useCallback(() => {
    setHoverInfo(null);
  }, []);

  // Click toggles the frozen crosshair while the profiles tool is active.
  // Freezing requires a current cursor position (the click point) so the
  // crosshair has somewhere to pin; unfreezing always works.
  const handleHostClick = useCallback(() => {
    if (tool !== "profiles") return;
    if (frozen) {
      setFrozen(false);
    } else if (cursor) {
      setFrozen(true);
    }
  }, [tool, frozen, cursor]);

  // ------------------------------------------------------------------
  // Manual pan (uniform images).
  //
  // The uniform-image bitmap is a ``layout.images`` background, so the axes
  // carry no constraint and can be panned in both directions.  We drive the
  // pan ourselves (rather than via Plotly's native pan) because the latter
  // mutates the axis ranges in parallel with our controlled ``displayRange``
  // and the two fight — in practice native pan moved X but reset Y.  On
  // mousedown (capture phase) we record the gesture anchor and the current
  // axis ranges and stop the event so Plotly's own pan never starts; each
  // mousemove then translates ``viewRange`` from the fixed anchor (not
  // incrementally, so there is no runaway amplification).
  // ------------------------------------------------------------------
  const panRef = useRef<{
    startX: number;
    startY: number;
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    xLen: number;
    yLen: number;
  } | null>(null);
  const handleHostMouseDownCapture = useCallback(
    (evt: React.MouseEvent<HTMLDivElement>) => {
      if (evt.button !== 0) return;
      if (userDragmode !== "pan") return;
      if (roiEditMode || tool === "stats") return;
      // We drive the pan ourselves (rather than via Plotly's native pan) for
      // BOTH uniform and non-uniform images: uniform bitmaps are a
      // ``layout.images`` background (free axes) and non-uniform images are a
      // ``heatmap`` whose native pan Plotly reverts on release (it transforms
      // the trace during the drag but the controlled ``displayRange`` snaps it
      // back).  Stop Plotly's native pan from starting (its mousedown handler
      // lives on the drag layer, a descendant) so only our manual pan runs —
      // yet keep ``dragmode: "pan"`` so the modebar button stays armed and the
      // cursor shows the grab affordance.
      evt.stopPropagation();
      evt.nativeEvent.stopImmediatePropagation();
      const gd = gdRef.current;
      const fl = gd?._fullLayout;
      const xa = fl?.xaxis;
      const ya = fl?.yaxis;
      const xr = xa?.range;
      const yr = ya?.range;
      const xLen = xa?._length;
      const yLen = ya?._length;
      if (!xr || !yr || !xLen || !yLen) return;
      panRef.current = {
        startX: evt.clientX,
        startY: evt.clientY,
        x0: xr[0],
        x1: xr[1],
        y0: yr[0],
        y1: yr[1],
        xLen,
        yLen,
      };
      const onMove = (e: MouseEvent) => {
        const p = panRef.current;
        if (!p) return;
        // Data units per CSS pixel along each axis, in its on-screen
        // increasing direction: X grows rightward (range[1]−range[0]); the
        // image Y axis is reversed so screen-down grows toward range[0]
        // (range[0]−range[1]).  "Grab" pan subtracts the dragged delta.
        const dxData = ((e.clientX - p.startX) * (p.x1 - p.x0)) / p.xLen;
        const dyData = ((e.clientY - p.startY) * (p.y0 - p.y1)) / p.yLen;
        setViewRange({
          x: [p.x0 - dxData, p.x1 - dxData],
          y: [p.y0 - dyData, p.y1 - dyData],
        });
      };
      const onUp = () => {
        panRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [userDragmode, roiEditMode, tool],
  );

  const handleRelayout = useCallback(
    (event: Record<string, unknown>, live = false) => {
      // Echo the user's modebar drag-mode choice (zoom / pan) into state so
      // the layout re-supplies it and a re-render never resets it to the
      // default mid-interaction (the old "Pan flips back to zoom" bug).
      const dm = event.dragmode;
      if (dm === "zoom" || dm === "pan") setUserDragmode(dm);
      // Capture the visible range on the *final* relayout (mouse release) so
      // the controlled axes and the LOD raster follow the user's view.  Zoom
      // is a rubber band that only changes the range on release; feeding the
      // live ``plotly_relayouting`` stream back mid-drag made box-zoom behave
      // erratically.  Uniform-image pan is handled by the manual pan handlers
      // below (we drive ``viewRange`` directly), so we ignore Plotly's pan
      // stream there; non-uniform (heatmap) images keep native pan.
      if (!live) {
        const ax0 = event["xaxis.range[0]"];
        const ax1 = event["xaxis.range[1]"];
        const ay0 = event["yaxis.range[0]"];
        const ay1 = event["yaxis.range[1]"];
        if (
          event["xaxis.autorange"] === true ||
          event["yaxis.autorange"] === true
        ) {
          setViewRange(null);
        } else if (
          // The manual pan handler owns the range while panning (both uniform
          // and non-uniform), so ignore Plotly's pan relayout there; we still
          // capture box-zoom (which only relayouts on release).
          userDragmode !== "pan" &&
          (ax0 !== undefined ||
            ax1 !== undefined ||
            ay0 !== undefined ||
            ay1 !== undefined)
        ) {
          const curX: [number, number] = displayRange.x;
          const curY: [number, number] = displayRange.y;
          const nx: [number, number] = [
            ax0 !== undefined ? Number(ax0) : curX[0],
            ax1 !== undefined ? Number(ax1) : curX[1],
          ];
          const ny: [number, number] = [
            ay0 !== undefined ? Number(ay0) : curY[0],
            ay1 !== undefined ? Number(ay1) : curY[1],
          ];
          if ([nx[0], nx[1], ny[0], ny[1]].every(Number.isFinite)) {
            setViewRange({ x: nx, y: ny });
          }
        }
      }

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
      displayRange,
      userDragmode,
    ],
  );

  // Always-fresh handle to ``handleRelayout`` for the imperatively-bound
  // ``plotly_relayouting`` listener (see ``onInitialized``), so live ROI
  // drags never call a stale closure.
  const relayoutHandlerRef = useRef(handleRelayout);
  relayoutHandlerRef.current = handleRelayout;

  // ------------------------------------------------------------------
  // Profiles
  // ------------------------------------------------------------------
  const profileData = useMemo(() => {
    if (tool !== "profiles" || !cursor) return null;
    const col = Math.round((cursor.x - data.x0) / data.dx - 0.5);
    const row = Math.round((cursor.y - data.y0) / data.dy - 0.5);
    if (col < 0 || col >= data.width || row < 0 || row >= data.height)
      return null;
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
      onInitialized={(_fig, gd) => {
        gdRef.current = gd as unknown as typeof gdRef.current;
        registerActivePlot("image", gd);
        readPlotPx(gdRef.current);
        // ``react-plotly.js`` does not type ``onRelayouting`` (the live,
        // per-frame drag event). Bind it imperatively so ROI drags update
        // the overlay/form continuously instead of only on mouse release.
        const g = gd as unknown as {
          on?: (ev: string, cb: (e: Record<string, unknown>) => void) => void;
        };
        g.on?.("plotly_relayouting", (e) =>
          relayoutHandlerRef.current(e, true),
        );
      }}
      onUpdate={(_fig, gd) => {
        gdRef.current = gd as unknown as typeof gdRef.current;
        registerActivePlot("image", gd);
        readPlotPx(gdRef.current);
      }}
      onPurge={() => {
        gdRef.current = null;
        registerActivePlot("image", null);
      }}
    />
  );

  // Custom hover tooltip — small overlay positioned next to the
  // cursor, mirroring Plotly's default look but driven by the typed
  // array lookup so we always show the original ``z`` value.
  const hoverTooltip = hoverInfo ? (
    <div
      className="image-hover-tooltip"
      style={{
        position: "absolute",
        left: hoverInfo.px + 14,
        top: hoverInfo.py + 14,
        pointerEvents: "none",
        background: "var(--plot-tooltip-bg, rgba(20,20,20,0.85))",
        color: "var(--plot-tooltip-fg, #fff)",
        padding: "4px 6px",
        borderRadius: 3,
        fontSize: 11,
        lineHeight: 1.3,
        whiteSpace: "nowrap",
        zIndex: 5,
      }}
    >
      {data.xlabel || "x"}: {fmt(hoverInfo.x)}
      <br />
      {data.ylabel || "y"}: {fmt(hoverInfo.y)}
      <br />
      {data.zlabel || "z"}: {fmt(hoverInfo.z)}
    </div>
  ) : null;

  const imagePlotEl = (
    <div
      className={`image-plot-host${
        tool === "profiles"
          ? frozen
            ? " profiles-frozen"
            : " profiles-live"
          : ""
      }`}
      style={{ position: "relative", width: "100%", height: "100%" }}
      onMouseDownCapture={handleHostMouseDownCapture}
      onMouseMove={handleWrapperMouseMove}
      onMouseLeave={handleWrapperMouseLeave}
      onClick={handleHostClick}
    >
      {heatmapPlot}
      {hoverTooltip}
    </div>
  );

  return (
    <div className={wrapperClass}>
      <ImageToolbar
        tool={tool}
        setTool={setTool}
        disabled={roiEditMode}
        colormap={colormapName}
        inverted={colormapInverted}
        onColormapChange={(name) => {
          setColormapName(name);
          onColormapChange?.(name, colormapInverted);
        }}
        onInvertChange={(inv) => {
          setColormapInverted(inv);
          onColormapChange?.(colormapName, inv);
        }}
        resample={resampleMethod}
        showResample={shouldUseLod(data.width, data.height)}
        onResampleChange={(method) => {
          setResampleMethod(method);
          onResampleChange?.(method);
        }}
        showGrid={showGrid}
        onShowGridChange={setShowGrid}
      />
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
                      ...plotlyTheme,
                      autosize: true,
                      margin: { l: 60, r: 30, t: 5, b: 5 },
                      xaxis: {
                        ...plotlyTheme.xaxis,
                        range: [data.x0, data.x0 + data.width * data.dx],
                        showticklabels: false,
                      },
                      yaxis: {
                        ...plotlyTheme.yaxis,
                        showticklabels: true,
                        automargin: true,
                      },
                      showlegend: false,
                    } as never
                  }
                  style={{ width: "100%", height: "100%" }}
                  config={{ displayModeBar: false, responsive: true } as never}
                  useResizeHandler
                />
              ) : (
                <div className="image-plot-hint">
                  {t("Hover the image to update profiles")}
                </div>
              )}
              {frozen && profileData && onExtractProfile ? (
                <button
                  type="button"
                  className="image-profile-extract"
                  title={t("Extract this horizontal profile as a new signal")}
                  onClick={() =>
                    onExtractProfile({
                      direction: "horizontal",
                      row: profileData.row,
                      col: profileData.col,
                    })
                  }
                >
                  {t("Extract")}
                </button>
              ) : null}
            </div>
            <div className="image-plot-cell image-plot-cell-corner">
              {cursor ? (
                <div className="image-profile-freeze-hint">
                  {frozen
                    ? t("Frozen — click the image to unfreeze")
                    : t("Click the image to freeze")}
                </div>
              ) : null}
            </div>
            <div className="image-plot-cell image-plot-cell-heatmap">
              {imagePlotEl}
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
                      ...plotlyTheme,
                      autosize: true,
                      margin: { l: 5, r: 5, t: 40, b: 50 },
                      xaxis: {
                        ...plotlyTheme.xaxis,
                        showticklabels: true,
                        automargin: true,
                      },
                      yaxis: {
                        ...plotlyTheme.yaxis,
                        range: [data.y0 + data.height * data.dy, data.y0],
                        showticklabels: false,
                      },
                      showlegend: false,
                    } as never
                  }
                  style={{ width: "100%", height: "100%" }}
                  config={{ displayModeBar: false, responsive: true } as never}
                  useResizeHandler
                />
              ) : null}
              {frozen && profileData && onExtractProfile ? (
                <button
                  type="button"
                  className="image-profile-extract"
                  title={t("Extract this vertical profile as a new signal")}
                  onClick={() =>
                    onExtractProfile({
                      direction: "vertical",
                      row: profileData.row,
                      col: profileData.col,
                    })
                  }
                >
                  {t("Extract")}
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          imagePlotEl
        )}
        {tool === "stats" && statsValues && (
          <div className="image-stats-overlay">
            <div className="image-stats-overlay-header">
              <strong>{t("Stats")}</strong>
              <button
                type="button"
                className="image-stats-overlay-close"
                onClick={() => setStatsRect(null)}
                aria-label={t("Clear stats area")}
                title={t("Clear stats area")}
              >
                ×
              </button>
            </div>
            <div className="image-stats-overlay-body">
              <span>
                {t("n")}: {statsValues.count}
              </span>
              <span>
                {t("mean")}: {fmt(statsValues.mean)}
              </span>
              <span>
                {t("std")}: {fmt(statsValues.std)}
              </span>
              <span>
                {t("min")}: {fmt(statsValues.min)}
              </span>
              <span>
                {t("max")}: {fmt(statsValues.max)}
              </span>
              <span>
                {t("sum")}: {fmt(statsValues.sum)}
              </span>
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
  colormap,
  inverted,
  onColormapChange,
  onInvertChange,
  resample,
  showResample,
  onResampleChange,
  showGrid,
  onShowGridChange,
}: {
  tool: ImageTool;
  setTool: (t: ImageTool) => void;
  disabled: boolean;
  colormap: string;
  inverted: boolean;
  onColormapChange: (name: string) => void;
  onInvertChange: (inverted: boolean) => void;
  resample: ResampleMethod;
  showResample: boolean;
  onResampleChange: (method: ResampleMethod) => void;
  showGrid: boolean;
  onShowGridChange: (show: boolean) => void;
}) {
  const buttons: Array<{
    id: Exclude<ImageTool, null>;
    label: string;
    title: string;
  }> = [
    {
      id: "profiles",
      label: t("Cross profiles"),
      title: t("Show X/Y intensity profiles under the cursor"),
    },
    {
      id: "contrast",
      label: t("Contrast"),
      title: t("Adjust the LUT range with a histogram and dual-handle slider"),
    },
    {
      id: "stats",
      label: t("Stats area"),
      title: t("Draw a rectangle to display statistics over a region"),
    },
  ];
  return (
    <div
      className="image-tools-toolbar"
      role="toolbar"
      aria-label={t("Image visualization tools")}
    >
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          className={`image-tools-button${tool === b.id ? " active" : ""}`}
          onClick={() => setTool(tool === b.id ? null : b.id)}
          title={
            disabled ? t("Disabled while ROI edit mode is active") : b.title
          }
          disabled={disabled}
          aria-pressed={tool === b.id}
        >
          {b.label}
        </button>
      ))}
      <span className="image-tools-separator" aria-hidden="true" />
      <label
        className="image-tools-colormap"
        title={t("Colormap (lookup table)")}
      >
        <span className="image-tools-colormap-label">{t("Colormap")}</span>
        <select
          aria-label={t("Colormap")}
          value={colormap}
          onChange={(e) => onColormapChange(e.target.value)}
        >
          {COLORMAP_CATEGORIES.map((cat) => (
            <optgroup key={cat.label} label={colormapCategoryLabel(cat.label)}>
              {cat.names.map((name) => (
                <option key={name} value={name}>
                  {colormapLabel(name)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label
        className="image-tools-invert"
        title={t("Reverse the colormap (Plotly _r suffix)")}
      >
        <input
          type="checkbox"
          checked={inverted}
          onChange={(e) => onInvertChange(e.target.checked)}
        />
        <span>{t("Invert")}</span>
      </label>
      <span className="image-tools-separator" aria-hidden="true" />
      <label
        className="image-tools-grid"
        title={t("Show a coordinate grid over the image")}
      >
        <input
          type="checkbox"
          checked={showGrid}
          onChange={(e) => onShowGridChange(e.target.checked)}
        />
        <span>{t("Grid")}</span>
      </label>
      {showResample && (
        <label
          className="image-tools-resample"
          title={t(
            "How pixels are combined when the zoomed-out view is downsampled. Profiles and statistics always use full-resolution data.",
          )}
        >
          <span className="image-tools-resample-label">{t("Resampling")}</span>
          <select
            aria-label={t("Resampling")}
            value={resample}
            onChange={(e) => onResampleChange(e.target.value as ResampleMethod)}
          >
            <option value="nearest">{t("Nearest")}</option>
            <option value="max">{t("Maximum")}</option>
            <option value="mean">{t("Average")}</option>
          </select>
        </label>
      )}
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
  const plotlyTheme = usePlotlyTheme();
  const span = Math.max(dataMax - dataMin, Number.EPSILON);
  // Slider works on a normalised 0..1000 range to allow fine control over
  // arbitrary data extents.
  const STEPS = 1000;
  const toStep = (v: number) => Math.round(((v - dataMin) / span) * STEPS);
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
              ...plotlyTheme,
              autosize: true,
              margin: { l: 40, r: 10, t: 5, b: 25 },
              height: 90,
              xaxis: { ...plotlyTheme.xaxis, range: [dataMin, dataMax] },
              yaxis: {
                ...plotlyTheme.yaxis,
                showticklabels: false,
                type: "log",
              },
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
          {t("min")}
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
          {t("max")}
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
          title={t("Reset to the image's intrinsic data range")}
        >
          {t("Auto")}
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
/** Foreground color for Plotly text (axes ticks/labels) — now provided by
 *  the per-theme helper :func:`getPlotlyThemeLayout`. */

/** Debounce (ms) before re-encoding the display bitmap on pan/zoom/LUT
 *  changes.  Short enough to feel immediate, long enough to skip the
 *  intermediate frames of a drag. */
const RASTER_DEBOUNCE_MS = 80;

/** Coerce a persisted ``resample_method`` metadata value to a valid
 *  :type:`ResampleMethod`, defaulting to ``"nearest"``. */
function normalizeResample(value: string | null | undefined): ResampleMethod {
  return value === "max" || value === "mean" ? value : "nearest";
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(3);
  return Number(v.toFixed(4)).toString();
}

function computeHistogram(
  data: ArrayLike<number>[],
  minV: number,
  maxV: number,
  bins: number,
): { centers: number[]; counts: number[] } {
  const counts = new Array<number>(bins).fill(0);
  const span = Math.max(maxV - minV, Number.EPSILON);
  for (const row of data) {
    for (let k = 0; k < row.length; k++) {
      const v = row[k];
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

// Parse a Plotly path string into an array of points.  Implemented in the
// Plotly-free ``imageRoi`` module (so it is unit-testable in JSDOM) and
// re-used here by ``shapeToRoi``.

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
    return {
      geometry: "rectangle",
      title,
      inverse,
      x0: xmin,
      y0: ymin,
      dx,
      dy,
    };
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

function buildImageGeometryOverlays(
  results: AnalysisResult[],
  showTitles = true,
): {
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
    // "Show graphical object titles" is honoured here so analysis-result
    // text overlays disappear in lockstep with ROI labels.
    resultAnnotations: showTitles ? annotations : [],
    resultTraces: traces,
  };
}
