/**
 * Feature flag for the cancellable compute-worker processing path.
 *
 * Running a processing in a separate, disposable compute worker
 * ({@link ComputeWorkerClient}) lets us cancel it by terminating that worker —
 * but the worker boots a **second full Pyodide instance** (numpy / scipy /
 * pandas / sigima). Two heavy instances at once — the (now default) kernel
 * worker plus the compute worker — can exhaust the browser's WebAssembly
 * memory on real workloads: importing pandas in the second instance has been
 * observed to fail with ``InternalError: out of memory`` once a large image
 * (e.g. a 1024×1024 array) already lives in the kernel.
 *
 * Until a memory-safe design lands, the cancellable path is therefore **off by
 * default** and strictly opt-in. Normal processings run in the kernel via
 * ``applyFeature`` (working, but not cancellable). Resolution order:
 *
 *   1. ``?cancellable=1`` / ``?cancellable=0`` URL parameter.
 *   2. ``localStorage["datalab-web:cancellable"]`` (``"1"``/``"0"``).
 *   3. Default: disabled.
 */
const STORAGE_KEY = "datalab-web:cancellable";

function parseFlag(raw: string | null | undefined): boolean | null {
  const v = raw?.toLowerCase();
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return null;
}

/** Whether processings should be delegated to the cancellable compute worker. */
export function isInterruptibleProcessingEnabled(): boolean {
  try {
    const fromUrl = parseFlag(
      new URLSearchParams(window.location.search).get("cancellable"),
    );
    if (fromUrl !== null) return fromUrl;
  } catch {
    /* ignore — URL unavailable */
  }
  try {
    const fromStorage = parseFlag(window.localStorage.getItem(STORAGE_KEY));
    if (fromStorage !== null) return fromStorage;
  } catch {
    /* ignore — localStorage unavailable */
  }
  return false;
}
