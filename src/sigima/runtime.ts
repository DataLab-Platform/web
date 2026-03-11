/**
 * Pyodide loader for DataLab-Web.
 *
 * This module owns the single Pyodide instance and the Sigima Python
 * namespace.  All calls into Python go through a tiny typed wrapper so the
 * rest of the codebase never touches the Pyodide API directly.
 */

import bootstrapSource from "./bootstrap.py?raw";
import processorSource from "./processor.py?raw";
// Until the released ``guidata`` ships the new JSON Schema helpers, we
// pre-load a copy of ``guidata/dataset/jsonschema.py`` and let it
// monkey-patch the ``guidata.dataset`` namespace.
import guidataJsonSchemaShim from "./_guidata_jsonschema_shim.py?raw";

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

/** Image data payload returned by ``get_image_data`` (Phase 7). */
export interface ImageData {
  id: string;
  title: string;
  width: number;
  height: number;
  data: number[][];
  xlabel: string;
  ylabel: string;
  xunit: string;
  yunit: string;
}

/** Parameters for the synthetic image creator (Phase 7 spike). */
export interface ImageCreationParams {
  kind: "gauss" | "ramp" | "random";
  title: string;
  width: number;
  height: number;
  a?: number;
  sigma?: number;
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

/** One entry of the "Create" menu, returned by
 *  :meth:`SigimaRuntime.listSignalCreationTypes`. */
export interface SignalCreationType {
  /** Stable id (matches a ``SignalTypes`` enum value on the Python side). */
  value: string;
  /** Translated, human-readable label. */
  label: string;
  /** Icon hint (frontend may map this to an SVG / unicode glyph). */
  icon: string;
  /** Submenu category: ``"Waveform"`` | ``"Peak"`` | ``"Noise"`` | ``"Other"``. */
  category: string;
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
    // Make ``processor.py`` importable from bootstrap.py via Pyodide's FS.
    py.FS.writeFile("/home/pyodide/dlw_processor.py", processorSource);
    await py.runPythonAsync(bootstrapSource);

    onProgress?.("Ready.");
    return new SigimaRuntime(py);
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
  // Image panel (Phase 7 spike)
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
