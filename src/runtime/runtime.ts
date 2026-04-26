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
// Until the released ``guidata`` ships the new JSON Schema helpers, we
// pre-load a copy of ``guidata/dataset/jsonschema.py`` and let it
// monkey-patch the ``guidata.dataset`` namespace.
import guidataJsonSchemaShim from "./_guidata_jsonschema_shim.py?raw";

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

// Pyodide is loaded from a CDN <script> tag in index.html; declare its global.
declare global {
  interface Window {
    loadPyodide: (opts: { indexURL: string }) => Promise<PyodideAPI>;
  }
}

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
  data: number[][];
  dtype: string;
  /** Pixel origin (top-left corner) and pixel spacing. */
  x0: number;
  y0: number;
  dx: number;
  dy: number;
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

export class DataLabRuntime {
  private constructor(private readonly py: PyodideAPI) {}

  static async load(
    onProgress?: (msg: string) => void,
  ): Promise<DataLabRuntime> {
    if (typeof window.loadPyodide !== "function") {
      throw new Error(
        "Pyodide failed to load from the CDN. Check the browser console " +
          "and your network / Content-Security-Policy settings.",
      );
    }
    onProgress?.("Loading Pyodide runtime…");
    const py = await window.loadPyodide({ indexURL: PYODIDE_INDEX });

    // ---------------------------------------------------------------
    // Pin the Pyodide locale to ``C`` *before* any ``guidata`` /
    // ``sigima`` import.
    //
    // Why: Sigima exposes user-facing labels (e.g. ``SignalTypes`` /
    // ``ImageTypes`` enum entries shown in the ``Create`` menu, plus
    // processing labels and parameter labels) wrapped in ``gettext
    // _()``. ``guidata.configtools.get_translation`` falls back to the
    // browser's locale via ``get_system_lang()`` when ``LANG`` is
    // unset, so a French-locale browser would surface translated
    // labels while the rest of the React UI is English-only — see the
    // "Internationalisation" section of ``README.md``.
    //
    // Setting ``LANG=C`` (POSIX "no translation" locale) forces
    // gettext to return the original ``msgid`` strings (English), which
    // matches the rest of the UI. ``LANGUAGE`` is also unset to defeat
    // GNU gettext's higher-priority override.
    //
    // This MUST run before ``loadPackage``/``micropip.install`` of
    // ``guidata`` and before any ``runPythonAsync`` that touches the
    // guidata shims, otherwise the translation object is cached at
    // import time and the language change comes too late.
    // ---------------------------------------------------------------
    await py.runPythonAsync(`
import os
os.environ["LANG"] = "C"
os.environ["LANGUAGE"] = "C"
`);

    onProgress?.("Loading scientific stack (numpy, scipy, h5py)…");
    await py.loadPackage(["numpy", "scipy", "h5py", "micropip"]);

    onProgress?.("Installing Sigima…");
    await py.runPythonAsync(`
import micropip
await micropip.install(["sigima", "guidata"])
`);

    onProgress?.("Initialising Sigima namespace…");
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
    await py.runPythonAsync(bootstrapSource);

    onProgress?.("Ready.");
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
      // ``payload`` may be a Python proxy: convert to plain JS *and* destroy
      // the proxy to avoid leaking PyProxy instances on every dialog call.
      const proxy = payload as PyProxy | null | undefined;
      const hasToJs = typeof proxy?.toJs === "function";
      let data: unknown = payload;
      try {
        if (hasToJs) {
          data = proxy!.toJs!({
            dict_converter: (entries) =>
              Object.fromEntries(entries as Iterable<[string, unknown]>),
          });
        }
      } finally {
        if (hasToJs) {
          proxy!.destroy?.();
        }
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

  /** Call a Python function declared in bootstrap.py with keyword args. */
  private async callPy<T = unknown>(
    name: string,
    kwargs: Record<string, unknown> = {},
  ): Promise<T> {
    const doCall = async (): Promise<T> => {
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
        const awaited = result instanceof Promise ? await result : result;
        return toJs(awaited) as T;
      } catch (err) {
        console.error(`[runtime] ${name} failed`, err);
        throw err;
      } finally {
        fn.destroy?.();
      }
    };
    const next = this._queue.then(doCall, doCall);
    // Keep the chain alive even if this call rejects.
    this._queue = next.catch(() => undefined);
    return next;
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
    xdata: number[];
    ydata: number[];
    xunit?: string;
    yunit?: string;
    xlabel?: string;
    ylabel?: string;
    group_id?: string | null;
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
    data: number[][];
    xunit?: string;
    yunit?: string;
    zunit?: string;
    xlabel?: string;
    ylabel?: string;
    zlabel?: string;
    group_id?: string | null;
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

  async listSignals(): Promise<SignalMeta[]> {
    return (await this.callPy("list_signals")) as SignalMeta[];
  }

  async getSignalData(id: string): Promise<SignalData> {
    return (await this.callPy("get_signal_xy", { oid: id })) as SignalData;
  }

  /** Batched fetch for multi-signal overlay.  Returns one entry per
   *  resolved id (unknown ids are silently skipped server-side). */
  async getSignalsData(ids: string[]): Promise<SignalData[]> {
    if (ids.length === 0) return [];
    return (await this.callPy("get_signals_xy", {
      oids: ids,
    })) as SignalData[];
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

  async moveObject(oid: string, targetGroupId: string): Promise<void> {
    await this.callPy("move_object", { oid, target_group_id: targetGroupId });
  }

  async deleteObject(oid: string): Promise<void> {
    await this.callPy("delete_object", { oid });
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
   *  When *replace* is true (default), the current model is wiped first. */
  async openWorkspaceHdf5(
    filename: string,
    bytes: Uint8Array,
    replace: boolean = true,
  ): Promise<WorkspaceLoadResult> {
    return (await this.callPy("open_workspace_from_bytes", {
      filename,
      data: bytes,
      replace,
    })) as WorkspaceLoadResult;
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
    return (await this.callPy("get_image_data", { oid })) as ImageData;
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

  async getFeatureSchema(featureId: string): Promise<SchemaWithValues | null> {
    return (await this.callPy("get_feature_schema", {
      feature_id: featureId,
    })) as SchemaWithValues | null;
  }

  async resolveFeatureChoices(
    featureId: string,
    itemName: string,
    values: Record<string, unknown>,
  ): Promise<DynamicChoice[]> {
    return (await this.callPy("resolve_feature_choices", {
      feature_id: featureId,
      item_name: itemName,
      values,
    })) as DynamicChoice[];
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

  /** Trigger a plugin-supplied menu action by its id. */
  async triggerPluginAction(actionId: string): Promise<void> {
    await this.py.runPythonAsync(`
import inspect
from datalab.registries import EXTRA_MENU_ACTIONS
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
_result = _target.triggered()
if inspect.isawaitable(_result):
    await _result
`);
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

  async createMacro(title?: string, code?: string): Promise<MacroRecord> {
    return (await this.callPy("create_macro", {
      title: title ?? null,
      code: code ?? null,
    })) as MacroRecord;
  }

  async setMacroCode(macroId: string, code: string): Promise<void> {
    await this.callPy("set_macro_code", { macro_id: macroId, code });
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

  async replaceMacros(records: MacroRecord[]): Promise<void> {
    await this.callPy("replace_macros", { records });
  }

  // ---------------------------------------------------------------------
  // Debug helpers (use from the browser DevTools console — see README).
  // ---------------------------------------------------------------------

  /** Run an arbitrary Python snippet and return its result as a JS value. */
  async runPython(code: string): Promise<unknown> {
    return toJs(await this.py.runPythonAsync(code));
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
}
