/**
 * Pyodide loader for DataLab-Web.
 *
 * This module owns the single Pyodide instance and the Sigima Python
 * namespace.  All calls into Python go through a tiny typed wrapper so the
 * rest of the codebase never touches the Pyodide API directly.
 */

import bootstrapSource from "./bootstrap.py?raw";
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

  async listSignals(): Promise<SignalMeta[]> {
    return (await this.callPy("list_signals")) as SignalMeta[];
  }

  async getSignalData(id: string): Promise<SignalData> {
    return (await this.callPy("get_signal_xy", { oid: id })) as SignalData;
  }

  async deleteSignal(id: string): Promise<void> {
    await this.callPy("delete_signal", { oid: id });
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
}
