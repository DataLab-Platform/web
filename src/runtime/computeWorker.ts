/// <reference lib="webworker" />
/**
 * DataLab-Web **compute worker** — a disposable Pyodide instance whose only
 * job is to run a single Sigima computation on *serialised* inputs so it can
 * be cancelled by terminating the worker.
 *
 * Why a separate worker (see {@link computeProtocol} for the full rationale):
 * interrupting a single long, un-chunkable C call (e.g. a moving median on a
 * 1024×1024 image) is impossible cooperatively, and ``setInterruptBuffer``
 * needs a ``SharedArrayBuffer`` (→ COOP/COEP → breaks plain static hosting).
 * Running the call here and calling ``Worker.terminate()`` to cancel keeps the
 * kernel worker (which owns the object model) untouched and needs no special
 * headers — the browser analogue of the desktop "separate process" option.
 *
 * The worker is a thin RPC server: boot once, then for each ``run`` request
 * evaluate :func:`processor.run_feature_serialized` and post the serialised
 * results back. It holds **no** workspace state.
 *
 * It must stay a standalone entry point so Vite can resolve
 * ``new Worker(new URL("./computeWorker.ts", import.meta.url))``.
 */
import { bootPyodide, type PyodideAPI } from "./workerBase";
import processorSource from "./processor.py?raw";
import dlwTitleFormatSource from "./dlw_title_format.py?raw";
// Same JSON-Schema / backends shims as the main runtime — required so
// ``guidata.dataset`` (imported by ``processor.py``) exposes the schema
// helpers and loads cleanly under Pyodide. See runtime.ts / macroWorker.ts.
import guidataJsonSchemaShim from "./_guidata_jsonschema_shim.py?raw";
import type { ComputeEvent, ComputeRequest } from "./computeProtocol";

const guidataBackendsSource = (() => {
  const candidates = import.meta.glob("./_guidata_backends_shim.py", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
  return Object.values(candidates)[0] ?? null;
})();

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(event: ComputeEvent): void {
  ctx.postMessage(event);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let pyPromise: Promise<PyodideAPI> | null = null;
// ``LANG`` for the Pyodide boot; overridden by the ``init`` message so the
// compute worker's gettext-wrapped Sigima labels match the UI locale.
let pyLang = "C";

/** Boot Pyodide + Sigima and build the feature catalogue (once). */
async function getPyodide(): Promise<PyodideAPI> {
  if (pyPromise) return pyPromise;
  pyPromise = (async () => {
    post({ type: "progress", message: "Starting compute worker…" });
    const py = await bootPyodide({
      lang: pyLang,
      packages: ["numpy", "scipy", "h5py", "micropip"],
      titleFormatSource: dlwTitleFormatSource,
    });
    await py.runPythonAsync(guidataJsonSchemaShim);
    if (guidataBackendsSource) {
      await py.runPythonAsync(guidataBackendsSource);
    }
    // Make ``processor.py`` importable under the same name the kernel uses
    // (``dlw_processor``), then build the catalogue once. The catalogue
    // resolves ``feature_id`` → Sigima callable, so a feature maps to the
    // same computation on either side of the worker boundary.
    py.FS.writeFile("/home/pyodide/dlw_processor.py", processorSource);
    await py.runPythonAsync(`
import json as _json
import dlw_processor as _proc

_CATALOG = _proc.build_full_catalog()


def _dlw_run_feature(payload_json):
    """Run a feature described by a JSON payload, return JSON results."""
    p = _json.loads(payload_json)
    items = _proc.run_feature_serialized(
        _CATALOG,
        p["featureId"],
        list(p["sourceIds"]),
        list(p["sourcesB64"]),
        p.get("params"),
        p.get("operandB64"),
    )
    return _json.dumps(items)
`);
    return py;
  })();
  return pyPromise;
}

async function handleRun(req: Extract<ComputeRequest, { type: "run" }>) {
  try {
    const py = await getPyodide();
    const payload = JSON.stringify({
      featureId: req.featureId,
      sourceIds: req.sourceIds,
      sourcesB64: req.sourcesB64,
      params: req.params,
      operandB64: req.operandB64,
    });
    py.globals.set("_dlw_payload", payload);
    const resultJson = (await py.runPythonAsync(
      "_dlw_run_feature(_dlw_payload)",
    )) as string;
    const items = JSON.parse(resultJson);
    post({ type: "result", id: req.id, ok: true, items });
  } catch (err) {
    post({ type: "result", id: req.id, ok: false, error: errMessage(err) });
  }
}

ctx.onmessage = (ev: MessageEvent<ComputeRequest>) => {
  const msg = ev.data;
  if (msg.type === "init") {
    pyLang = msg.lang || "C";
    getPyodide().then(
      () => post({ type: "ready" }),
      (err) => post({ type: "boot-error", error: errMessage(err) }),
    );
  } else if (msg.type === "run") {
    void handleRun(msg);
  }
};

// Surface async errors that escape ``onmessage`` so the client doesn't hang.
ctx.onerror = (event: Event | string): boolean => {
  const text =
    typeof event === "string"
      ? event
      : ((event as ErrorEvent).message ?? "compute worker error");
  post({ type: "boot-error", error: text });
  return false;
};
