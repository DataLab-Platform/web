/**
 * Pyodide loader for DataLab-Web.
 *
 * This module owns the single Pyodide instance and the Sigima Python
 * namespace.  All calls into Python go through a tiny typed wrapper so the
 * rest of the codebase never touches the Pyodide API directly.
 */

import bootstrapSource from "./bootstrap.py?raw";
import processorSource from "./processor.py?raw";
import dlwMainSource from "./dlw_main.py?raw";
import dlwPluginsSource from "./dlw_plugins.py?raw";
import dlwH5BrowserSource from "./dlw_h5browser.py?raw";
import dlwInteractiveFitSource from "./dlw_interactive_fit.py?raw";
import dlwMacroLintSource from "./dlw_macro_lint.py?raw";
import macroProxySource from "./macro_proxy.py?raw";
// Tiny module that installs Sigima's ``PlaceholderTitleFormatter`` as the
// default; pushed into every Pyodide instance (main runtime + workers)
// so processed objects carry the same placeholder titles (later resolved
// to source ``oid``s by ``bootstrap.patch_title_with_ids``).
import dlwTitleFormatSource from "./dlw_title_format.py?raw";
// Until the released ``guidata`` ships the new JSON Schema helpers, we
// pre-load a copy of ``guidata/dataset/jsonschema.py`` and let it
// monkey-patch the ``guidata.dataset`` namespace.
import guidataJsonSchemaShim from "./_guidata_jsonschema_shim.py?raw";
// Resolve the Pyodide ``LANG`` from the active UI locale so that
// Sigima/guidata gettext labels match the rest of the interface. Import
// from the React-free ``locale`` module to avoid pulling the provider in.
import { pyodideLang } from "../i18n/locale";
import { t } from "../i18n/translate";
import {
  readWasmHeapBytes,
  readJsMemory,
  type MemoryUsage,
  type PyodideModuleLike,
} from "../utils/memory";
import { OpfsObjectStore } from "../storage/opfsObjectStore";
import type { ObjectByteStore } from "../storage/opfsObjectStore";
import { OpfsSyncObjectStore } from "../storage/opfsSyncObjectStore";
// Default set of packages whose installed versions are worth surfacing for
// diagnostics and the shim version audit (see ``shims/registry.ts``).
import { PACKAGE_VERSION_SOURCES } from "./shims/registry";

// Re-export the structural runtime contract so consumers can keep their
// existing ``from "../runtime/runtime"`` import path while depending on
// the interface (``RuntimeApi``) instead of the concrete class — the
// decoupling that lets a worker-backed implementation be swapped in later.
export type { RuntimeApi } from "./RuntimeApi";

// Bundle the portable ``datalab.*`` shim package — every .py file under
// src/sigima/dlplugins/ is mirrored to Pyodide's site-packages at startup
// so plugins can ``from datalab.plugins import PluginBase`` unmodified.
const shimSources = import.meta.glob("./dlplugins/**/*.py", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const builtinPluginSources = import.meta.glob("./builtin_plugins/*.py", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Bundle pluggable backend file from local guidata working tree
// (Phase 0 patches that aren't yet in a released wheel). Loaded after
// ``micropip install guidata`` and applied as monkey-patch.
const guidataBackendsSource = (() => {
  const candidates = import.meta.glob("./_guidata_backends_shim.py", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
  const first = Object.values(candidates)[0];
  return first ?? null;
})();

// Pyodide is loaded from a CDN <script> tag in index.html; the
// ``window.loadPyodide`` global is declared in
// ``src/types/pyodide-global.d.ts`` (shared with the bench).

export interface PyodideAPI {
  runPythonAsync: (code: string) => Promise<unknown>;
  loadPackage: (names: string | string[]) => Promise<void>;
  globals: {
    get: (name: string) => PyProxy | undefined;
  };
  FS: {
    writeFile: (path: string, data: string | Uint8Array) => void;
    mkdirTree?: (path: string) => void;
  };
  /** Emscripten module backing the WASM heap. Used by
   *  {@link DataLabRuntime.getMemoryUsage} to read the linear-heap size
   *  (``_module.HEAPU8.length``) for the memory indicator. */
  _module?: PyodideModuleLike;
  // Pyodide exposes more, but the MVP only needs the above.
}

export interface PyProxy {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callKwargs?: (...args: any[]) => unknown;
  toJs?: (opts?: {
    dict_converter?: (entries: Iterable<[unknown, unknown]>) => unknown;
  }) => unknown;
  destroy?: () => void;
}

const PYODIDE_VERSION = "v0.26.4";
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;

export interface SignalMeta {
  id: string;
  uuid: string | null;
  title: string;
  size: number;
  xlabel: string;
  ylabel: string;
  xunit: string;
  yunit: string;
}

/** Optional per-curve style read from PlotPy/Sigima metadata.  Honoured
 *  by :class:`SignalPlot` when overlaying multiple signals; falls back
 *  to the auto-cycling palette when fields are absent. */
export interface SignalStyle {
  color: string | null;
  /** PlotPy linestyle name (``SolidLine``, ``DashLine`` …) or Plotly
   *  ``line.dash`` value — :func:`plotlyDash` normalises both. */
  linestyle: string | null;
  linewidth: number | null;
  /** PlotPy curve display mode (``Lines``, ``Sticks``, ``Steps``,
   *  ``Dots``, ``NoCurve``) — :func:`normalizeCurveStyle` normalises. */
  curvestyle: string | null;
}

export interface SignalData extends SignalMeta {
  x: number[];
  y: number[];
  style?: SignalStyle;
}

export interface ProcessingDescriptor {
  id: string;
  label: string;
  has_params: boolean;
}

/** Snapshot returned by ``get_last_processing(oid)``: identifies the
 *  feature that produced *oid* and exposes its (optional) parameter
 *  schema with the values used in the latest invocation. */
export interface LastProcessingInfo {
  feature_id: string;
  label: string;
  menu_path: string;
  source_ids: string[];
  operand_id: string | null;
  has_params: boolean;
  schema: SchemaWithValues["schema"] | null;
  values: Record<string, unknown> | null;
}

export type Pattern = "1_to_1" | "2_to_1" | "n_to_1";

export interface FeatureDescriptor {
  id: string;
  label: string;
  menu_path: string;
  pattern: Pattern;
  icon: string | null;
  has_params: boolean;
  operand_label: string;
  object_kind: PanelKind;
  /** Destination panel for results.  Equals ``object_kind`` for the vast
   *  majority of features; differs for cross-kind features such as image
   *  profiles / projections / histogram (image → signal) and
   *  ``signals_to_image`` (signal → image). */
  output_kind: PanelKind;
}

/** One entry of the "Processing > Fitting > Interactive fitting" submenu. */
export interface InteractiveFitInfo {
  id: string;
  label: string;
  /** ``polynomial_fit`` exposes a ``degree`` extra; everything else is
   *  parameterless. */
  needs_degree: boolean;
}

/** One adjustable parameter of an interactive fit (slider row). */
export interface InteractiveFitParam {
  name: string;
  /** Pretty label for display (Greek letters etc.). */
  label: string;
  value: number;
  min: number;
  max: number;
}

/** Payload returned by :meth:`DataLabRuntime.initInteractiveFit`. */
export interface InteractiveFitInit {
  fit_id: string;
  label: string;
  /** Source signal X / Y arrays (full range). */
  x: number[];
  y: number[];
  /** X / Y restricted to the active ROI (== full range when no ROI). */
  x_roi: number[];
  y_roi: number[];
  params: InteractiveFitParam[];
  /** Fit evaluated on the full X axis with the initial parameters. */
  y_fit: number[];
  needs_degree: boolean;
  extras: Record<string, unknown>;
}

/** Payload returned by :meth:`DataLabRuntime.autoFitInteractive`. */
export interface InteractiveFitAuto {
  values: Record<string, number>;
  y_fit: number[];
  residual_rms: number;
}

export interface PluginInfoMeta {
  name: string;
  version: string;
  description: string;
  icon: string | null;
}

export interface PluginRecord {
  name: string;
  filename: string;
  module: string;
  enabled: boolean;
  loaded: boolean;
  error: string | null;
  info: PluginInfoMeta | null;
}

export interface PluginMenuAction {
  action_id: string;
  title: string;
  menu_path: string[];
  select_condition: string;
  separator_before: boolean;
  icon: string | null;
  tip: string | null;
  origin: string | null;
  object_kind: PanelKind;
}

export type PanelKind = "signal" | "image";

export interface ObjectNode extends SignalMeta {
  kind: PanelKind;
}

export interface GroupNode {
  gid: string;
  name: string;
  objects: ObjectNode[];
}

export interface PanelTree {
  kind: PanelKind;
  groups: GroupNode[];
}

/** Editable metadata fields of a signal object (Phase 4). */
export interface ObjectMeta {
  title: string;
  xlabel: string;
  ylabel: string;
  xunit: string;
  yunit: string;
}

/** Plotly shapes/annotations payload persisted alongside a signal. */
export interface PlotlyAnnotations {
  shapes: unknown[];
  annotations: unknown[];
}

/** A single ROI segment on a 1D signal (Phase 5). */
export interface SignalRoiSegment {
  xmin: number;
  xmax: number;
  title?: string;
}

/** A single ROI on a 2D image — discriminated union by ``geometry``.
 *  All coordinates are physical (matching the image's ``x0``/``y0``/
 *  ``dx``/``dy``).  ``inverse`` flips the masking logic (default false). */
export type ImageRoiSegment =
  | {
      geometry: "rectangle";
      title?: string;
      inverse?: boolean;
      x0: number;
      y0: number;
      dx: number;
      dy: number;
    }
  | {
      geometry: "circle";
      title?: string;
      inverse?: boolean;
      xc: number;
      yc: number;
      r: number;
    }
  | {
      geometry: "polygon";
      title?: string;
      inverse?: boolean;
      points: [number, number][];
    };

/** Image data payload returned by ``get_image_data``. */
export interface ImageData {
  id: string;
  title: string;
  width: number;
  height: number;
  /** Pixel grid.  When the runtime requests ``encoding="bytes"``
   *  (the default for the front-end), this is an array of
   *  ``Float32Array`` rows, one per image line.  Plotly accepts
   *  typed-array rows directly as ``z``. */
  data: Float32Array[] | number[][];
  dtype: string;
  /** Pixel origin (top-left corner) and pixel spacing. */
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  /** ``false`` for images carrying explicit per-column / per-row pixel-center
   *  coordinates (``xcoords``/``ycoords``).  When ``false``, ``x0``/``dx`` are
   *  meaningless and the viewer must render variable-width cells from the
   *  coordinate arrays.  Defaults to uniform when omitted. */
  is_uniform_coords?: boolean;
  /** Per-column pixel-center X coordinates (non-uniform images only). */
  xcoords?: number[];
  /** Per-row pixel-center Y coordinates (non-uniform images only). */
  ycoords?: number[];
  /** Pre-computed extrema, used to seed the LUT range. */
  data_min: number;
  data_max: number;
  xlabel: string;
  ylabel: string;
  zlabel: string;
  xunit: string;
  yunit: string;
  zunit: string;
  /** Optional Plotly colorscale name persisted in the image's metadata
   *  (``"Viridis"``, ``"Jet"``, ``"Gray"`` …).  When ``null``, the
   *  viewer falls back to the :class:`ImagePlot` default. */
  colormap?: string | null;
  /** Reverse the colormap (appends ``_r`` to the Plotly colorscale). */
  invert_colormap?: boolean;
  /** Resampling method used when the viewer downsamples the display
   *  bitmap (large images zoomed out): ``"nearest"`` (decimation,
   *  default), ``"max"`` (preserve hot pixels) or ``"mean"`` (smooth).
   *  Persisted in the image's metadata; never affects profiles /
   *  statistics, which always read full-resolution data. */
  resample_method?: string | null;
}

/** Legacy synthetic image parameters (kept for backwards compatibility). */
export interface ImageCreationParams {
  kind: "gauss" | "ramp" | "random";
  title: string;
  width: number;
  height: number;
  a?: number;
  sigma?: number;
}

/** One entry of the image "Create" menu, mirrors :class:`SignalCreationType`. */
export interface ImageCreationType {
  value: string;
  label: string;
  icon: string;
  separator_before: boolean;
}

/** Diagnostic info returned by ``openWorkspaceHdf5``. */
export interface WorkspaceLoadResult {
  signals: number;
  images: number;
  groups: number;
}

/** Parameters of the Text Import Wizard (mirrors
 *  :class:`datalab.widgets.textimport.SignalImportParam`). */
export interface TextImportParams {
  delimiter: string;
  decimal: string;
  comment: string;
  skipRows: number;
  maxRows: number | null;
  /** ``"infer"`` (auto), ``"none"`` (no header) or ``"first"`` (first row). */
  header: "infer" | "none" | "first";
  transpose: boolean;
  firstColIsX: boolean;
  dtypeStr: string;
}

/** Preview payload returned by :meth:`DataLabRuntime.parseTextImport`. */
export interface TextImportPreview {
  headers: string[];
  /** First N rows of the parsed matrix; NaN cells are encoded as
   *  ``"NaN"`` strings. */
  preview_rows: (number | string)[][];
  nrows: number;
  ncols: number;
  /** Candidate signal titles (after applying ``firstColIsX``). */
  signal_titles: string[];
  error: string | null;
}

/** Candidate-signal payload for the wizard's graphical preview page. */
export interface TextImportSignal {
  title: string;
  x: number[];
  y: number[];
  xlabel: string;
  ylabel: string;
}

export interface TextImportSignals {
  signals: TextImportSignal[];
  error: string | null;
}

/** Final wizard payload (selection + shared labels). */
export interface TextImportCommitOptions {
  selectedIndices: number[];
  title?: string;
  xlabel?: string;
  ylabel?: string;
  xunit?: string;
  yunit?: string;
  groupId?: string | null;
}

/** Default parameters for the Text Import Wizard. */
export function defaultTextImportParams(): TextImportParams {
  return {
    delimiter: ",",
    decimal: ".",
    comment: "#",
    skipRows: 0,
    maxRows: null,
    header: "infer",
    transpose: false,
    firstColIsX: true,
    dtypeStr: "float64",
  };
}

/** Convert a TextImportParams object to bootstrap.py kwargs. */
export function textImportToPyKwargs(
  params: TextImportParams,
): Record<string, unknown> {
  return {
    delimiter: params.delimiter,
    decimal: params.decimal,
    comment: params.comment,
    skip_rows: params.skipRows,
    max_rows: params.maxRows,
    header: params.header,
    transpose: params.transpose,
    first_col_is_x: params.firstColIsX,
    dtype_str: params.dtypeStr,
  };
}

/** One node of the HDF5 browser tree (mirrors Qt H5TreeWidget rows). */
export interface H5BrowserNode {
  id: string;
  name: string;
  icon_name: string;
  shape_str: string;
  dtype_str: string;
  text: string;
  description: string;
  is_supported: boolean;
  is_array: boolean;
  is_group: boolean;
  /** ``"group" | "scalar" | "text" | "array" | "compound" | "signal" | "image"``. */
  kind: string;
  children: H5BrowserNode[];
}

/** Result of opening one HDF5 file in the browser dialog. */
export interface H5BrowserFile {
  file_id: string;
  filename: string;
  root: H5BrowserNode;
}

/** Attributes pane payload for one selected node. */
export interface H5BrowserNodeAttrs {
  path: string;
  name: string;
  description: string;
  text_preview: string;
  attributes: Record<string, unknown>;
}

/** Preview data for the right-side Plotly pane. */
export type H5BrowserPreview =
  | { kind: "unsupported"; error?: string }
  | { kind: "signal"; title: string; x: number[]; y: number[] }
  | {
      kind: "image";
      title: string;
      width: number;
      height: number;
      data: number[][];
    };

/** Raw array payload for the "Show array" spreadsheet view. */
export interface H5BrowserArray {
  shape: number[];
  dtype: string;
  data: unknown;
}

/** Result of importing selected HDF5 nodes into the live model. */
export interface H5BrowserImportResult {
  oids: string[];
  uint32_clipped: boolean;
}

/**
 * JSON Schema 2020-12 document augmented with ``x-guidata-*`` extensions,
 * as produced by :func:`guidata.dataset.dataset_to_schema`.
 *
 * Treated as a loose dictionary on the JS side: each frontend widget
 * inspects only the keys it cares about. The shape is documented in
 * ``guidata/dataset/jsonschema.py``.
 */
export type JsonSchema = Record<string, unknown>;

export interface SchemaWithValues {
  schema: JsonSchema;
  values: Record<string, unknown>;
}

export interface DynamicChoice {
  value: unknown;
  label: string;
  icon?: string;
}

/** Read-only stats summary returned by
 *  :meth:`DataLabRuntime.getObjectStats`. */
export type ObjectStats =
  | {
      kind: "signal";
      n_points: number;
      x_dtype: string;
      y_dtype: string;
      x_min: number | null;
      x_max: number | null;
      y_min: number | null;
      y_max: number | null;
      y_mean: number | null;
      y_std: number | null;
      y_median: number | null;
    }
  | {
      kind: "image";
      shape: number[];
      dtype: string;
      min: number | null;
      max: number | null;
      mean: number | null;
      std: number | null;
      median: number | null;
    };

/** Discriminator for the metadata-editor widgets. */
export type MetadataValueType = "string" | "number" | "bool" | "json";

/** One row of the metadata editor (returned by
 *  :meth:`DataLabRuntime.listObjectMetadata`). */
export interface MetadataEntry {
  key: string;
  value_type: MetadataValueType;
  value: string;
}

/** One entry of the "Create" menu, returned by
 *  :meth:`DataLabRuntime.listSignalCreationTypes`. */
export interface SignalCreationType {
  /** Stable id (matches a ``SignalTypes`` enum value on the Python side). */
  value: string;
  /** Translated, human-readable label. */
  label: string;
  /** Bare SVG filename (e.g. ``"sine.svg"``) — the React UI maps it to a
   *  bundled URL via Vite's ``import.meta.glob``. */
  icon: string;
  /** When true, draw a separator *before* this entry in the menu (mirrors
   *  the desktop "Create" menu's grouping). */
  separator_before: boolean;
}

/** One I/O format descriptor returned by
 *  :meth:`DataLabRuntime.listSignalIoFormats`. */
export interface SignalIoFormat {
  name: string;
  extensions: string[];
}

export interface SignalIoFormats {
  read: SignalIoFormat[];
  write: SignalIoFormat[];
  all_read_extensions: string[];
  all_write_extensions: string[];
}

/** Image I/O catalogue — identical shape to :class:`SignalIoFormats`. */
export type ImageIoFormats = SignalIoFormats;

/** Menu descriptor for one entry of the "Analysis" menu. */
export interface SignalAnalysisDescriptor {
  /** Stable id (e.g. ``"fwhm"``).  Matches the Sigima function name. */
  id: string;
  label: string;
  /** Bare SVG filename or ``""`` for icon-less entries. */
  icon: string;
  /** Insert a separator above this entry (mirrors DataLab desktop). */
  separator_before: boolean;
  /** ``true`` when the analysis exposes a parameter DataSet. */
  has_params: boolean;
  /** Optional submenu (folder) this entry belongs to, e.g. ``"Blob
   *  detection"``; ``null``/absent for top-level Analysis entries. */
  submenu?: string | null;
}

/** Optional plot overlay attached to a result (currently only emitted
 *  by pulse-features tables — segments for baselines/plateau and
 *  vertical markers for x₀ / x₅₀ / x₁₀₀). */
export type AnalysisOverlay =
  | {
      kind: "segment";
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      label?: string;
      color?: string;
    }
  | { kind: "vline"; x: number; label?: string; color?: string }
  | { kind: "hline"; y: number; label?: string; color?: string };

/** Per-row geometry / table payload (one of two ``category`` values). */
export interface AnalysisResultBase {
  metadata_key: string;
  title: string;
  func_name: string | null;
  headers: string[];
  roi_indices: number[] | null;
  /** Optional plot overlays (segments, vlines) supplementing the
   *  numerical result.  Currently emitted for pulse-features tables. */
  overlays?: AnalysisOverlay[];
  /** Set by image detection analyses (peak / blob / hough / contour) when
   *  the ``create_rois`` parameter caused fresh ROIs to be attached to
   *  the source object.  The UI uses this flag to refresh the ROI overlay
   *  without re-fetching everything. */
  roi_modified?: boolean;
}

export interface GeometryAnalysisResult extends AnalysisResultBase {
  category: "geometry";
  /** ``"point" | "marker" | "segment" | "rectangle" | "circle" | "ellipse" | "polygon"``. */
  kind: string;
  /** N×K array of physical coordinates (K depends on ``kind``). */
  coords: number[][];
}

export interface TableAnalysisResult extends AnalysisResultBase {
  category: "table";
  kind: string;
  data: (number | string | null)[][];
}

export type AnalysisResult = GeometryAnalysisResult | TableAnalysisResult;

/** One plottable analysis-result category, returned by
 *  :meth:`DataLabRuntime.getPlotResultsSchemas`.  Describes the data the
 *  "Plot results" dialog needs to let the user pick X/Y columns. */
export interface PlotResultsSchemaEntry {
  /** Result category key (e.g. ``"fwhm"`` or ``"shape_circle"``). */
  category: string;
  /** Result kind value (e.g. ``"fwhm"``, ``"circle"``). */
  kind: string;
  /** ``true`` for geometry results, ``false`` for table results. */
  is_geometry: boolean;
  /** Human-readable result title (Sigima-localised). */
  label: string;
  /** Numeric column names selectable for the X / Y axes. */
  numeric_headers: string[];
  /** Default plot kind (``"one_curve_per_object"`` when any result holds
   *  more than one row, otherwise ``"one_curve_per_title"``). */
  default_kind: "one_curve_per_object" | "one_curve_per_title";
}

export interface SignalCreationParams {
  kind: "sine" | "cosine" | "gauss" | "noise";
  title: string;
  size: number;
  xmin: number;
  xmax: number;
  a?: number;
  freq?: number;
  phase?: number;
  mu?: number;
  sigma?: number;
}

/** Lightweight macro entry returned by ``listMacros`` (no code). */
export interface MacroMeta {
  id: string;
  title: string;
}

/** Full macro record (with source code). */
export interface MacroRecord extends MacroMeta {
  code: string;
}

/** One issue or proxy call reported by :meth:`DataLabRuntime.lintMacro`. */
export interface MacroLintLocation {
  name: string;
  line: number;
  col: number;
}

export interface MacroLintProxyCall extends MacroLintLocation {
  awaited: boolean;
  is_async: boolean;
}

/** Result of statically linting a macro source. */
export interface MacroLintResult {
  ok: boolean;
  syntax_error: { line: number; col: number; message: string } | null;
  unknown_methods: MacroLintLocation[];
  missing_await: MacroLintLocation[];
  proxy_calls: MacroLintProxyCall[];
}

/** Lightweight notebook entry returned by ``listNotebooks`` (no content). */
export interface NotebookMeta {
  id: string;
  title: string;
}

/** Full notebook record (with raw nbformat v4.5 JSON content). */
export interface NotebookRecord extends NotebookMeta {
  /** Serialised nbformat v4.5 JSON document (opaque to Python). */
  content: string;
}

/** Convert a PyProxy result into a plain JS value (recursively). */
function toJs(value: unknown): unknown {
  if (value && typeof value === "object" && "toJs" in value) {
    const proxy = value as PyProxy;
    const result = proxy.toJs?.({
      dict_converter: (entries) =>
        Object.fromEntries(entries as Iterable<[string, unknown]>),
    });
    proxy.destroy?.();
    return result;
  }
  return value;
}

/**
 * Reshape a flat ``Float32`` byte buffer into a list of typed-array
 * rows that Plotly's ``heatmap`` trace consumes directly as ``z``.
 *
 * When the Python helper was asked to encode the image as bytes it
 * returns ``data`` either as a :class:`Uint8Array` (Pyodide's default
 * for ``bytes``) or as a memoryview-like object exposing a ``buffer``.
 * Either way we end up with ``H`` rows of ``W`` floats with zero
 * structural copies — only the typed-array views are allocated.
 *
 * Inputs already in the legacy ``number[][]`` form (Python tests, the
 * notebook display path) are returned unchanged.
 */
function decodeImagePayload<
  T extends { encoding?: string; data: unknown; width: number; height: number },
>(payload: T): T {
  if (payload.encoding !== "f32") return payload;
  const raw = payload.data as ArrayBufferView | ArrayBuffer;
  const view =
    raw instanceof ArrayBuffer
      ? new Float32Array(raw)
      : new Float32Array(
          raw.buffer,
          raw.byteOffset,
          raw.byteLength / Float32Array.BYTES_PER_ELEMENT,
        );
  const w = payload.width;
  const h = payload.height;
  const rows: Float32Array[] = new Array(h);
  for (let j = 0; j < h; j += 1) {
    // ``subarray`` shares the underlying buffer — no per-row copy.
    rows[j] = view.subarray(j * w, (j + 1) * w);
  }
  return { ...payload, data: rows };
}

/** Outcome of {@link DataLabRuntime.freeMemory}. */
export interface FreeMemoryResult {
  /** Unreachable objects reclaimed by ``gc.collect``. */
  collected: number;
  /** Tracked Python objects before the collection pass. */
  objects_before: number;
  /** Tracked Python objects after the collection pass. */
  objects_after: number;
  /** WASM heap size (bytes) before collection, or ``null`` if unknown. */
  wasmBefore: number | null;
  /** WASM heap size (bytes) after collection, or ``null`` if unknown. */
  wasmAfter: number | null;
}

/**
 * Runtime storage mode.
 *
 * ``"ram"`` (default) keeps every signal/image array resident in the
 * Pyodide WASM heap — fastest, but the working set is capped by the
 * ~2 GB wasm32 ceiling. ``"disk"`` spills each object's heavy array to
 * the Origin Private File System and pages it back in only for the
 * duration of the call that needs it, so the heap stays flat and the
 * dataset is bounded by disk quota instead of RAM.
 */
export type StorageMode = "ram" | "disk";

/** Pyodide loader signature — ``window.loadPyodide`` or, in a worker, a
 *  dynamic-``import()`` wrapper around the ESM Pyodide build. */
export type PyodideLoader = (opts: { indexURL: string }) => Promise<unknown>;

/**
 * Options for {@link DataLabRuntime.load}.
 *
 * All fields are optional and default to the historical main-thread
 * behaviour, so existing callers (``DataLabRuntime.load(onProgress)``) are
 * unaffected. They exist so the same boot sequence can run inside a
 * Dedicated Web Worker, where there is no ``window``/DOM: the worker injects
 * a Pyodide ``loader`` and the locale-derived values that the DOM-less
 * ``i18n`` layer cannot compute on its own.
 */
export interface RuntimeLoadOptions {
  /** Pyodide loader; defaults to ``window.loadPyodide``. */
  loadPyodide?: PyodideLoader;
  /** ``LANG`` for the Pyodide environment; defaults to ``pyodideLang()``. */
  lang?: string;
  /** Default object/group labels pushed into ``bootstrap.py``; default to
   *  ``t("Group")`` / ``t("Untitled")`` (English in a DOM-less worker). */
  labels?: { group: string; untitled: string };
}

export class DataLabRuntime {
  private constructor(private readonly py: PyodideAPI) {}

  /**
   * Workspace mutation tracker.
   *
   * The set below lists every ``bootstrap.py`` callable that mutates
   * the durable workspace state — i.e. anything whose effect is
   * persisted by ``save_workspace_to_bytes`` and would be lost on
   * reload unless saved as an HDF5 workspace. ``callPy`` invokes all
   * registered mutation listeners after each successful call to one
   * of these functions, so the React layer can flip a single
   * "workspace dirty" flag without sprinkling ``markDirty()`` at
   * every UI call site.
   *
   * Keep this list narrow on purpose: read-only helpers
   * (``list_*``, ``get_*``, schema queries, IO format probes) must
   * NOT appear here. ``open_workspace_from_bytes`` and
   * ``save_workspace_to_bytes`` are intentionally absent — they're
   * the *clean* transitions, handled separately in ``App.tsx``.
   */
  private static readonly MUTATING_PY_FUNCTIONS: ReadonlySet<string> =
    new Set<string>([
      // Object model — signals & images
      "create_signal",
      "create_signal_typed",
      "create_image",
      "create_image_typed",
      "add_signal_from_arrays",
      "add_image_from_array",
      "set_signal_style",
      "update_signal_creation_params",
      "update_image_creation_params",
      "set_object_property_values",
      "set_object_metadata_value",
      "delete_object_metadata_key",
      "paste_object_metadata",
      "add_object_metadata",
      "delete_object_metadata",
      "import_object_metadata_bytes",
      "set_object_meta",
      "set_signal_roi",
      "delete_signal_roi_at",
      "set_image_roi",
      "delete_image_roi_at",
      "create_image_roi_grid",
      "extract_signal_rois",
      "extract_image_rois",
      "delete_object",
      "delete_all_objects",
      "delete_signal",
      "rename_object",
      "move_object",
      "move_objects",
      "create_group",
      "rename_group",
      "delete_group",
      "set_plotly_annotations",
      "set_lut_range",
      "set_colormap",
      "clear_signal_results",
      "clear_image_results",
      "erase_image_area",
      "distribute_images_on_grid",
      "reset_image_positions",
      "apply_feature",
      "apply_processing",
      "reapply_last_processing",
      "run_signal_analysis",
      "run_image_analysis",
      "open_signal_from_bytes",
      "open_image_from_bytes",
      "open_from_directory_chunk",
      "import_signal_csv",
      "commit_text_import",
      "add_object_pickled",
      "set_object_pickled",
      "reset_all",
      // Macros
      "create_macro",
      "rename_macro",
      "delete_macro",
      "set_macro_code",
      "duplicate_macro",
      "reorder_macros",
      "replace_macros",
      // Notebooks
      "create_notebook",
      "rename_notebook",
      "delete_notebook",
      "set_notebook_content",
      "duplicate_notebook",
      "reorder_notebooks",
      "replace_notebooks",
    ]);

  private mutationListeners: Set<(name: string) => void> = new Set();

  /**
   * Subscribe to durable-workspace mutations. The callback fires *after*
   * any ``callPy`` invocation that mutates the workspace state.
   *
   * Returns an unsubscribe function. Listeners must not throw (errors
   * are logged and otherwise ignored to keep the runtime queue clean).
   */
  onWorkspaceMutation(listener: (name: string) => void): () => void {
    this.mutationListeners.add(listener);
    return () => {
      this.mutationListeners.delete(listener);
    };
  }

  private emitWorkspaceMutation(name: string): void {
    if (this.mutationListeners.size === 0) return;
    for (const cb of this.mutationListeners) {
      try {
        cb(name);
      } catch (err) {
        console.warn("[runtime] workspace-mutation listener threw", err);
      }
    }
  }

  static async load(
    onProgress?: (msg: string) => void,
    opts: RuntimeLoadOptions = {},
  ): Promise<DataLabRuntime> {
    // The Pyodide loader is injectable so the runtime can boot both on the
    // main thread (where ``window.loadPyodide`` is provided by the
    // index.html <script>) and inside a Dedicated Web Worker (where the
    // ``kernelWorker`` passes a dynamic-``import()`` loader for the ESM
    // Pyodide build — there is no ``window`` there). Default preserves the
    // historical main-thread behaviour exactly.
    const loadPyodide =
      opts.loadPyodide ??
      (typeof window !== "undefined" ? window.loadPyodide : undefined);
    if (typeof loadPyodide !== "function") {
      throw new Error(
        "Pyodide failed to load from the CDN. Check the browser console " +
          "and your network / Content-Security-Policy settings.",
      );
    }
    onProgress?.(t("Loading Pyodide runtime…"));
    const py = (await loadPyodide({
      indexURL: PYODIDE_INDEX,
    })) as PyodideAPI;

    // ---------------------------------------------------------------
    // Pin the Pyodide locale *before* any ``guidata`` / ``sigima``
    // import.
    //
    // Why: Sigima exposes user-facing labels (e.g. ``SignalTypes`` /
    // ``ImageTypes`` enum entries shown in the ``Create`` menu, plus
    // processing labels and parameter labels) wrapped in ``gettext
    // _()``. ``guidata.configtools.get_translation`` reads
    // ``os.environ["LANG"]`` and loads the matching ``.mo`` catalog
    // (shipped inside the Sigima/guidata wheels) at first import.
    //
    // We derive ``LANG`` from the active UI locale via
    // ``pyodideLang()``: ``C`` for English (POSIX "no translation",
    // returns the original ``msgid`` strings), or the locale code (e.g.
    // ``fr``) to surface the translated catalog — keeping the Python
    // labels consistent with the React UI. Switching language reloads
    // the page, so a fresh Pyodide instance always boots with the right
    // ``LANG``.
    //
    // This MUST run before ``loadPackage``/``micropip.install`` of
    // ``guidata`` and before any ``runPythonAsync`` that touches the
    // guidata shims, otherwise the translation object is cached at
    // import time and the language change comes too late.
    // ---------------------------------------------------------------
    const lang = opts.lang ?? pyodideLang();
    await py.runPythonAsync(`
import os
os.environ["LANG"] = ${JSON.stringify(lang)}
os.environ["LANGUAGE"] = ${JSON.stringify(lang)}
`);

    onProgress?.(t("Loading scientific stack (numpy, scipy, h5py)…"));
    await py.loadPackage(["numpy", "scipy", "h5py", "micropip"]);

    onProgress?.(t("Installing Sigima…"));
    await py.runPythonAsync(`
import micropip
await micropip.install(["sigima", "guidata"])
`);

    onProgress?.(t("Initialising Sigima namespace…"));
    await py.runPythonAsync(guidataJsonSchemaShim);
    if (guidataBackendsSource) {
      await py.runPythonAsync(guidataBackendsSource);
    }
    // Mirror the portable ``datalab.*`` shim into Pyodide site-packages.
    DataLabRuntime.installShim(py, shimSources);
    // Make ``processor.py``/``dlw_main.py``/``dlw_plugins.py`` importable.
    py.FS.writeFile("/home/pyodide/dlw_processor.py", processorSource);
    py.FS.writeFile("/home/pyodide/dlw_main.py", dlwMainSource);
    py.FS.writeFile("/home/pyodide/dlw_plugins.py", dlwPluginsSource);
    py.FS.writeFile("/home/pyodide/dlw_h5browser.py", dlwH5BrowserSource);
    py.FS.writeFile(
      "/home/pyodide/dlw_interactive_fit.py",
      dlwInteractiveFitSource,
    );
    py.FS.writeFile("/home/pyodide/dlw_title_format.py", dlwTitleFormatSource);
    // ``macro_proxy.py`` is normally only loaded into worker Pyodides,
    // but the main instance needs the source so :mod:`dlw_macro_lint`
    // can introspect the ``_Proxy`` API surface.
    py.FS.writeFile("/home/pyodide/macro_proxy.py", macroProxySource);
    py.FS.writeFile("/home/pyodide/dlw_macro_lint.py", dlwMacroLintSource);
    await py.runPythonAsync(bootstrapSource);

    // Bridge DataLab-Web's own (non-gettext) default labels into Python:
    // the "Group" prefix for auto-created groups and the "Untitled" macro
    // /notebook title. Sigima/guidata labels are translated via gettext
    // (``LANG`` above), but ``bootstrap.py`` is our own code, so the React
    // side owns these translations and pushes them in here. In worker mode
    // the DOM-less ``t()`` falls back to English, so the labels are passed
    // in explicitly (computed on the main thread) to keep i18n correct.
    const groupLabel = opts.labels?.group ?? t("Group");
    const untitledLabel = opts.labels?.untitled ?? t("Untitled");
    await py.runPythonAsync(
      `set_default_labels(${JSON.stringify(groupLabel)}, ${JSON.stringify(
        untitledLabel,
      )})`,
    );

    onProgress?.(t("Ready."));
    const runtime = new DataLabRuntime(py);
    runtime.installDialogBridge();
    await runtime.installBuiltinPlugins(builtinPluginSources);
    return runtime;
  }

  /**
   * Mirror the portable ``datalab.*`` shim into Pyodide's site-packages.
   *
   * Each entry in *sources* is keyed by the workspace-relative path
   * (``./dlplugins/datalab/plugins.py``); we strip the leading
   * ``./dlplugins/`` and write to ``/home/pyodide/<rest>``.
   */
  private static installShim(
    py: PyodideAPI,
    sources: Record<string, string>,
  ): void {
    const seenDirs = new Set<string>();
    for (const [path, source] of Object.entries(sources)) {
      const rel = path.replace(/^\.\/dlplugins\//, "");
      const target = `/home/pyodide/${rel}`;
      const dir = target.slice(0, target.lastIndexOf("/"));
      if (!seenDirs.has(dir)) {
        py.FS.mkdirTree?.(dir);
        seenDirs.add(dir);
      }
      py.FS.writeFile(target, source);
    }
  }

  /** Install the JS callback that Python uses for async dialogs. */
  private installDialogBridge(): void {
    const handler = async (kind: unknown, payload: unknown) => {
      const fn = this.dialogHandler;
      if (fn === null) {
        throw new Error(
          `Dialog requested (${String(kind)}) but no handler is registered. ` +
            "Call sigima.setDialogHandler(...) on the JS side first.",
        );
      }
      // Python side converts dict payloads to plain JS objects via
      // ``pyodide.ffi.to_js`` before calling us, so ``payload`` is normally
      // a JS object already.  Keep the legacy ``toJs`` fallback for safety
      // (e.g. if a Python caller forgets the conversion), but never call
      // ``destroy()`` on the proxy: Pyodide registers it with its own
      // ``FinalizationRegistry`` after the awaited call resolves, and an
      // explicit early destroy would race with that registration and abort
      // the WASM runtime ("Object has already been destroyed").
      const proxy = payload as PyProxy | null | undefined;
      let data: unknown = payload;
      if (typeof proxy?.toJs === "function") {
        data = proxy.toJs({
          dict_converter: (entries) =>
            Object.fromEntries(entries as Iterable<[string, unknown]>),
        });
      }
      return fn(String(kind), data);
    };
    const setBridge = this.py.globals.get("set_dialog_bridge");
    if (setBridge) {
      try {
        // Pyodide auto-wraps JS functions into PyProxy callables.
        (setBridge as unknown as (cb: typeof handler) => void)(handler);
      } finally {
        setBridge.destroy?.();
      }
    }
  }

  /** JS-side callback invoked for every async dialog request from Python. */
  private dialogHandler:
    | ((kind: string, payload: unknown) => Promise<unknown>)
    | null = null;

  setDialogHandler(
    handler: ((kind: string, payload: unknown) => Promise<unknown>) | null,
  ): void {
    this.dialogHandler = handler;
  }

  /** Evaluate ``display.active`` for the dataset currently shown by the
   *  bridge ``edit_dataset`` dialog (macros / plugins / remote control /
   *  interactive flows). Returns ``{itemName: boolean}`` so the bridge form
   *  greys out widgets whose enabling condition is unmet, mirroring the Qt
   *  UI; returns ``{}`` when no bridge dialog is open. */
  async resolveBridgeActive(
    values: Record<string, unknown>,
  ): Promise<Record<string, boolean>> {
    return (await this.callPy("resolve_bridge_active", {
      values,
    })) as Record<string, boolean>;
  }

  /**
   * Serialisation queue for all Pyodide calls.
   *
   * Pyodide is single-threaded: two concurrent ``callPy`` invocations would
   * interleave reads/writes of the bootstrap globals (``_STORE``, etc.) and
   * corrupt the Python state.  Every ``callPy`` chains on this promise so
   * the Python side observes a strictly serial sequence of requests.  A
   * failure in one call must not poison subsequent ones, so the chain is
   * rebuilt with ``.catch(() => undefined)``.
   */
  private _queue: Promise<unknown> = Promise.resolve();

  // ------------------------------------------------------------------
  // On-disk storage mode state (OPFS spill / page-in)
  // ------------------------------------------------------------------

  /** Active storage mode. ``"ram"`` keeps the legacy behaviour with no
   *  OPFS code path engaged at all (guards below are no-ops). */
  private storageMode: StorageMode = "ram";
  /** Lazily-created OPFS byte store; only allocated in ``"disk"`` mode.
   *  Either the async {@link OpfsObjectStore} (main thread) or the faster
   *  synchronous-handle ``OpfsSyncObjectStore`` (when running in a worker). */
  private opfsStore: ObjectByteStore | null = null;
  /** JS mirror of bootstrap's ``_SPILLED`` set — object ids whose heavy
   *  array currently lives on disk rather than in the WASM heap. */
  private readonly spilledOids = new Set<string>();

  /** kwarg keys carrying a single object id referenced by a call. */
  private static readonly OID_KEYS: readonly string[] = [
    "oid",
    "id",
    "operand_id",
    "source_id",
  ];
  /** kwarg keys carrying a list of object ids referenced by a call. */
  private static readonly OIDS_KEYS: readonly string[] = [
    "oids",
    "ids",
    "source_ids",
  ];
  /** Calls that delete their referenced objects — never page those in. */
  private static readonly DELETES_OBJECTS: ReadonlySet<string> = new Set([
    "delete_object",
    "delete_all_objects",
  ]);
  /** Calls that iterate the *whole* model and need every array resident
   *  (e.g. workspace serialisation). */
  private static readonly NEEDS_ALL_RESIDENT: ReadonlySet<string> = new Set([
    "save_workspace_to_bytes",
  ]);
  /** Calls that replace the whole model with freshly-loaded objects, so
   *  the on-disk store must be reset and every new object re-spilled. */
  private static readonly REPLACES_MODEL: ReadonlySet<string> = new Set([
    "open_workspace_from_bytes",
    "reset_all",
  ]);
  /** Calls that mutate an existing object's heavy array **in place**, so
   *  a paged-in operand must be re-serialised (not just released). */
  private static readonly MUTATES_HEAVY: ReadonlySet<string> = new Set([
    "set_image_data",
    "set_signal_xydata",
    "reapply_last_processing",
    "update_image_creation_params",
    "update_signal_creation_params",
  ]);
  /** Calls whose return value is one or more freshly-produced object ids
   *  that must be spilled to disk afterwards (in disk mode). */
  private static readonly PRODUCES_OBJECTS: ReadonlySet<string> = new Set([
    "add_image_from_array",
    "add_signal_from_arrays",
    "create_signal",
    "create_image",
    "create_signal_typed",
    "create_image_typed",
    "duplicate_object",
    "apply_processing",
    "apply_feature",
    "extract_image_rois",
    "erase_image_area",
    "commit_interactive_fit",
    "add_object_pickled",
    "plot_results",
  ]);

  /** Collect the object ids referenced by *kwargs* (single + list keys). */
  private static referencedOids(kwargs: Record<string, unknown>): string[] {
    const out: string[] = [];
    for (const k of DataLabRuntime.OID_KEYS) {
      const v = kwargs[k];
      if (typeof v === "string") out.push(v);
    }
    for (const k of DataLabRuntime.OIDS_KEYS) {
      const v = kwargs[k];
      if (Array.isArray(v)) {
        for (const x of v) if (typeof x === "string") out.push(x);
      }
    }
    return out;
  }

  /** Normalise a call's return value into a flat list of object ids. */
  private static producedOids(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) {
      return value.filter((x): x is string => typeof x === "string");
    }
    return [];
  }

  /**
   * Invoke a bootstrap.py callable **without** queueing.
   *
   * This is the raw Pyodide call (kwargs marshalling, coroutine await,
   * ``toJs`` conversion, mutation-listener notification). It must only
   * be called from within the serialised section (see {@link callPy})
   * or from the disk-mode guard, which already runs inside it.
   */
  private async invokePy<T = unknown>(
    name: string,
    kwargs: Record<string, unknown> = {},
    options: { silent?: boolean } = {},
  ): Promise<T> {
    const fn = this.py.globals.get(name);
    if (!fn) {
      throw new Error(`Python function not found: ${name}`);
    }
    if (typeof fn.callKwargs !== "function") {
      fn.destroy?.();
      throw new Error(
        `PyProxy for ${name} does not support callKwargs — Pyodide >= 0.22 required.`,
      );
    }
    try {
      // In Pyodide, callKwargs must receive the kwargs dict as its LAST
      // argument.  All our helpers in bootstrap.py are called with kwargs
      // only, so the kwargs dict is also the only argument.
      const result = fn.callKwargs(kwargs);
      // ``result`` may be: (a) a plain JS value, (b) a JS Promise, or
      // (c) a Pyodide PyProxy of a coroutine (when the bootstrap
      // function is ``async def``).  The latter is "thenable" but is
      // **not** an ``instanceof Promise``, so we must detect it via
      // duck typing on ``.then`` to await it correctly — otherwise we
      // end up running ``toJs`` on the live coroutine proxy, which
      // gets destroyed mid-conversion and throws "Object has already
      // been destroyed".
      const isThenable =
        result != null &&
        (result instanceof Promise ||
          typeof (result as { then?: unknown }).then === "function");
      const awaited = isThenable ? await result : result;
      const value = toJs(awaited) as T;
      // Notify workspace-mutation listeners *after* the Python side
      // returns successfully — failed mutations don't dirty the
      // workspace. ``silent`` lets panel bootstrap code seed default
      // content without surfacing it as a user edit.
      if (!options.silent && DataLabRuntime.MUTATING_PY_FUNCTIONS.has(name)) {
        this.emitWorkspaceMutation(name);
      }
      return value;
    } catch (err) {
      if (!options.silent) {
        console.error(`[runtime] ${name} failed`, err);
      }
      throw err;
    } finally {
      fn.destroy?.();
    }
  }

  /** Call a Python function declared in bootstrap.py with keyword args.
   *
   *  Serialised through {@link _queue} so the single-threaded Python
   *  side observes a strict request order. In disk mode the call is
   *  wrapped by a page-in/spill guard so referenced objects are made
   *  resident for its duration and dropped again afterwards. */
  private async callPy<T = unknown>(
    name: string,
    kwargs: Record<string, unknown> = {},
    options: { silent?: boolean } = {},
  ): Promise<T> {
    const doCall = async (): Promise<T> => {
      if (this.storageMode !== "disk") {
        return this.invokePy<T>(name, kwargs, options);
      }
      const pagedIn = await this.diskGuardBefore(name, kwargs);
      let value: T;
      try {
        value = await this.invokePy<T>(name, kwargs, options);
      } finally {
        // Re-spill anything we paged in even when the call throws, so a
        // failed op never leaves the heap inflated.
        await this.diskGuardReleaseFailsafe(name, pagedIn);
      }
      await this.diskGuardAfter(name, kwargs, value, pagedIn);
      return value;
    };
    const next = this._queue.then(doCall, doCall);
    // Keep the chain alive even if this call rejects.
    this._queue = next.catch(() => undefined);
    return next;
  }

  // ------------------------------------------------------------------
  // Disk-mode guard (runs inside the serialised section)
  // ------------------------------------------------------------------

  private requireStore(): ObjectByteStore {
    if (!this.opfsStore) {
      throw new Error("OPFS store not initialised (storage mode is 'disk')");
    }
    return this.opfsStore;
  }

  /** Page object *oid* back into the heap (direct, unqueued). */
  private async pageInDirect(oid: string): Promise<void> {
    if (!this.spilledOids.has(oid)) return;
    const bytes = await this.requireStore().get(oid);
    await this.invokePy("attach_object_array", { oid, payload: bytes });
    this.spilledOids.delete(oid);
  }

  /** Spill object *oid* to disk, serialising it afresh (direct, unqueued). */
  private async spillDirect(oid: string): Promise<boolean> {
    if (this.spilledOids.has(oid)) return false;
    const bytes = (await this.invokePy("detach_object_array", {
      oid,
    })) as Uint8Array | null;
    if (!bytes || bytes.byteLength === 0) return false;
    await this.requireStore().put(oid, bytes);
    this.spilledOids.add(oid);
    return true;
  }

  /** Drop a resident object's array without rewriting its (current) OPFS
   *  copy — used to re-spill read-only page-ins at no I/O cost. */
  private async releaseDirect(oid: string): Promise<void> {
    const released = (await this.invokePy("release_object_array", {
      oid,
    })) as boolean;
    if (released) this.spilledOids.add(oid);
  }

  /** Make referenced (or all) objects resident before the call. Returns
   *  the ids that were actually paged in, so they can be re-spilled. */
  private async diskGuardBefore(
    name: string,
    kwargs: Record<string, unknown>,
  ): Promise<string[]> {
    if (DataLabRuntime.DELETES_OBJECTS.has(name)) return [];
    let targets: string[];
    if (DataLabRuntime.NEEDS_ALL_RESIDENT.has(name)) {
      targets = Array.from(this.spilledOids);
    } else {
      targets = DataLabRuntime.referencedOids(kwargs).filter((oid) =>
        this.spilledOids.has(oid),
      );
    }
    const pagedIn: string[] = [];
    for (const oid of targets) {
      await this.pageInDirect(oid);
      pagedIn.push(oid);
    }
    return pagedIn;
  }

  /** Re-spill paged-in operands and spill freshly-produced results. */
  private async diskGuardAfter(
    name: string,
    _kwargs: Record<string, unknown>,
    value: unknown,
    pagedIn: string[],
  ): Promise<void> {
    if (DataLabRuntime.DELETES_OBJECTS.has(name)) {
      await this.reconcileDeletedSpills();
      return;
    }
    if (DataLabRuntime.REPLACES_MODEL.has(name)) {
      // The model was replaced wholesale: forget the old store and
      // spill every freshly-loaded object.
      this.spilledOids.clear();
      await this.requireStore().clear();
      await this.spillAllResidentDirect();
      return;
    }
    const mutated = DataLabRuntime.MUTATES_HEAVY.has(name);
    for (const oid of pagedIn) {
      if (mutated) {
        // Data changed in place → rewrite the on-disk copy.
        await this.spillDirect(oid);
      } else {
        // Read-only access → drop the array, keep the existing file.
        await this.releaseDirect(oid);
      }
    }
    if (DataLabRuntime.PRODUCES_OBJECTS.has(name)) {
      for (const oid of DataLabRuntime.producedOids(value)) {
        await this.spillDirect(oid);
      }
    }
    // Reclaim heap pages freed by the placeholders so later allocations
    // reuse them instead of growing the heap.
    if (pagedIn.length || DataLabRuntime.PRODUCES_OBJECTS.has(name)) {
      await this.invokePy("collect_garbage");
    }
  }

  /** Best-effort re-spill on the error path (never throws). */
  private async diskGuardReleaseFailsafe(
    name: string,
    pagedIn: string[],
  ): Promise<void> {
    void name;
    for (const oid of pagedIn) {
      if (this.spilledOids.has(oid)) continue;
      try {
        await this.releaseDirect(oid);
      } catch {
        // Swallow — we're already on an error path.
      }
    }
  }

  /** Spill every resident object (direct, unqueued). */
  private async spillAllResidentDirect(): Promise<void> {
    const candidates = (await this.invokePy("spillable_objects")) as Array<{
      oid: string;
    }>;
    let any = false;
    for (const c of candidates) {
      if (await this.spillDirect(c.oid)) any = true;
    }
    if (any) await this.invokePy("collect_garbage");
  }

  /** Page every spilled object back in (direct, unqueued). */
  private async pageInAllDirect(): Promise<void> {
    for (const oid of Array.from(this.spilledOids)) {
      await this.pageInDirect(oid);
    }
  }

  /** After a delete, drop the OPFS files of objects no longer present in
   *  bootstrap's ``_SPILLED`` set, and sync the JS mirror. */
  private async reconcileDeletedSpills(): Promise<void> {
    const remaining = new Set(
      (await this.invokePy("spilled_object_ids")) as string[],
    );
    for (const oid of Array.from(this.spilledOids)) {
      if (!remaining.has(oid)) {
        await this.requireStore().delete(oid);
        this.spilledOids.delete(oid);
      }
    }
  }

  // ------------------------------------------------------------------
  // On-disk storage mode — public API
  // ------------------------------------------------------------------

  /** Whether the on-disk storage mode can be enabled in this context. */
  static isDiskStorageSupported(): boolean {
    return OpfsObjectStore.isSupported();
  }

  /** Return the active storage mode. */
  getStorageMode(): StorageMode {
    return this.storageMode;
  }

  /**
   * Switch the runtime storage mode.
   *
   * ``"disk"`` spills every resident array to OPFS (keeping only
   * metadata in the heap); ``"ram"`` pages every spilled array back in
   * and clears the on-disk store. Both transitions are queued so they
   * never interleave with in-flight Python calls. No-op when already in
   * the requested mode.
   */
  async setStorageMode(mode: StorageMode): Promise<void> {
    if (mode === this.storageMode) return;
    if (mode === "disk" && !OpfsObjectStore.isSupported()) {
      throw new Error(
        "on-disk storage mode is unavailable in this browser/context",
      );
    }
    const run = async (): Promise<void> => {
      if (mode === "disk") {
        if (!this.opfsStore) {
          // Prefer the synchronous-handle store when the runtime runs in a
          // worker (4–7× faster spills, see ``opfs_sync_spike``); fall back
          // to the async ``createWritable`` store on the main thread.
          this.opfsStore = OpfsSyncObjectStore.isSupported()
            ? new OpfsSyncObjectStore()
            : new OpfsObjectStore();
          await this.opfsStore.init();
        }
        this.storageMode = "disk";
        await this.spillAllResidentDirect();
      } else {
        await this.pageInAllDirect();
        this.storageMode = "ram";
        if (this.opfsStore) await this.opfsStore.clear();
      }
    };
    const next = this._queue.then(run, run);
    this._queue = next.catch(() => undefined);
    return next as Promise<void>;
  }

  /** Total bytes currently spilled to the OPFS store (0 in RAM mode). */
  getDiskStoreBytes(): number {
    return this.opfsStore?.totalBytes() ?? 0;
  }

  /** Number of objects whose array currently lives on disk. */
  getSpilledCount(): number {
    return this.spilledOids.size;
  }

  async createSignal(params: SignalCreationParams): Promise<string> {
    const id = (await this.callPy(
      "create_signal",
      params as unknown as Record<string, unknown>,
    )) as string;
    return id;
  }

  /** Create a signal from raw X / Y arrays (used by the macro proxy
   *  bridge — mirrors :func:`bootstrap.add_signal_from_arrays`). */
  async addSignalFromArrays(params: {
    title: string;
    xdata: number[] | Float32Array | Float64Array;
    ydata: number[] | Float32Array | Float64Array;
    xunit?: string;
    yunit?: string;
    xlabel?: string;
    ylabel?: string;
    group_id?: string | null;
    dtype?: string;
  }): Promise<string> {
    return (await this.callPy(
      "add_signal_from_arrays",
      params as unknown as Record<string, unknown>,
    )) as string;
  }

  /** Create an image from a raw 2D array (mirrors
   *  :func:`bootstrap.add_image_from_array`). */
  async addImageFromArray(params: {
    title: string;
    data: number[][] | Float32Array | Float64Array | Uint8Array;
    xunit?: string;
    yunit?: string;
    zunit?: string;
    xlabel?: string;
    ylabel?: string;
    zlabel?: string;
    group_id?: string | null;
    width?: number;
    height?: number;
    dtype?: string;
  }): Promise<string> {
    return (await this.callPy(
      "add_image_from_array",
      params as unknown as Record<string, unknown>,
    )) as string;
  }

  /** List the supported signal-generation types (mirrors DataLab's
   *  desktop "Create" menu).  Every entry maps to a guidata
   *  ``NewSignalParam`` subclass on the Python side. */
  async listSignalCreationTypes(): Promise<SignalCreationType[]> {
    return (await this.callPy(
      "list_signal_creation_types",
    )) as SignalCreationType[];
  }

  /** Create a signal of the given type with default parameters and
   *  return the new object id.  The originating ``NewSignalParam``
   *  instance is cached so it can be edited via the Creation panel. */
  async createSignalTyped(stype: string, groupId?: string): Promise<string> {
    return (await this.callPy("create_signal_typed", {
      stype,
      group_id: groupId ?? null,
    })) as string;
  }

  /** Return the JSON Schema + values for the cached creation
   *  parameters of *id*, or ``null`` when the object was not created
   *  through ``createSignalTyped``. */
  async getCreationParamSchema(
    id: string,
  ): Promise<(SchemaWithValues & { stype: string }) | null> {
    return (await this.callPy("get_creation_param_schema", {
      oid: id,
    })) as (SchemaWithValues & { stype: string }) | null;
  }

  /** Apply *values* to the cached creation parameters and rebuild the
   *  signal in place. */
  async updateSignalCreationParams(
    id: string,
    values: Record<string, unknown>,
  ): Promise<{ size: number; title: string }> {
    return (await this.callPy("update_signal_creation_params", {
      oid: id,
      values,
    })) as { size: number; title: string };
  }

  /** Return the JSON Schema + values for the underlying object DataSet
   *  itself (used by the "Properties" side panel). */
  async getObjectPropertySchema(id: string): Promise<SchemaWithValues> {
    return (await this.callPy("get_object_property_schema", {
      oid: id,
    })) as SchemaWithValues;
  }

  /** Apply *values* directly to the underlying object DataSet. */
  async setObjectPropertyValues(
    id: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    await this.callPy("set_object_property_values", { oid: id, values });
  }

  /** Read-only stats summary (dtype / shape / min / max / mean / std)
   *  of the underlying object array.  Used by the Properties panel. */
  async getObjectStats(id: string): Promise<ObjectStats> {
    return (await this.callPy("get_object_stats", { oid: id })) as ObjectStats;
  }

  /** Visible metadata entries of *id* (sorted, internal keys filtered out). */
  async listObjectMetadata(id: string): Promise<MetadataEntry[]> {
    return (await this.callPy("list_object_metadata", {
      oid: id,
    })) as MetadataEntry[];
  }

  /** Add or update a metadata entry on *id*. */
  async setObjectMetadataValue(
    id: string,
    key: string,
    valueType: MetadataValueType,
    value: string,
  ): Promise<void> {
    await this.callPy("set_object_metadata_value", {
      oid: id,
      key,
      value_type: valueType,
      value,
    });
  }

  /** Remove *key* from *id*'s metadata.  Returns ``true`` when the key
   *  was present, ``false`` otherwise. */
  async deleteObjectMetadataKey(id: string, key: string): Promise<boolean> {
    return (await this.callPy("delete_object_metadata_key", {
      oid: id,
      key,
    })) as boolean;
  }

  /** Copy *id*'s metadata into the panel clipboard (mirrors DataLab
   *  desktop's "Copy metadata"). */
  async copyObjectMetadata(id: string): Promise<boolean> {
    return (await this.callPy("copy_object_metadata", {
      oid: id,
    })) as boolean;
  }

  /** Return ``true`` when the metadata clipboard holds a payload that
   *  "Paste metadata" can apply. */
  async hasMetadataInClipboard(): Promise<boolean> {
    return (await this.callPy("has_metadata_in_clipboard")) as boolean;
  }

  /** Paste the clipboard metadata onto every object of *ids* (shows a
   *  parameter dialog).  Returns ``false`` when cancelled or empty. */
  async pasteObjectMetadata(ids: string[]): Promise<boolean> {
    return (await this.callPy("paste_object_metadata", {
      oids: ids,
    })) as boolean;
  }

  /** Add a metadata item to every object of *ids* (shows a parameter
   *  dialog).  Returns ``false`` when cancelled. */
  async addObjectMetadata(ids: string[]): Promise<boolean> {
    return (await this.callPy("add_object_metadata", {
      oids: ids,
    })) as boolean;
  }

  /** Return ``true`` when any object of *ids* carries a region of
   *  interest (used to decide whether to prompt before deleting). */
  async objectsHaveRoi(ids: string[]): Promise<boolean> {
    return (await this.callPy("objects_have_roi", { oids: ids })) as boolean;
  }

  /** Delete all metadata of every object of *ids*.  When *keepRoi* is
   *  ``true`` the regions of interest survive the reset. */
  async deleteObjectMetadata(
    ids: string[],
    keepRoi: boolean,
  ): Promise<boolean> {
    return (await this.callPy("delete_object_metadata", {
      oids: ids,
      keep_roi: keepRoi,
    })) as boolean;
  }

  /** Serialise *id*'s metadata to ``.dlabmeta`` (JSON) bytes for
   *  download. */
  async exportObjectMetadataBytes(id: string): Promise<Uint8Array> {
    const result = (await this.callPy("export_object_metadata_bytes", {
      oid: id,
    })) as Uint8Array | ArrayBuffer | number[];
    if (result instanceof Uint8Array) return result;
    if (result instanceof ArrayBuffer) return new Uint8Array(result);
    return Uint8Array.from(result as number[]);
  }

  /** Replace *id*'s metadata from previously exported ``.dlabmeta``
   *  bytes. */
  async importObjectMetadataBytes(
    id: string,
    bytes: Uint8Array,
  ): Promise<void> {
    await this.callPy("import_object_metadata_bytes", {
      oid: id,
      data: bytes,
    });
  }

  /** Return an indented text tree of *kind*'s groups and object titles
   *  (mirrors DataLab desktop's "Copy titles to clipboard"). */
  async getPanelTitlesText(kind: "signal" | "image"): Promise<string> {
    return (await this.callPy("get_panel_titles_text", { kind })) as string;
  }

  /** List every signal I/O format supported by Sigima.  Used to drive
   *  the "Open"/"Save" file dialog accept lists. */
  async listSignalIoFormats(): Promise<SignalIoFormats> {
    return (await this.callPy("list_signal_io_formats")) as SignalIoFormats;
  }

  /** Decode *bytes* as a signal file and add the resulting signals to
   *  the model.  Returns the new object ids. */
  async openSignalFromBytes(
    filename: string,
    bytes: Uint8Array,
    groupId?: string,
  ): Promise<string[]> {
    return (await this.callPy("open_signal_from_bytes", {
      filename,
      data: bytes,
      group_id: groupId ?? null,
    })) as string[];
  }

  /** Serialise *id* into the format implied by *filename*'s extension.
   *  Returns a ``Uint8Array`` ready to hand to a browser ``Blob``. */
  async saveSignalToBytes(id: string, filename: string): Promise<Uint8Array> {
    const result = (await this.callPy("save_signal_to_bytes", {
      oid: id,
      filename,
    })) as Uint8Array | ArrayBuffer | number[];
    if (result instanceof Uint8Array) return result;
    if (result instanceof ArrayBuffer) return new Uint8Array(result);
    return Uint8Array.from(result as number[]);
  }

  /** Image-side counterpart of :meth:`listSignalIoFormats`. */
  async listImageIoFormats(): Promise<ImageIoFormats> {
    return (await this.callPy("list_image_io_formats")) as ImageIoFormats;
  }

  /** Image-side counterpart of :meth:`openSignalFromBytes`. */
  async openImageFromBytes(
    filename: string,
    bytes: Uint8Array,
    groupId?: string,
  ): Promise<string[]> {
    return (await this.callPy("open_image_from_bytes", {
      filename,
      data: bytes,
      group_id: groupId ?? null,
    })) as string[];
  }

  /** Image-side counterpart of :meth:`saveSignalToBytes`. */
  async saveImageToBytes(id: string, filename: string): Promise<Uint8Array> {
    const result = (await this.callPy("save_image_to_bytes", {
      oid: id,
      filename,
    })) as Uint8Array | ArrayBuffer | number[];
    if (result instanceof Uint8Array) return result;
    if (result instanceof ArrayBuffer) return new Uint8Array(result);
    return Uint8Array.from(result as number[]);
  }

  /** Open every file from a single directory in one Python round-trip.
   *
   *  Mirrors the per-subfolder branch of DataLab desktop's
   *  ``BaseDataPanel.load_from_directory``: individual read failures are
   *  swallowed (parity with ``ignore_errors=True``) and the group is
   *  created only if at least one object was successfully read.
   */
  async openFromDirectoryChunk(
    kind: "signal" | "image",
    groupName: string,
    files: Array<{ name: string; data: Uint8Array }>,
  ): Promise<{ gid?: string; oids: string[]; errors: number }> {
    // ``gid`` is absent (``undefined``) when no object was successfully
    // read — Pyodide converts Python ``None`` to JS ``undefined``.
    return (await this.callPy("open_from_directory_chunk", {
      kind,
      group_name: groupName,
      files,
    })) as { gid?: string; oids: string[]; errors: number };
  }

  /** Build basenames for *oids* using DataLab's filename pattern syntax
   *  (``{title}``, ``{index}``, ``{count}``, axis placeholders, …).
   *  Mirrors the desktop "Save to directory…" preview helper. */
  async formatSignalBasenames(
    oids: string[],
    pattern: string,
  ): Promise<string[]> {
    return (await this.callPy("format_signal_basenames", {
      oids,
      fmt: pattern,
    })) as string[];
  }

  /** List every entry of the signal "Analysis" menu (DataLab parity). */
  async listSignalAnalysis(): Promise<SignalAnalysisDescriptor[]> {
    return (await this.callPy(
      "list_signal_analysis",
    )) as SignalAnalysisDescriptor[];
  }

  /** Return the parameter schema (with cached values pre-filled) for the
   *  given analysis function, or ``null`` for parameter-less analyses. */
  async getSignalAnalysisParamSchema(
    id: string,
    funcId: string,
  ): Promise<unknown | null> {
    const schema = await this.callPy("get_signal_analysis_param_schema", {
      oid: id,
      func_id: funcId,
    });
    return schema ?? null;
  }

  /** Run analysis *funcId* on signal *id* and persist the result on the
   *  signal's metadata.  Returns ``null`` when the function legitimately
   *  produced no result (e.g. FWHM on a flat curve). */
  async runSignalAnalysis(
    id: string,
    funcId: string,
    params?: Record<string, unknown> | null,
  ): Promise<AnalysisResult | null> {
    const out = await this.callPy("run_signal_analysis", {
      oid: id,
      func_id: funcId,
      params: params ?? null,
    });
    return (out ?? null) as AnalysisResult | null;
  }

  /** Return every analysis result currently attached to signal *id*. */
  async listSignalResults(id: string): Promise<AnalysisResult[]> {
    return (await this.callPy("list_signal_results", {
      oid: id,
    })) as AnalysisResult[];
  }

  /** Drop one (or all) analysis result(s) from signal *id*'s metadata. */
  async clearSignalResults(id: string, metadataKey?: string): Promise<number> {
    return (await this.callPy("clear_signal_results", {
      oid: id,
      metadata_key: metadataKey ?? null,
    })) as number;
  }

  /** Describe the plottable analysis-result categories shared by *ids*
   *  (mirrors DataLab desktop's "Analysis ▸ Plot results").  Returns an
   *  empty list when the selection carries no plottable result. */
  async getPlotResultsSchemas(
    ids: string[],
  ): Promise<PlotResultsSchemaEntry[]> {
    return (await this.callPy("get_plot_results_schemas", {
      oids: ids,
    })) as PlotResultsSchemaEntry[];
  }

  /** Aggregate analysis results of *category* across *ids* into new result
   *  signals (placed in a get-or-create signal group *groupName*) and
   *  return the ids of the created signals. */
  async plotResults(params: {
    ids: string[];
    category: string;
    kind: string;
    xaxis: string;
    yaxis: string;
    groupName: string;
  }): Promise<string[]> {
    return (await this.callPy("plot_results", {
      oids: params.ids,
      category: params.category,
      kind: params.kind,
      xaxis: params.xaxis,
      yaxis: params.yaxis,
      group_name: params.groupName,
    })) as string[];
  }

  async listSignals(): Promise<SignalMeta[]> {
    return (await this.callPy("list_signals")) as SignalMeta[];
  }

  /** Flat ``{id, title}`` list of every stored image. */
  async listImages(): Promise<{ id: string; title: string }[]> {
    return (await this.callPy("list_images")) as {
      id: string;
      title: string;
    }[];
  }

  /** Minimal ``{id, kind, title}`` descriptor for a single object. */
  async getObject(
    id: string,
  ): Promise<{ id: string; kind: string; title: string }> {
    return (await this.callPy("get_object", { oid: id })) as {
      id: string;
      kind: string;
      title: string;
    };
  }

  /** Ids of every object hosted by *panel* (``"signal"`` or ``"image"``). */
  async getObjectUuids(panel: string): Promise<string[]> {
    return (await this.callPy("get_object_uuids", { panel })) as string[];
  }

  async getSignalData(id: string): Promise<SignalData> {
    return (await this.callPy("get_signal_xy", { oid: id })) as SignalData;
  }

  /** Overwrite the X / Y arrays of signal *id* with edited values
   *  (used by the Properties > Data array editor). */
  async setSignalData(id: string, x: number[], y: number[]): Promise<void> {
    await this.callPy("set_signal_xydata", { oid: id, x, y });
  }

  /** Binary variant of :meth:`getSignalData` — used by the remote
   *  bridge to ship large signals across the iframe boundary as a
   *  pair of ``Uint8Array`` (raw float64 little-endian) instead of
   *  serialising every sample as a JSON number. */
  async getSignalDataBinary(id: string): Promise<unknown> {
    return await this.callPy("get_signal_xy", {
      oid: id,
      encoding: "bytes",
    });
  }

  /** Batched fetch for multi-signal overlay.  Returns one entry per
   *  resolved id (unknown ids are silently skipped server-side). */
  async getSignalsData(ids: string[]): Promise<SignalData[]> {
    if (ids.length === 0) return [];
    return (await this.callPy("get_signals_xy", {
      oids: ids,
    })) as SignalData[];
  }

  /** Persist per-curve render style on a signal.  Each field follows
   *  the "``null`` clears the override" rule honoured by
   *  :func:`bootstrap.set_signal_style`; pass an explicit value to
   *  override.  Omitted fields default to ``null`` (clear). */
  async setSignalStyle(
    oid: string,
    style: Partial<SignalStyle>,
  ): Promise<void> {
    await this.callPy("set_signal_style", {
      oid,
      color: style.color ?? null,
      linestyle: style.linestyle ?? null,
      linewidth: style.linewidth ?? null,
      curvestyle: style.curvestyle ?? null,
    });
  }

  // ------------------------------------------------------------------
  // Object model (groups + objects per panel kind)
  // ------------------------------------------------------------------

  async getPanelTree(kind: PanelKind = "signal"): Promise<PanelTree> {
    return (await this.callPy("get_panel_tree", { kind })) as PanelTree;
  }

  async createGroup(
    kind: PanelKind = "signal",
    name?: string,
  ): Promise<string> {
    return (await this.callPy("create_group", {
      kind,
      name: name ?? null,
    })) as string;
  }

  async renameGroup(
    gid: string,
    name: string,
    kind: PanelKind = "signal",
  ): Promise<void> {
    await this.callPy("rename_group", { gid, name, kind });
  }

  async deleteGroup(gid: string, kind: PanelKind = "signal"): Promise<void> {
    await this.callPy("delete_group", { gid, kind });
  }

  async renameObject(oid: string, name: string): Promise<void> {
    await this.callPy("rename_object", { oid, name });
  }

  async moveObject(
    oid: string,
    targetGroupId: string,
    targetIndex = -1,
  ): Promise<void> {
    await this.callPy("move_object", {
      oid,
      target_group_id: targetGroupId,
      target_index: targetIndex,
    });
  }

  async moveObjects(
    oids: string[],
    targetGroupId: string,
    targetIndex = -1,
  ): Promise<void> {
    await this.callPy("move_objects", {
      oids,
      target_group_id: targetGroupId,
      target_index: targetIndex,
    });
  }

  async moveObjectInGroup(oid: string, delta: number): Promise<void> {
    await this.callPy("move_object_in_group", { oid, delta });
  }

  async duplicateObject(oid: string): Promise<string> {
    return (await this.callPy("duplicate_object", { oid })) as string;
  }

  async deleteObject(oid: string): Promise<void> {
    await this.callPy("delete_object", { oid });
  }

  /**
   * Delete every object and group of *kind*'s panel, keeping a single
   * empty default group. Equivalent of DataLab desktop's "Delete all
   * groups and objects".
   */
  async deleteAllObjects(kind: PanelKind = "signal"): Promise<void> {
    await this.callPy("delete_all_objects", { kind });
  }

  /**
   * Wipe every signal/image/macro/notebook from the in-Pyodide model.
   *
   * Used by the E2E worker-scoped fixture that reuses a single Pyodide
   * instance across multiple tests; production UI never calls this.
   */
  async resetAll(): Promise<void> {
    await this.callPy("reset_all");
  }

  // ------------------------------------------------------------------
  // Metadata & annotations (Phase 4)
  // ------------------------------------------------------------------

  async getObjectMeta(oid: string): Promise<ObjectMeta> {
    return (await this.callPy("get_object_meta", { oid })) as ObjectMeta;
  }

  async setObjectMeta(oid: string, fields: Partial<ObjectMeta>): Promise<void> {
    await this.callPy("set_object_meta", { oid, fields });
  }

  async getPlotlyAnnotations(oid: string): Promise<PlotlyAnnotations> {
    return (await this.callPy("get_plotly_annotations", {
      oid,
    })) as PlotlyAnnotations;
  }

  async setPlotlyAnnotations(
    oid: string,
    payload: PlotlyAnnotations,
  ): Promise<void> {
    await this.callPy("set_plotly_annotations", { oid, payload });
  }

  /** Persisted LUT range ``[zmin, zmax]`` for an image, or ``null`` when
   *  no override has been stored (in which case the UI falls back to the
   *  image's intrinsic ``data_min``/``data_max``). */
  async getLutRange(oid: string): Promise<[number, number] | null> {
    const result = (await this.callPy("get_lut_range", { oid })) as
      | [number, number]
      | null;
    if (!result || result.length !== 2) return null;
    return [Number(result[0]), Number(result[1])];
  }

  /** Persist an LUT range ``[zmin, zmax]`` override. Pass ``null`` to
   *  clear it (returns to the intrinsic data range). */
  async setLutRange(
    oid: string,
    payload: [number, number] | null,
  ): Promise<void> {
    await this.callPy("set_lut_range", { oid, payload });
  }

  /** Persist the colormap (Plotly named colorscale + invert flag) on
   *  image *oid*.  Pass ``name=null`` to clear the override and let the
   *  viewer fall back to its built-in default. */
  async setColormap(
    oid: string,
    name: string | null,
    inverted = false,
  ): Promise<void> {
    await this.callPy("set_colormap", { oid, name, inverted });
  }

  /** Persist the display resampling method (``"nearest"`` | ``"max"`` |
   *  ``"mean"``) on image *oid*.  Pass ``null`` to clear the override.
   *  Only affects the downsampled display bitmap, never profiles or
   *  statistics. */
  async setResampleMethod(oid: string, method: string | null): Promise<void> {
    await this.callPy("set_resample_method", { oid, method });
  }

  // ------------------------------------------------------------------
  // Signal ROI (Phase 5)
  // ------------------------------------------------------------------

  async getSignalRoi(oid: string): Promise<SignalRoiSegment[]> {
    return (await this.callPy("get_signal_roi", { oid })) as SignalRoiSegment[];
  }

  async setSignalRoi(oid: string, segments: SignalRoiSegment[]): Promise<void> {
    await this.callPy("set_signal_roi", { oid, segments });
  }

  async deleteSignalRoiAt(oid: string, index: number): Promise<void> {
    await this.callPy("delete_signal_roi_at", { oid, index });
  }

  async extractSignalRois(oid: string, merged: boolean): Promise<string[]> {
    return (await this.callPy("extract_signal_rois", {
      oid,
      merged,
    })) as string[];
  }

  // ------------------------------------------------------------------
  // Workspace HDF5 + CSV I/O
  // ------------------------------------------------------------------

  /** Serialise the full object model to a DataLab-compatible HDF5 file.
   *  The returned bytes are ready to wrap in a ``Blob`` for download and
   *  round-trip through Qt DataLab's "Open HDF5 workspace" feature. */
  async saveWorkspaceHdf5(): Promise<Uint8Array> {
    const result = (await this.callPy("save_workspace_to_bytes")) as
      | Uint8Array
      | ArrayBuffer
      | number[];
    if (result instanceof Uint8Array) return result;
    if (result instanceof ArrayBuffer) return new Uint8Array(result);
    return Uint8Array.from(result as number[]);
  }

  /** Load *bytes* (a DataLab-compatible HDF5 workspace) into the model.
   *  When *replace* is true (default), the current model is wiped first.
   *
   *  Pass ``silent: true`` when the caller probes whether a file is a
   *  workspace and intends to fall back to plain HDF5 import; in that
   *  case the expected ``Not a DataLab HDF5 workspace`` Python error
   *  should not be logged as a runtime error. */
  async openWorkspaceHdf5(
    filename: string,
    bytes: Uint8Array,
    replace: boolean = true,
    options: { silent?: boolean } = {},
  ): Promise<WorkspaceLoadResult> {
    return (await this.callPy(
      "open_workspace_from_bytes",
      {
        filename,
        data: bytes,
        replace,
      },
      { silent: options.silent },
    )) as WorkspaceLoadResult;
  }

  // ------------------------------------------------------------------
  // Foreign HDF5 browser (Phase 2)
  // ------------------------------------------------------------------

  /** Open *bytes* as an HDF5 file in the browser dialog.  The returned
   *  ``file_id`` must later be passed to ``closeH5Browser`` to free the
   *  underlying ``h5py.File`` handle and temp file. */
  async openH5Browser(
    filename: string,
    bytes: Uint8Array,
  ): Promise<H5BrowserFile> {
    return (await this.callPy("h5_browser_open", {
      filename,
      data: bytes,
    })) as H5BrowserFile;
  }

  /** Close one open HDF5 browser file. */
  async closeH5Browser(fileId: string): Promise<void> {
    await this.callPy("h5_browser_close", { file_id: fileId });
  }

  /** Close every open HDF5 browser file (use on dialog dismissal). */
  async closeAllH5Browsers(): Promise<void> {
    await this.callPy("h5_browser_close_all");
  }

  async getH5BrowserNodeAttrs(
    fileId: string,
    nodeId: string,
  ): Promise<H5BrowserNodeAttrs> {
    return (await this.callPy("h5_browser_node_attrs", {
      file_id: fileId,
      node_id: nodeId,
    })) as H5BrowserNodeAttrs;
  }

  async getH5BrowserPreview(
    fileId: string,
    nodeId: string,
  ): Promise<H5BrowserPreview> {
    return (await this.callPy("h5_browser_preview", {
      file_id: fileId,
      node_id: nodeId,
    })) as H5BrowserPreview;
  }

  async getH5BrowserArray(
    fileId: string,
    nodeId: string,
  ): Promise<H5BrowserArray> {
    return (await this.callPy("h5_browser_array", {
      file_id: fileId,
      node_id: nodeId,
    })) as H5BrowserArray;
  }

  async importH5BrowserNodes(
    fileId: string,
    nodeIds: string[],
    groupId?: string | null,
  ): Promise<H5BrowserImportResult> {
    return (await this.callPy("h5_browser_import", {
      file_id: fileId,
      node_ids: nodeIds,
      group_id: groupId ?? null,
    })) as H5BrowserImportResult;
  }

  async exportSignalCsv(oid: string, separator: string = ","): Promise<string> {
    return (await this.callPy("export_signal_csv", {
      oid,
      separator,
    })) as string;
  }

  async importSignalCsv(
    content: string,
    title: string | null = null,
    separator: string = ",",
  ): Promise<string> {
    return (await this.callPy("import_signal_csv", {
      content,
      title,
      separator,
    })) as string;
  }

  // ------------------------------------------------------------------
  // Text Import Wizard (mirrors datalab.widgets.textimport)
  // ------------------------------------------------------------------

  async parseTextImport(
    content: string,
    params: TextImportParams,
    previewRows: number = 200,
  ): Promise<TextImportPreview> {
    return (await this.callPy("parse_text_import", {
      content,
      preview_rows: previewRows,
      ...textImportToPyKwargs(params),
    })) as TextImportPreview;
  }

  async buildTextImportSignals(
    content: string,
    params: TextImportParams,
  ): Promise<TextImportSignals> {
    return (await this.callPy("build_text_import_signals", {
      content,
      ...textImportToPyKwargs(params),
    })) as TextImportSignals;
  }

  async commitTextImport(
    content: string,
    params: TextImportParams,
    selection: TextImportCommitOptions,
  ): Promise<string[]> {
    return (await this.callPy("commit_text_import", {
      content,
      ...textImportToPyKwargs(params),
      selected_indices: selection.selectedIndices,
      title: selection.title ?? "",
      xlabel: selection.xlabel ?? "",
      ylabel: selection.ylabel ?? "",
      xunit: selection.xunit ?? "",
      yunit: selection.yunit ?? "",
      group_id: selection.groupId ?? null,
    })) as string[];
  }

  // ------------------------------------------------------------------
  // Image panel
  // ------------------------------------------------------------------

  async createImage(params: ImageCreationParams): Promise<string> {
    return (await this.callPy(
      "create_image",
      params as unknown as Record<string, unknown>,
    )) as string;
  }

  async getImageData(oid: string): Promise<ImageData> {
    const raw = (await this.callPy("get_image_data", {
      oid,
      encoding: "bytes",
    })) as ImageData & { encoding?: string };
    return decodeImagePayload(raw);
  }

  /** Overwrite the 2D data array of image *oid* with edited values
   *  (used by the Properties > Data array editor). */
  async setImageData(oid: string, data: number[][]): Promise<void> {
    await this.callPy("set_image_data", { oid, data });
  }

  /** Batched fetch for multi-image grid display.  Returns one entry per
   *  resolved id (unknown ids are silently skipped server-side).
   *  Mirrors :meth:`getSignalsData` for the image panel.
   *
   *  ``maxSize`` instructs Pyodide to decimate each image so its
   *  largest dimension is at most that many pixels.  The grid uses
   *  cells of a few hundred pixels wide, so a default of 512
   *  shrinks the bridge payload by 1–2 orders of magnitude on
   *  default ``1024×1024`` images while remaining visually
   *  indistinguishable. */
  async getImagesData(ids: string[], maxSize?: number): Promise<ImageData[]> {
    if (ids.length === 0) return [];
    const raw = (await this.callPy("get_images_data", {
      oids: ids,
      max_size: maxSize ?? null,
      encoding: "bytes",
    })) as Array<ImageData & { encoding?: string }>;
    return raw.map(decodeImagePayload);
  }

  /** Return the catalog of image creation types (mirrors signals). */
  async listImageCreationTypes(): Promise<ImageCreationType[]> {
    return (await this.callPy(
      "list_image_creation_types",
    )) as ImageCreationType[];
  }

  /** Create an image of *stype* with default parameters. */
  async createImageTyped(stype: string, groupId?: string): Promise<string> {
    return (await this.callPy("create_image_typed", {
      stype,
      group_id: groupId ?? null,
    })) as string;
  }

  /** Update cached image creation parameters and rebuild the image. */
  async updateImageCreationParams(
    oid: string,
    values: Record<string, unknown>,
  ): Promise<{ shape: [number, number]; title: string }> {
    return (await this.callPy("update_image_creation_params", {
      oid,
      values,
    })) as { shape: [number, number]; title: string };
  }

  // ------------------------------------------------------------------
  // Image ROI (Phase 13) — physical coordinates
  // ------------------------------------------------------------------

  async getImageRoi(oid: string): Promise<ImageRoiSegment[]> {
    return (await this.callPy("get_image_roi", { oid })) as ImageRoiSegment[];
  }

  async setImageRoi(oid: string, segments: ImageRoiSegment[]): Promise<void> {
    await this.callPy("set_image_roi", { oid, segments });
  }

  async deleteImageRoiAt(oid: string, index: number): Promise<void> {
    await this.callPy("delete_image_roi_at", { oid, index });
  }

  async extractImageRois(oid: string, merged: boolean): Promise<string[]> {
    return (await this.callPy("extract_image_rois", {
      oid,
      merged,
    })) as string[];
  }

  /** Erase one or more areas of image *oid* (defined by *segments*) and
   *  return the id of the new result image. The source image's own ROI
   *  list is left untouched. */
  async eraseImageArea(
    oid: string,
    segments: ImageRoiSegment[],
  ): Promise<string> {
    return (await this.callPy("erase_image_area", {
      oid,
      segments,
    })) as string;
  }

  // ------------------------------------------------------------------
  // Image analysis (Phase 13) — same payload shape as signal analysis.
  // ------------------------------------------------------------------

  async listImageAnalysis(): Promise<SignalAnalysisDescriptor[]> {
    return (await this.callPy(
      "list_image_analysis",
    )) as SignalAnalysisDescriptor[];
  }

  async getImageAnalysisParamSchema(
    id: string,
    funcId: string,
  ): Promise<unknown | null> {
    const schema = await this.callPy("get_image_analysis_param_schema", {
      oid: id,
      func_id: funcId,
    });
    return schema ?? null;
  }

  async runImageAnalysis(
    id: string,
    funcId: string,
    params?: Record<string, unknown> | null,
  ): Promise<AnalysisResult | null> {
    const out = await this.callPy("run_image_analysis", {
      oid: id,
      func_id: funcId,
      params: params ?? null,
    });
    return (out ?? null) as AnalysisResult | null;
  }

  async listImageResults(id: string): Promise<AnalysisResult[]> {
    return (await this.callPy("list_image_results", {
      oid: id,
    })) as AnalysisResult[];
  }

  async clearImageResults(id: string, metadataKey?: string): Promise<number> {
    return (await this.callPy("clear_image_results", {
      oid: id,
      metadata_key: metadataKey ?? null,
    })) as number;
  }

  // ------------------------------------------------------------------
  // Feature catalogue & processing dispatch
  // ------------------------------------------------------------------

  async listFeatures(): Promise<FeatureDescriptor[]> {
    return (await this.callPy("list_features")) as FeatureDescriptor[];
  }

  async getFeatureSchema(
    featureId: string,
    sourceOid?: string,
  ): Promise<SchemaWithValues | null> {
    return (await this.callPy("get_feature_schema", {
      feature_id: featureId,
      source_oid: sourceOid ?? null,
    })) as SchemaWithValues | null;
  }

  async resolveFeatureChoices(
    featureId: string,
    itemName: string,
    values: Record<string, unknown>,
    sourceOid?: string,
  ): Promise<DynamicChoice[]> {
    return (await this.callPy("resolve_feature_choices", {
      feature_id: featureId,
      item_name: itemName,
      values,
      source_oid: sourceOid ?? null,
    })) as DynamicChoice[];
  }

  async resolveFeatureCallbacks(
    featureId: string,
    itemName: string,
    values: Record<string, unknown>,
    sourceOid?: string,
  ): Promise<Record<string, unknown>> {
    return (await this.callPy("resolve_feature_callbacks", {
      feature_id: featureId,
      item_name: itemName,
      values,
      source_oid: sourceOid ?? null,
    })) as Record<string, unknown>;
  }

  /** Evaluate ``display.active`` for every parameter of *featureId* given
   *  the current *values*. Returns ``{itemName: boolean}`` so the form can
   *  grey out widgets whose enabling condition is unmet (e.g. the
   *  blob-detection ``min_circularity`` gated by ``filter_by_circularity``),
   *  mirroring the Qt UI. */
  async resolveFeatureActive(
    featureId: string,
    values: Record<string, unknown>,
  ): Promise<Record<string, boolean>> {
    return (await this.callPy("resolve_feature_active", {
      feature_id: featureId,
      values,
    })) as Record<string, boolean>;
  }

  /** Counterpart of {@link resolveFeatureActive} for Analysis-menu
   *  features (1→0), which live in a separate Python catalogue. */
  async resolveAnalysisActive(
    kind: "signal" | "image",
    funcId: string,
    values: Record<string, unknown>,
  ): Promise<Record<string, boolean>> {
    return (await this.callPy("resolve_analysis_active", {
      kind,
      func_id: funcId,
      values,
    })) as Record<string, boolean>;
  }

  async applyFeature(
    featureId: string,
    sourceIds: string[],
    operandId: string | null = null,
    params: Record<string, unknown> | null = null,
  ): Promise<string[]> {
    return (await this.callPy("apply_feature", {
      feature_id: featureId,
      source_ids: sourceIds,
      operand_id: operandId,
      params,
    })) as string[];
  }

  // ------------------------------------------------------------------
  // Image-only panel operations (modify selected images in place)
  // ------------------------------------------------------------------

  /** Return the JSON schema + default values for ``GridParam`` (used by
   *  the "Distribute on a grid" dialog). */
  async getImageGridParamSchema(): Promise<SchemaWithValues> {
    return (await this.callPy(
      "get_image_grid_param_schema",
    )) as SchemaWithValues;
  }

  /** Evaluate ``display.active`` for ``GridParam`` items (cols/rows are
   *  gated by the direction radio choice). */
  async resolveImageGridActive(
    values: Record<string, unknown>,
  ): Promise<Record<string, boolean>> {
    return (await this.callPy("resolve_image_grid_active", {
      values,
    })) as Record<string, boolean>;
  }

  /** Lay out *sourceIds* images side-by-side on a grid (in place). */
  async distributeImagesOnGrid(
    sourceIds: string[],
    params: Record<string, unknown> | null = null,
  ): Promise<void> {
    await this.callPy("distribute_images_on_grid", {
      source_ids: sourceIds,
      params,
    });
  }

  /** Re-anchor every image of *sourceIds* on the first image's origin. */
  async resetImagePositions(sourceIds: string[]): Promise<void> {
    await this.callPy("reset_image_positions", { source_ids: sourceIds });
  }

  /** Return the JSON schema + default values for ``ROIGridParam`` (used
   *  by the "Create ROI grid" dialog of the image panel). */
  async getRoiGridParamSchema(): Promise<SchemaWithValues> {
    return (await this.callPy("get_roi_grid_param_schema")) as SchemaWithValues;
  }

  /** Replace the ROI of *oid* with a generated grid of rectangular ROIs.
   *  Returns the refreshed segments so the caller can update its state
   *  in a single round-trip. */
  async createImageRoiGrid(
    oid: string,
    params: Record<string, unknown> | null = null,
  ): Promise<ImageRoiSegment[]> {
    return (await this.callPy("create_image_roi_grid", {
      oid,
      params,
    })) as ImageRoiSegment[];
  }

  // ------------------------------------------------------------------
  // Interactive fitting (Processing > Fitting > Interactive fitting)
  // ------------------------------------------------------------------

  /** List the available interactive fit kinds (linear, gaussian, …). */
  async listInteractiveFits(): Promise<InteractiveFitInfo[]> {
    return (await this.callPy("list_interactive_fits")) as InteractiveFitInfo[];
  }

  /** Initialise an interactive fit on signal *oid* and return the
   *  initial parameter slider values, the bounds, and the fit curve. */
  async initInteractiveFit(
    oid: string,
    fitId: string,
    extras: Record<string, unknown> | null = null,
  ): Promise<InteractiveFitInit> {
    return (await this.callPy("init_interactive_fit", {
      oid,
      fit_id: fitId,
      extras,
    })) as InteractiveFitInit;
  }

  /** Re-evaluate the model at *x* with the user-tweaked *values*.
   *  Called on every slider drag — fast pure-NumPy evaluation. */
  async evaluateInteractiveFit(
    fitId: string,
    x: number[],
    values: Record<string, number>,
    extras: Record<string, unknown> | null = null,
  ): Promise<number[]> {
    return (await this.callPy("evaluate_interactive_fit", {
      fit_id: fitId,
      x,
      values,
      extras,
    })) as number[];
  }

  /** Run the auto-fitter (scipy.optimize.curve_fit) and return the
   *  optimised parameters + the new fit curve. */
  async autoFitInteractive(
    oid: string,
    fitId: string,
    extras: Record<string, unknown> | null = null,
  ): Promise<InteractiveFitAuto> {
    return (await this.callPy("auto_fit_interactive", {
      oid,
      fit_id: fitId,
      extras,
    })) as InteractiveFitAuto;
  }

  /** Commit the current parameter values: add the fitted curve as a
   *  new signal in the same group as *oid*; return the new object id. */
  async commitInteractiveFit(
    oid: string,
    fitId: string,
    values: Record<string, number>,
    extras: Record<string, unknown> | null = null,
  ): Promise<string> {
    return (await this.callPy("commit_interactive_fit", {
      oid,
      fit_id: fitId,
      values,
      extras,
    })) as string;
  }

  async listProcessings(): Promise<ProcessingDescriptor[]> {
    return (await this.callPy("list_processings")) as ProcessingDescriptor[];
  }

  async getProcessingSchema(
    processingId: string,
  ): Promise<SchemaWithValues | null> {
    return (await this.callPy("get_processing_schema", {
      processing_id: processingId,
    })) as SchemaWithValues | null;
  }

  async resolveProcessingChoices(
    processingId: string,
    itemName: string,
    values: Record<string, unknown>,
  ): Promise<DynamicChoice[]> {
    return (await this.callPy("resolve_processing_choices", {
      processing_id: processingId,
      item_name: itemName,
      values,
    })) as DynamicChoice[];
  }

  async applyProcessing(
    id: string,
    processingId: string,
    params?: Record<string, unknown>,
  ): Promise<string> {
    return (await this.callPy("apply_processing", {
      oid: id,
      processing_id: processingId,
      params: params ?? null,
    })) as string;
  }

  /** Return the last processing applied to produce *id*, or ``null``
   *  when the object was created (not produced by a feature) or the
   *  feature is no longer registered.  Drives the "Processing" side
   *  panel tab. */
  async getLastProcessing(id: string): Promise<LastProcessingInfo | null> {
    return (await this.callPy("get_last_processing", {
      oid: id,
    })) as LastProcessingInfo | null;
  }

  /** Re-run the last processing applied to *id* with *values* and
   *  replace its data in place.  Returns the same id. */
  async reapplyLastProcessing(
    id: string,
    values: Record<string, unknown> | null,
  ): Promise<string> {
    return (await this.callPy("reapply_last_processing", {
      oid: id,
      values,
    })) as string;
  }

  // ---------------------------------------------------------------------
  // Plugin system
  // ---------------------------------------------------------------------

  /** Write bundled built-in plugins to a dedicated directory and load them. */
  async installBuiltinPlugins(sources: Record<string, string>): Promise<void> {
    const dir = "/home/pyodide/builtin_plugins";
    this.py.FS.mkdirTree?.(dir);
    for (const [path, source] of Object.entries(sources)) {
      const name = path.split("/").pop() ?? "plugin.py";
      this.py.FS.writeFile(`${dir}/${name}`, source);
    }
    try {
      await this.discoverPluginsInDir(dir);
    } catch (err) {
      console.error("[plugins] failed to load built-in plugins", err);
    }
  }

  async loadPluginSource(
    filename: string,
    source: string,
  ): Promise<PluginRecord> {
    return (await this.callPy("load_plugin_source", {
      filename,
      source,
    })) as PluginRecord;
  }

  async loadPluginFile(path: string): Promise<PluginRecord> {
    return (await this.callPy("load_plugin_file", { path })) as PluginRecord;
  }

  async unloadPlugin(
    name: string,
  ): Promise<{ name: string; removed: boolean }> {
    return (await this.callPy("unload_plugin", { name })) as {
      name: string;
      removed: boolean;
    };
  }

  async reloadPlugins(): Promise<PluginRecord[]> {
    return (await this.callPy("reload_plugins")) as PluginRecord[];
  }

  async discoverPluginsInDir(directory: string): Promise<PluginRecord[]> {
    return (await this.callPy("discover_plugins_in_dir", {
      directory,
    })) as PluginRecord[];
  }

  // ---------------------------------------------------------------------
  // Macro execution (used by the AI Assistant ``create_and_run_macro``
  // tool — keeps a single shared :class:`MacroRuntime` instance to
  // amortise the Pyodide worker cold-start across calls).
  // ---------------------------------------------------------------------

  /** Last buffered output from :meth:`runMacroCode` (or ``null`` if no
   *  macro has run yet through this runtime). Surfaced to the LLM via
   *  the ``get_macro_console_output`` tool — useful when the previous
   *  call truncated its output. */
  lastMacroOutput: {
    stdout: string;
    stderr: string;
    status: "ok" | "error" | "stopped";
    error?: string;
  } | null = null;

  private _macroRuntime: import("./MacroRuntime").MacroRuntime | null = null;

  private async ensureMacroRuntime(): Promise<
    import("./MacroRuntime").MacroRuntime
  > {
    if (this._macroRuntime) return this._macroRuntime;
    const { MacroRuntime } = await import("./MacroRuntime");
    this._macroRuntime = new MacroRuntime(this);
    return this._macroRuntime;
  }

  /** Run *code* as a transient macro and resolve once it completes
   *  with the captured stdout/stderr.  The macro is NOT persisted in
   *  the workspace's macro panel — use :meth:`saveMacro` to register
   *  it on user demand. Output is also stashed in
   *  :prop:`lastMacroOutput` for the ``get_macro_console_output`` tool. */
  async runMacroCode(
    code: string,
    name = "AI Assistant macro",
  ): Promise<{
    stdout: string;
    stderr: string;
    status: "ok" | "error" | "stopped";
    error?: string;
  }> {
    const macro = await this.ensureMacroRuntime();
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      macro
        .run(code, name, {
          onStream: (kind, text) => {
            if (kind === "stdout") stdout += text;
            else if (kind === "stderr") stderr += text;
          },
          onFinished: (status, error) => {
            const out = { stdout, stderr, status, error };
            this.lastMacroOutput = out;
            resolve(out);
          },
        })
        .catch(reject);
    });
  }

  /** Persist *code* in the workspace's macro panel under *name* and
   *  notify open MacroPanel instances so the new entry shows up
   *  immediately. Used by the AI Assistant's "Save to Macros" button
   *  (the user explicitly opts in — macros run via
   *  :meth:`runMacroCode` are otherwise transient). */
  async saveMacro(
    name: string,
    code: string,
  ): Promise<{ id: string; title: string }> {
    const rec = await this.createMacro(name, code);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("dlw:macros-changed", {
          detail: { id: rec.id, title: rec.title },
        }),
      );
    }
    return { id: rec.id, title: rec.title };
  }

  async listPlugins(): Promise<PluginRecord[]> {
    return (await this.callPy("list_plugins")) as PluginRecord[];
  }

  /**
   * List every menu action recorded by plugin shims (one snapshot per call).
   */
  async listPluginMenuActions(): Promise<PluginMenuAction[]> {
    return (await this.runPython(`
from datalab.registries import EXTRA_MENU_ACTIONS
[{
    "action_id": entry.action_id,
    "title": entry.title,
    "menu_path": entry.menu_path,
    "select_condition": entry.select_condition,
    "separator_before": entry.separator_before,
    "icon": entry.icon,
    "tip": entry.tip,
    "origin": entry.origin,
    "object_kind": kind,
} for kind in ("signal", "image") for entry in EXTRA_MENU_ACTIONS[kind]]
`)) as PluginMenuAction[];
  }

  /** Trigger a plugin-supplied menu action by its id.
   *
   * Returns the UUIDs of objects that were newly added to each panel
   * during the action's execution. The desktop `LocalProxy.add_object`
   * implicitly selects the freshly-created object; the browser bridge
   * has no live selection model, so we expose the diff to let the UI
   * select the new objects after a refresh.
   */
  async triggerPluginAction(
    actionId: string,
  ): Promise<{ signal: string[]; image: string[] }> {
    const result = (await this.py.runPythonAsync(`
import inspect
from datalab.registries import EXTRA_MENU_ACTIONS
from dlw_main import WebMainBridge as _WMB
_bridge = _WMB()
_target = None
for _kind in ("signal", "image"):
    for _entry in EXTRA_MENU_ACTIONS[_kind]:
        if _entry.action_id == ${JSON.stringify(actionId)}:
            _target = _entry
            break
    if _target is not None:
        break
if _target is None:
    raise KeyError("Unknown plugin action: ${actionId}")
_before = {k: set(_bridge.get_object_uuids(k)) for k in ("signal", "image")}
_result = _target.triggered()
if inspect.isawaitable(_result):
    await _result
_after = {k: list(_bridge.get_object_uuids(k)) for k in ("signal", "image")}
{k: [oid for oid in _after[k] if oid not in _before[k]] for k in ("signal", "image")}
`)) as unknown;
    // Pyodide returns a PyProxy for dict; convert to plain object via toJs.
    if (
      result &&
      typeof (result as { toJs?: () => unknown }).toJs === "function"
    ) {
      const obj = (result as { toJs: (opts: unknown) => unknown }).toJs({
        dict_converter: Object.fromEntries,
      });
      (result as { destroy?: () => void }).destroy?.();
      return obj as { signal: string[]; image: string[] };
    }
    return result as { signal: string[]; image: string[] };
  }

  // ---------------------------------------------------------------------
  // Macros (mirrors DataLab Qt's MacroPanel state).
  // ---------------------------------------------------------------------

  async listMacros(): Promise<MacroMeta[]> {
    return (await this.callPy("list_macros")) as MacroMeta[];
  }

  async getMacro(macroId: string): Promise<MacroRecord> {
    return (await this.callPy("get_macro", {
      macro_id: macroId,
    })) as MacroRecord;
  }

  async createMacro(
    title?: string,
    code?: string,
    options: { silent?: boolean } = {},
  ): Promise<MacroRecord> {
    return (await this.callPy(
      "create_macro",
      {
        title: title ?? null,
        code: code ?? null,
      },
      options,
    )) as MacroRecord;
  }

  async setMacroCode(macroId: string, code: string): Promise<void> {
    await this.callPy("set_macro_code", { macro_id: macroId, code });
  }

  /** Statically lint *code* against the proxy API surface. */
  async lintMacro(code: string): Promise<MacroLintResult> {
    return (await this.callPy("lint_macro", { code })) as MacroLintResult;
  }

  async renameMacro(macroId: string, title: string): Promise<void> {
    await this.callPy("rename_macro", { macro_id: macroId, title });
  }

  async deleteMacro(macroId: string): Promise<void> {
    await this.callPy("delete_macro", { macro_id: macroId });
  }

  async duplicateMacro(macroId: string): Promise<MacroRecord> {
    return (await this.callPy("duplicate_macro", {
      macro_id: macroId,
    })) as MacroRecord;
  }

  async reorderMacros(macroIds: string[]): Promise<void> {
    await this.callPy("reorder_macros", { macro_ids: macroIds });
  }

  async replaceMacros(
    records: MacroRecord[],
    options: { silent?: boolean } = {},
  ): Promise<void> {
    await this.callPy("replace_macros", { records }, options);
  }

  // ---------------------------------------------------------------------
  // Notebooks (mirror of the macro API — see above).
  //
  // Notebooks are stored on the Python side as opaque nbformat v4.5
  // JSON strings; Python never parses them.  This keeps ``bootstrap.py``
  // schema-agnostic and lets the JS notebook UI remain the sole owner
  // of the nbformat representation.
  // ---------------------------------------------------------------------

  async listNotebooks(): Promise<NotebookMeta[]> {
    return (await this.callPy("list_notebooks")) as NotebookMeta[];
  }

  async getNotebook(notebookId: string): Promise<NotebookRecord> {
    return (await this.callPy("get_notebook", {
      notebook_id: notebookId,
    })) as NotebookRecord;
  }

  async createNotebook(
    title?: string,
    content?: string,
    options: { silent?: boolean } = {},
  ): Promise<NotebookRecord> {
    return (await this.callPy(
      "create_notebook",
      {
        title: title ?? null,
        content: content ?? null,
      },
      options,
    )) as NotebookRecord;
  }

  async setNotebookContent(notebookId: string, content: string): Promise<void> {
    await this.callPy("set_notebook_content", {
      notebook_id: notebookId,
      content,
    });
  }

  async renameNotebook(notebookId: string, title: string): Promise<void> {
    await this.callPy("rename_notebook", { notebook_id: notebookId, title });
  }

  async deleteNotebook(notebookId: string): Promise<void> {
    await this.callPy("delete_notebook", { notebook_id: notebookId });
  }

  async duplicateNotebook(notebookId: string): Promise<NotebookRecord> {
    return (await this.callPy("duplicate_notebook", {
      notebook_id: notebookId,
    })) as NotebookRecord;
  }

  async reorderNotebooks(notebookIds: string[]): Promise<void> {
    await this.callPy("reorder_notebooks", { notebook_ids: notebookIds });
  }

  async replaceNotebooks(records: NotebookRecord[]): Promise<void> {
    await this.callPy("replace_notebooks", { records });
  }

  // ---------------------------------------------------------------------
  // Debug helpers (use from the browser DevTools console — see README).
  // ---------------------------------------------------------------------

  /** Run an arbitrary Python snippet and return its result as a JS value. */
  async runPython(code: string): Promise<unknown> {
    return toJs(await this.py.runPythonAsync(code));
  }

  /**
   * Resolve the versions actually installed in the live Pyodide instance.
   *
   * Reads ``importlib.metadata.version`` for each requested package and
   * returns a ``{ name: version | null }`` map (``null`` when the package
   * is not importable). This is the **ground-truth** counterpart to the
   * network-based shim audit (``tests/ts/shims/shim-audit.spec.ts``),
   * which infers versions from PyPI / the Pyodide lockfile without booting
   * Pyodide. Useful for diagnostics (About dialog, bug reports) and for an
   * end-to-end audit probe.
   *
   * @param packages Package names to query; defaults to the packages
   *  tracked by the shim registry (``guidata``, ``sigima``, ``numpy``,
   *  ``scipy``, ``h5py``).
   */
  async getInstalledVersions(
    packages: readonly string[] = Object.keys(PACKAGE_VERSION_SOURCES),
  ): Promise<Record<string, string | null>> {
    const names = JSON.stringify([...packages]);
    const result = await this.py.runPythonAsync(`
import json
from importlib.metadata import version, PackageNotFoundError

def _resolve(_names):
    out = {}
    for _name in _names:
        try:
            out[_name] = version(_name)
        except PackageNotFoundError:
            out[_name] = None
    return out

json.dumps(_resolve(json.loads(${JSON.stringify(names)})))
`);
    return JSON.parse(result as string) as Record<string, string | null>;
  }

  /**
   * Re-execute the bootstrap source against the live Pyodide instance.
   *
   * Useful when iterating on the Python side without paying the 30-second
   * Pyodide cold-start again.  The in-memory ``_STORE`` is preserved if the
   * new bootstrap leaves it untouched (e.g. you only changed a helper).
   */
  async reloadBootstrap(source: string = bootstrapSource): Promise<void> {
    await this.py.runPythonAsync(source);
    console.info("[runtime] bootstrap.py re-executed (store preserved)");
  }

  /**
   * Update ``dlw_processor`` in Pyodide's filesystem and ask the live
   * bootstrap to refresh its catalogue.  Called by the Python HMR handler
   * when ``processor.py`` is edited.
   */
  async reloadProcessor(source: string = processorSource): Promise<void> {
    this.py.FS.writeFile("/home/pyodide/dlw_processor.py", source);
    await this.py.runPythonAsync(`
import importlib
import dlw_processor
importlib.reload(dlw_processor)
import sys
if "__main__" in sys.modules:
    pass
# Refresh the bootstrap-side catalog reference in-place.
_CATALOG.clear()
_CATALOG.update(dlw_processor.build_signal_catalog())
`);
    console.info("[runtime] dlw_processor.py reloaded; catalog refreshed");
  }

  /**
   * Read the current memory footprint of the runtime.
   *
   * The headline figure is the Pyodide **WASM linear-heap** size
   * (``_module.HEAPU8.length``), available in every browser and the
   * best predictor of an out-of-memory crash. On Chromium we also
   * surface the JS heap via ``performance.memory`` (``null`` elsewhere).
   *
   * Pure synchronous reads — this does **not** go through the Python
   * call queue, so it is safe to poll on a timer without serialising
   * behind in-flight computations.
   */
  getMemoryUsage(): MemoryUsage {
    const wasmBytes = readWasmHeapBytes(this.py._module);
    const { jsUsedBytes, jsLimitBytes } = readJsMemory();
    return { wasmBytes, dataBytes: null, jsUsedBytes, jsLimitBytes };
  }

  /**
   * Read the total byte size of the signal/image arrays currently held
   * by the object model. Unlike the WASM heap this responds to deletes,
   * so the indicator can show the user that clearing objects had an
   * effect. Routed through the Python call queue (cheap O(n) sum, no
   * data copy); returns ``null`` if the runtime cannot report it.
   */
  async getDataMemoryBytes(): Promise<number | null> {
    try {
      const r = (await this.callPy("get_data_memory")) as {
        data_bytes?: number;
      };
      return typeof r?.data_bytes === "number" ? r.data_bytes : null;
    } catch {
      return null;
    }
  }

  /**
   * Run a full Python garbage-collection pass and report its effect.
   *
   * The WASM heap never shrinks back to the OS, so the goal is not to
   * lower ``wasmBytes`` but to drop dangling Python references so later
   * allocations reuse freed heap pages instead of growing the heap.
   * Returns the WASM heap size before/after plus the object counts and
   * the number of unreachable objects reclaimed by ``gc.collect``.
   */
  async freeMemory(): Promise<FreeMemoryResult> {
    const wasmBefore = this.getMemoryUsage().wasmBytes;
    const result = (await this.callPy("collect_garbage")) as {
      collected: number;
      objects_before: number;
      objects_after: number;
    };
    const wasmAfter = this.getMemoryUsage().wasmBytes;
    return { ...result, wasmBefore, wasmAfter };
  }
}
