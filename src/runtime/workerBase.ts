/**
 * Shared plumbing for the DataLab-Web Pyodide workers.
 *
 * Both the macro worker (``macroWorker.ts``) and the notebook worker
 * (``notebookWorker.ts``) boot a dedicated Pyodide instance, install the
 * Sigima/guidata stack via ``micropip``, expose a ``postMessage`` bridge
 * back to the main thread, and install the ``proxy`` global. That
 * boilerplate is identical between the two; only the execution model
 * (single block vs. per-cell with rich display) differs. This module
 * factors out the common pieces so a fix applied here benefits both.
 *
 * The worker files themselves must remain standalone entry points so
 * Vite can resolve ``new Worker(new URL("./xxxWorker.ts", import.meta.url))``.
 */
import {
  loadConfiguredPyodide,
  pythonWheelInstallCode,
  type ResolvedRuntimeConfig,
  type RuntimeKind,
} from "./runtimeConfig";

/** Minimal slice of the Pyodide API surface used by the workers. */
export interface PyodideAPI {
  runPythonAsync: (code: string) => Promise<unknown>;
  loadPackage: (names: string | string[]) => Promise<void>;
  globals: {
    set: (name: string, value: unknown) => void;
    get: (name: string) => unknown;
  };
  FS: {
    writeFile: (path: string, data: string) => void;
    mkdirTree?: (path: string) => void;
  };
  setStdout: (opts: {
    batched?: (s: string) => void;
    raw?: (c: number) => void;
  }) => void;
  setStderr: (opts: {
    batched?: (s: string) => void;
    raw?: (c: number) => void;
  }) => void;
}

/** A bridge call awaiting its main-thread reply. */
export interface PendingReply {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

/** The subset of the worker global scope used by the shared bridge. */
export interface DLWWorkerScope {
  _dlw_bridge_call?: (method: string, payload: unknown) => Promise<unknown>;
  _dlw_pending_replies?: Map<string, PendingReply>;
}

/**
 * Boot a fresh Pyodide instance with the shared boot sequence:
 * pin the UI locale, load the base packages, ``micropip``-install
 * Sigima + guidata, then install Sigima's placeholder title formatter.
 *
 * The caller finishes the worker-specific setup (stdout patching,
 * extra Python helpers) on the returned instance.
 */
export async function bootPyodide(opts: {
  lang: string;
  runtimeConfig: ResolvedRuntimeConfig;
  runtimeKind: Exclude<RuntimeKind, "main">;
  titleFormatSource: string;
}): Promise<PyodideAPI> {
  const py = (await loadConfiguredPyodide(opts.runtimeConfig)) as PyodideAPI;

  // Pin ``LANG`` before any guidata/sigima import so gettext-wrapped
  // labels match the main thread's UI locale (``C`` = English, or e.g.
  // ``fr``). Workers cannot read ``localStorage``; the locale arrives via
  // the ``init`` message. See ``runtime.ts`` for the rationale.
  await py.runPythonAsync(`
import os
os.environ["LANG"] = ${JSON.stringify(opts.lang)}
os.environ["LANGUAGE"] = ${JSON.stringify(opts.lang)}
`);

  await py.loadPackage(opts.runtimeConfig.pyodidePackages[opts.runtimeKind]);

  // Install Sigima + guidata so user code can ``import sigima`` and
  // ``import guidata.dataset`` exactly as in DataLab desktop. This adds
  // ~10-30s to the first run; subsequent runs reuse the same worker.
  // Exact wheels come from the shared manifest. The offline distribution
  // includes their complete dependency closure and therefore uses
  // ``deps=False``; online mode retains public dependency resolution.
  await py.runPythonAsync(pythonWheelInstallCode(opts.runtimeConfig));

  // Install Sigima's ``PlaceholderTitleFormatter`` so titles produced in
  // the worker use the same placeholder format as the main runtime
  // (later resolved to source ``oid``s by the main bootstrap).
  py.FS.writeFile("/home/pyodide/dlw_title_format.py", opts.titleFormatSource);
  await py.runPythonAsync(opts.titleFormatSource);

  return py;
}

/**
 * Install the ``_dlw_bridge_call`` mechanism on the worker scope: Python
 * calls ``js._dlw_bridge_call(method, payload)`` and awaits the Promise,
 * which resolves when the main thread posts back a ``bridge_reply``.
 */
export function installBridge(
  scope: DLWWorkerScope,
  post: (msg: unknown) => void,
): void {
  scope._dlw_pending_replies = new Map();
  let nextId = 0;
  scope._dlw_bridge_call = (method: string, payload: unknown) => {
    const id = `b${++nextId}`;
    return new Promise((resolve, reject) => {
      scope._dlw_pending_replies!.set(id, { resolve, reject });
      post({ type: "bridge_call", id, method, payload });
    });
  };
}

/** Resolve (or reject) the pending bridge call matching ``msg.id``. */
export function resolveBridgeReply(
  scope: DLWWorkerScope,
  msg: { id: string; ok: boolean; value?: unknown; error?: string },
): void {
  const pending = scope._dlw_pending_replies?.get(msg.id);
  if (!pending) return;
  scope._dlw_pending_replies!.delete(msg.id);
  if (msg.ok) pending.resolve(msg.value);
  else pending.reject(new Error(msg.error ?? "bridge call failed"));
}

/**
 * Install the Python ``proxy`` global by executing ``macro_proxy.py``.
 * Also persists it to the FS so user code can ``import macro_proxy``.
 */
export async function installProxyGlobal(
  py: PyodideAPI,
  source: string,
): Promise<void> {
  try {
    py.FS.writeFile("/home/pyodide/macro_proxy.py", source);
  } catch {
    /* /home/pyodide may not exist on every Pyodide build — ignore. */
  }
  await py.runPythonAsync(source);
}
