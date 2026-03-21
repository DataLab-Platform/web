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
  toJs?: (opts?: { dict_converter?: (entries: Iterable<[unknown, unknown]>) => unknown }) => unknown;
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

export interface SignalData extends SignalMeta {
  x: number[];
  y: number[];
}

export interface ProcessingDescriptor {
  id: string;
  label: string;
  has_params: boolean;
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
  object_kind: string;
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

/** Diagnostic info returned by ``loadProject``. */
export interface ProjectLoadResult {
  signals: number;
  groups: number;
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
 *  :meth:`SigimaRuntime.getObjectStats`. */
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
 *  :meth:`SigimaRuntime.listObjectMetadata`). */
export interface MetadataEntry {
  key: string;
  value_type: MetadataValueType;
  value: string;
}

/** One entry of the "Create" menu, returned by
 *  :meth:`SigimaRuntime.listSignalCreationTypes`. */
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
 *  :meth:`SigimaRuntime.listSignalIoFormats`. */
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

/** Convert a PyProxy result into a plain JS value (recursively). */
function toJs(value: unknown): unknown {
  if (value && typeof value === "object" && "toJs" in value) {
    const proxy = value as PyProxy;
    const result = proxy.toJs?.({
      dict_converter: (entries) => Object.fromEntries(entries as Iterable<[string, unknown]>),
    });
    proxy.destroy?.();
    return result;
  }
  return value;
}

export class SigimaRuntime {
  private constructor(private readonly py: PyodideAPI) {}

  static async load(onProgress?: (msg: string) => void): Promise<SigimaRuntime> {
    if (typeof window.loadPyodide !== "function") {
      throw new Error(
        "Pyodide failed to load from the CDN. Check the browser console " +
          "and your network / Content-Security-Policy settings.",
      );
    }
    onProgress?.("Loading Pyodide runtime…");
    const py = await window.loadPyodide({ indexURL: PYODIDE_INDEX });

    onProgress?.("Loading scientific stack (numpy, scipy)…");
    await py.loadPackage(["numpy", "scipy", "micropip"]);

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
    SigimaRuntime.installShim(py, shimSources);
    // Make ``processor.py``/``dlw_main.py``/``dlw_plugins.py`` importable.
    py.FS.writeFile("/home/pyodide/dlw_processor.py", processorSource);
    py.FS.writeFile("/home/pyodide/dlw_main.py", dlwMainSource);
    py.FS.writeFile("/home/pyodide/dlw_plugins.py", dlwPluginsSource);
    await py.runPythonAsync(bootstrapSource);

    onProgress?.("Ready.");
    const runtime = new SigimaRuntime(py);
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
      const py = (payload as { toJs?: (opts?: unknown) => unknown }).toJs;
      const data = typeof py === "function"
        ? py.call(payload, { dict_converter: Object.fromEntries })
        : payload;
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
  private dialogHandler: ((kind: string, payload: unknown) => Promise<unknown>) | null = null;

  setDialogHandler(
    handler: ((kind: string, payload: unknown) => Promise<unknown>) | null,
  ): void {
    this.dialogHandler = handler;
  }

  /** Call a Python function declared in bootstrap.py with keyword args. */
  private async callPy(name: string, kwargs: Record<string, unknown> = {}): Promise<unknown> {
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
      return toJs(awaited);
    } catch (err) {
      console.error(`[sigima] ${name} failed`, err);
      throw err;
    } finally {
      fn.destroy?.();
    }
  }

  async createSignal(params: SignalCreationParams): Promise<string> {
    const id = (await this.callPy("create_signal", params as unknown as Record<string, unknown>)) as string;
    return id;
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
  async clearSignalResults(
    id: string,
    metadataKey?: string,
  ): Promise<number> {
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

  async deleteSignal(id: string): Promise<void> {
    await this.callPy("delete_signal", { oid: id });
  }

  // ------------------------------------------------------------------
  // Object model (groups + objects per panel kind)
  // ------------------------------------------------------------------

  async getPanelTree(kind: PanelKind = "signal"): Promise<PanelTree> {
    return (await this.callPy("get_panel_tree", { kind })) as PanelTree;
  }

  async createGroup(kind: PanelKind = "signal", name?: string): Promise<string> {
    return (await this.callPy("create_group", {
      kind,
      name: name ?? null,
    })) as string;
  }

  async renameGroup(gid: string, name: string, kind: PanelKind = "signal"): Promise<void> {
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

  // ------------------------------------------------------------------
  // Signal ROI (Phase 5)
  // ------------------------------------------------------------------

  async getSignalRoi(oid: string): Promise<SignalRoiSegment[]> {
    return (await this.callPy("get_signal_roi", { oid })) as SignalRoiSegment[];
  }

  async setSignalRoi(
    oid: string,
    segments: SignalRoiSegment[],
  ): Promise<void> {
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
  // Project save / load + CSV I/O (Phase 6)
  // ------------------------------------------------------------------

  async saveProject(): Promise<string> {
    return (await this.callPy("save_project")) as string;
  }

  async loadProject(content: string, replace: boolean = true): Promise<ProjectLoadResult> {
    return (await this.callPy("load_project", {
      content,
      replace,
    })) as ProjectLoadResult;
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
    return (await this.callPy("list_image_creation_types")) as ImageCreationType[];
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

  async setImageRoi(
    oid: string,
    segments: ImageRoiSegment[],
  ): Promise<void> {
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

  async clearImageResults(
    id: string,
    metadataKey?: string,
  ): Promise<number> {
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

  async listProcessings(): Promise<ProcessingDescriptor[]> {
    return (await this.callPy("list_processings")) as ProcessingDescriptor[];
  }

  async getProcessingSchema(processingId: string): Promise<SchemaWithValues | null> {
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

  // ---------------------------------------------------------------------
  // Plugin system
  // ---------------------------------------------------------------------

  /** Write bundled built-in plugins to a dedicated directory and load them. */
  async installBuiltinPlugins(
    sources: Record<string, string>,
  ): Promise<void> {
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

  async unloadPlugin(name: string): Promise<{ name: string; removed: boolean }> {
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
    console.info("[sigima] bootstrap.py re-executed (store preserved)");
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
    console.info("[sigima] dlw_processor.py reloaded; catalog refreshed");
  }
}
