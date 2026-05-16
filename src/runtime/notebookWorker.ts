/**
 * DataLab-Web notebook Worker.
 *
 * A second Pyodide instance (separate from the macro worker and from
 * the main UI's Sigima runtime) hosts notebook execution.  Unlike the
 * macro worker, this one **persists state across cells**: the user
 * namespace (``_user_ns``) is created once and reused for every
 * ``exec_cell`` request.
 *
 *   ──► main thread sends:
 *     { type: "init" }
 *     { type: "exec_cell", cellId: string, code: string }
 *     { type: "bridge_reply", id: string, ok: boolean, value?, error? }
 *
 *   ◄── worker sends:
 *     { type: "ready" }
 *     { type: "cell_started", cellId: string, execCount: number }
 *     { type: "stream", cellId: string, kind: "stdout"|"stderr", text: string }
 *     { type: "display_data", cellId: string, mime: Record<string,unknown> }
 *     { type: "execute_result", cellId: string, mime: Record<string,unknown>,
 *       execCount: number }
 *     { type: "error", cellId: string, ename: string, evalue: string,
 *       traceback: string }
 *     { type: "cell_finished", cellId: string, ok: boolean, execCount: number }
 *     { type: "bridge_call", id: string, method: string, payload: any }
 *
 * Restart / Interrupt are implemented main-side via ``Worker.terminate()``
 * (same pattern as the macro worker — the user is warned that this loses
 * the cell namespace).
 */

import macroProxySource from "./macro_proxy.py?raw";
import notebookDisplaySource from "./notebook_display.py?raw";
import dlwTitleFormatSource from "./dlw_title_format.py?raw";

declare const self: DedicatedWorkerGlobalScope & {
  _dlw_bridge_call?: (method: string, payload: unknown) => Promise<unknown>;
  _dlw_pending_replies?: Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >;
  _dlw_current_cell_id?: string;
  _dlw_post_display?: (mime: unknown) => void;
  _dlw_post_execute_result?: (mime: unknown) => void;
  _dlw_post_stream?: (kind: string, text: string) => void;
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

    // Force English locale for any gettext-wrapped labels coming back
    // from the bridge (mirrors the macro worker; same rationale).
    await py.runPythonAsync(`
import os
os.environ["LANG"] = "C"
os.environ["LANGUAGE"] = "C"
`);

    await py.loadPackage(["numpy", "scipy", "micropip"]);

    // Install Sigima (and guidata) so user cells can ``import sigima``
    // directly. This adds ~30s on first init but mirrors the main
    // runtime's micropip install and is what the Quickstart template
    // (and any "scientific Python" notebook) expects.
    await py.runPythonAsync(`
import micropip
await micropip.install(["sigima", "guidata"])
`);
    // Install Sigima's ``PlaceholderTitleFormatter`` so titles produced
    // inside notebook cells use the same placeholder format as the main
    // runtime (later resolved to source ``oid``s by the main bootstrap).
    py.FS.writeFile("/home/pyodide/dlw_title_format.py", dlwTitleFormatSource);
    await py.runPythonAsync(dlwTitleFormatSource);

    // ----- Stream redirection (per-cell, tagged with current cell id) -----
    const postStream = (kind: string, text: string) =>
      self.postMessage({
        type: "stream",
        cellId: self._dlw_current_cell_id ?? "",
        kind: kind === "stderr" ? "stderr" : "stdout",
        text,
      });
    const postDisplay = (mime: unknown) => {
      const bundle =
        mime && typeof (mime as { toJs?: () => unknown }).toJs === "function"
          ? (mime as { toJs: (opts?: unknown) => unknown }).toJs({
              dict_converter: Object.fromEntries,
            })
          : mime;
      self.postMessage({
        type: "display_data",
        cellId: self._dlw_current_cell_id ?? "",
        mime: bundle,
      });
    };
    const postExecuteResult = (mime: unknown) => {
      const bundle =
        mime && typeof (mime as { toJs?: () => unknown }).toJs === "function"
          ? (mime as { toJs: (opts?: unknown) => unknown }).toJs({
              dict_converter: Object.fromEntries,
            })
          : mime;
      self.postMessage({
        type: "execute_result",
        cellId: self._dlw_current_cell_id ?? "",
        mime: bundle,
      });
    };
    // Expose on the JS global scope so ``import js; js._dlw_*(...)``
    // from Python works (Pyodide's ``js`` proxy reflects globalThis).
    (self as unknown as Record<string, unknown>)._dlw_post_stream = postStream;
    (self as unknown as Record<string, unknown>)._dlw_post_display =
      postDisplay;
    (self as unknown as Record<string, unknown>)._dlw_post_execute_result =
      postExecuteResult;

    py.setStdout({ batched: (s: string) => postStream("stdout", s) });
    py.setStderr({ batched: (s: string) => postStream("stderr", s) });
    py.globals.set("_dlw_post_stream", postStream);
    py.globals.set("_dlw_post_display", postDisplay);
    py.globals.set("_dlw_post_execute_result", postExecuteResult);

    // ----- Patch sys.stdout/stderr so user-level ``print`` reaches us -----
    await py.runPythonAsync(`
import sys

class _DLWStream:
    def __init__(self, kind):
        self._kind = kind
        self._buf = ""

    def write(self, s):
        if not s:
            return 0
        self._buf += s
        if "\\n" in self._buf:
            head, _, tail = self._buf.rpartition("\\n")
            _dlw_post_stream(self._kind, head + "\\n")
            self._buf = tail
        return len(s)

    def flush(self):
        if self._buf:
            _dlw_post_stream(self._kind, self._buf)
            self._buf = ""

    def isatty(self):
        return False

sys.stdout = _DLWStream("stdout")
sys.stderr = _DLWStream("stderr")
`);

    // ----- Bridge plumbing (identical to macro worker) -------------------
    self._dlw_pending_replies = new Map();
    let nextId = 0;
    self._dlw_bridge_call = (method: string, payload: unknown) =>
      new Promise((resolve, reject) => {
        const id = `b${++nextId}`;
        self._dlw_pending_replies!.set(id, { resolve, reject });
        self.postMessage({ type: "bridge_call", id, method, payload });
      });

    // ----- Install ``proxy`` global (same as macro worker) ---------------
    try {
      py.FS.writeFile("/home/pyodide/macro_proxy.py", macroProxySource);
    } catch {
      /* ignore */
    }
    await py.runPythonAsync(macroProxySource);

    // ----- Install notebook display helpers ------------------------------
    try {
      py.FS.writeFile(
        "/home/pyodide/notebook_display.py",
        notebookDisplaySource,
      );
    } catch {
      /* ignore */
    }
    await py.runPythonAsync(notebookDisplaySource);

    return py;
  })();
  return pyPromise;
}

self.onerror = (event: Event | string): boolean => {
  const text =
    typeof event === "string"
      ? event
      : (event as ErrorEvent).message || "notebook worker error";
  self.postMessage({
    type: "error",
    cellId: self._dlw_current_cell_id ?? "",
    ename: "WorkerError",
    evalue: text,
    traceback: text,
  });
  self.postMessage({
    type: "cell_finished",
    cellId: self._dlw_current_cell_id ?? "",
    ok: false,
    execCount: 0,
  });
  return false;
};

self.onunhandledrejection = (event: PromiseRejectionEvent): void => {
  const reason = event.reason;
  const text =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "unhandled promise rejection in notebook worker";
  self.postMessage({
    type: "error",
    cellId: self._dlw_current_cell_id ?? "",
    ename: "UnhandledPromiseRejection",
    evalue: text,
    traceback: text,
  });
  self.postMessage({
    type: "cell_finished",
    cellId: self._dlw_current_cell_id ?? "",
    ok: false,
    execCount: 0,
  });
};

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data as
    | { type: "init" }
    | { type: "exec_cell"; cellId: string; code: string }
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
    if (msg.type === "exec_cell") {
      const py = await getPyodide();
      self._dlw_current_cell_id = msg.cellId;
      // Bump exec counter and broadcast cell_started.
      const execCount = Number(
        await py.runPythonAsync(
          "from notebook_display import _bump_exec_count\n_bump_exec_count()",
        ),
      );
      self.postMessage({
        type: "cell_started",
        cellId: msg.cellId,
        execCount,
      });
      // Hand the source over to Python via a global to avoid quoting issues.
      py.globals.set("_dlw_cell_source", msg.code);
      try {
        await py.runPythonAsync(
          "from notebook_display import _exec_cell\n" +
            "await _exec_cell(_dlw_cell_source)",
        );
        await py.runPythonAsync(
          "import sys\nsys.stdout.flush()\nsys.stderr.flush()",
        );
        self.postMessage({
          type: "cell_finished",
          cellId: msg.cellId,
          ok: true,
          execCount,
        });
      } catch (err) {
        // ``_exec_cell`` formats and emits its own ``error`` message
        // (with full Python traceback) before re-raising. The catch
        // here is a safety net for failures that escape that path.
        const text = err instanceof Error ? err.message : String(err);
        self.postMessage({
          type: "error",
          cellId: msg.cellId,
          ename: "WorkerError",
          evalue: text,
          traceback: text,
        });
        self.postMessage({
          type: "cell_finished",
          cellId: msg.cellId,
          ok: false,
          execCount,
        });
      } finally {
        self._dlw_current_cell_id = undefined;
      }
    }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    self.postMessage({
      type: "error",
      cellId: self._dlw_current_cell_id ?? "",
      ename: "WorkerError",
      evalue: text,
      traceback: text,
    });
    self.postMessage({
      type: "cell_finished",
      cellId: self._dlw_current_cell_id ?? "",
      ok: false,
      execCount: 0,
    });
  }
};
