/**
 * DataLab-Web macro Worker.
 *
 * Loads a second Pyodide instance in a dedicated Web Worker so user
 * macros run isolated from the main UI thread.  Communicates with the
 * main thread via ``postMessage``:
 *
 *   ──► main thread sends:
 *     { type: "init" }
 *     { type: "run", code: string, name?: string }
 *     { type: "bridge_reply", id: string, ok: boolean, value?, error? }
 *
 *   ◄── worker sends:
 *     { type: "ready" }
 *     { type: "stdout"|"stderr", text: string }
 *     { type: "started", name: string }
 *     { type: "finished", ok: boolean, error?: string }
 *     { type: "bridge_call", id: string, method: string, payload: any }
 *
 * Stop is implemented main-side via ``Worker.terminate()``.
 */

import macroProxySource from "./macro_proxy.py?raw";

declare const self: DedicatedWorkerGlobalScope & {
  _dlw_bridge_call?: (method: string, payload: unknown) => Promise<unknown>;
  _dlw_pending_replies?: Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >;
};

interface PyodideAPI {
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

const PYODIDE_VERSION = "v0.26.4";
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;

let pyPromise: Promise<PyodideAPI> | null = null;

/** Load Pyodide on first use; subsequent calls return the same instance. */
async function getPyodide(): Promise<PyodideAPI> {
  if (pyPromise) return pyPromise;
  pyPromise = (async () => {
    // Module workers don't support ``importScripts`` — use the ESM
    // build of Pyodide and a dynamic ``import()`` instead.  Vite needs
    // the ``/* @vite-ignore */`` hint because the URL is dynamic.
    const pyodideMod = (await import(
      /* @vite-ignore */ `${PYODIDE_INDEX}pyodide.mjs`
    )) as { loadPyodide: (opts: { indexURL: string }) => Promise<PyodideAPI> };
    const py = await pyodideMod.loadPyodide({ indexURL: PYODIDE_INDEX });
    await py.loadPackage(["numpy"]);

    // Stream stdout/stderr to the main thread, line by line.
    // ``setStdout``/``setStderr`` work for raw C-level writes but
    // user-level ``print`` in the auto-wrapped coroutine doesn't always
    // reach them, so we also patch ``sys.stdout`` / ``sys.stderr`` in
    // Python — this is what ultimately captures ``print`` output.
    py.setStdout({
      batched: (s: string) => self.postMessage({ type: "stdout", text: s }),
    });
    py.setStderr({
      batched: (s: string) => self.postMessage({ type: "stderr", text: s }),
    });
    py.globals.set("_dlw_post_stdout", (s: unknown) =>
      self.postMessage({ type: "stdout", text: String(s) }),
    );
    py.globals.set("_dlw_post_stderr", (s: unknown) =>
      self.postMessage({ type: "stderr", text: String(s) }),
    );
    await py.runPythonAsync(`
import sys

class _DLWStream:
    def __init__(self, post):
        self._post = post
        self._buf = ""

    def write(self, s):
        if not s:
            return 0
        self._buf += s
        # Flush complete lines immediately; keep the trailing partial.
        if "\\n" in self._buf:
            head, _, tail = self._buf.rpartition("\\n")
            self._post(head + "\\n")
            self._buf = tail
        return len(s)

    def flush(self):
        if self._buf:
            self._post(self._buf)
            self._buf = ""

    def isatty(self):
        return False

sys.stdout = _DLWStream(_dlw_post_stdout)
sys.stderr = _DLWStream(_dlw_post_stderr)
`);

    // Bridge: macro calls ``js._dlw_bridge_call(method, payload)`` and
    // awaits the returned Promise; we resolve it when the main thread
    // posts back ``{type: "bridge_reply", id, ok, value|error}``.
    self._dlw_pending_replies = new Map();
    let nextId = 0;
    self._dlw_bridge_call = (method: string, payload: unknown) =>
      new Promise((resolve, reject) => {
        const id = `b${++nextId}`;
        self._dlw_pending_replies!.set(id, { resolve, reject });
        self.postMessage({ type: "bridge_call", id, method, payload });
      });

    // Install the Python ``proxy`` global by executing macro_proxy.py.
    // Also persist it to the FS so user code can ``import macro_proxy``
    // explicitly if it wants to.
    try {
      py.FS.writeFile("/home/pyodide/macro_proxy.py", macroProxySource);
    } catch {
      /* /home/pyodide may not exist on every Pyodide build — ignore. */
    }
    await py.runPythonAsync(macroProxySource);
    return py;
  })();
  return pyPromise;
}

// Surface async errors that escape the ``onmessage`` try/catch (e.g. a
// timer scheduled by Pyodide that throws, or a detached Promise that
// rejects).  Without these handlers the worker would die silently — the
// main thread relies on ``stderr`` / ``finished`` messages to update the
// macro console and Stop button state.
self.onerror = (event: Event | string): boolean => {
  const text =
    typeof event === "string"
      ? event
      : (event as ErrorEvent).message || "macro worker error";
  self.postMessage({ type: "stderr", text: text + "\n" });
  self.postMessage({ type: "finished", ok: false, error: text });
  // Returning ``true`` would prevent default logging in the host page;
  // we want the error to also appear in DevTools, so let it propagate.
  return false;
};

self.onunhandledrejection = (event: PromiseRejectionEvent): void => {
  const reason = event.reason;
  const text =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "unhandled promise rejection in macro worker";
  self.postMessage({ type: "stderr", text: text + "\n" });
  self.postMessage({ type: "finished", ok: false, error: text });
};

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data as
    | { type: "init" }
    | { type: "run"; code: string; name?: string }
    | {
        type: "bridge_reply";
        id: string;
        ok: boolean;
        value?: unknown;
        error?: string;
      };
  try {
    if (msg.type === "init") {
      await getPyodide();
      self.postMessage({ type: "ready" });
      return;
    }
    if (msg.type === "bridge_reply") {
      const pending = self._dlw_pending_replies?.get(msg.id);
      if (!pending) return;
      self._dlw_pending_replies!.delete(msg.id);
      if (msg.ok) pending.resolve(msg.value);
      else pending.reject(new Error(msg.error ?? "bridge call failed"));
      return;
    }
    if (msg.type === "run") {
      const py = await getPyodide();
      self.postMessage({ type: "started", name: msg.name ?? "" });
      try {
        // ``proxy`` is already a global injected by macro_proxy.py.
        // ``runPythonAsync`` supports top-level ``await`` by auto-
        // wrapping the source in a coroutine.
        await py.runPythonAsync(msg.code);
        // Flush any partial line still buffered in our redirected
        // ``sys.stdout`` / ``sys.stderr`` (no trailing ``\n``).
        await py.runPythonAsync(
          "import sys\nsys.stdout.flush()\nsys.stderr.flush()",
        );
        self.postMessage({ type: "finished", ok: true });
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        self.postMessage({ type: "stderr", text: text + "\n" });
        self.postMessage({ type: "finished", ok: false, error: text });
      }
    }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: "stderr", text: text + "\n" });
    self.postMessage({ type: "finished", ok: false, error: text });
  }
};
