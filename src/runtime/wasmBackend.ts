import type { PyodideAPI } from "./runtime";
import bridgeSource from "./wasm_bridge.py?raw";
import { benchmarkBuild, recordResult } from "./benchmarkTransfer";

interface Pyjs {
  FS: PyodideAPI["FS"];
  HEAPU8: Uint8Array;
  pyjsArch: string;
  pythonVersion: number[];
  exec(code: string): void;
  eval(code: string): unknown;
  async_exec_eval(code: string): Promise<unknown>;
}

export interface WasmBackend {
  kind: "wasm64";
  FS: PyodideAPI["FS"];
  _module: Pyjs;
  runPythonAsync(code: string): Promise<unknown>;
  call(name: string, kwargs: Record<string, unknown>): Promise<unknown>;
  setDialog(cb: (kind: unknown, payload: unknown) => Promise<unknown>): void;
}

interface Asset {
  url: string;
  sha256: string;
  path?: string;
}

/** Called only in the demo's kernel worker; the UI passes its deployment root. */
export async function bootWasmBackend(root: string): Promise<WasmBackend> {
  if (
    !WebAssembly.validate(
      Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 1),
    )
  )
    throw new Error("This browser does not support WebAssembly Memory64.");
  const base = new URL(root);
  if (base.origin !== self.location.origin || !base.href.endsWith("/"))
    throw new Error("Invalid WASM64 asset base");
  const response = await fetch(new URL("environment.json", base));
  if (!response.ok)
    throw new Error(`WASM64 environment: HTTP ${response.status}`);
  const manifest = (await response.json()) as {
    urls: Asset[];
    archives: Asset[];
  };
  const local = (item: Asset) => {
    const url = new URL(item.url, base);
    if (!url.href.startsWith(base.href) || !/^[\da-f]{64}$/.test(item.sha256))
      throw new Error("Invalid WASM64 package entry");
    return { ...item, url: url.href };
  };
  const { initializePyjsRuntime } = await import(
    /* @vite-ignore */ new URL("pyjs/dist/wasm64.js", base).href
  );
  const py: Pyjs = await initializePyjsRuntime({
    assetsUrl: new URL("pyjs/", base).href,
    urls: manifest.urls.map(local),
    archives: manifest.archives.map(local),
    cdnFallback: false,
    verifySha256: true,
    cache: false,
  });
  if (
    py.pyjsArch !== "wasm64" ||
    py.eval('__import__("struct").calcsize("P")') !== 8
  )
    throw new Error("Unexpected Python pointer width");
  py.FS.mkdirTree?.("/home/pyodide");
  py.exec(bridgeSource);
  let sequence = 0;
  const calls = new Map<
    number,
    { name: string; kwargs: Record<string, unknown> }
  >();
  const host = Object.assign(self, {
    _dlwWasmArgs: (id: number) => calls.get(id),
    _dlwWasmDialog: (_kind: unknown, _payload: unknown): Promise<unknown> =>
      Promise.reject(new Error("No WASM64 dialog handler installed")),
  });
  return {
    kind: "wasm64",
    FS: py.FS,
    _module: py,
    runPythonAsync: (code) => py.async_exec_eval(code),
    async call(name, kwargs) {
      // Each suspended coroutine owns a slot; dialog resolver reads can reenter.
      const id = ++sequence;
      calls.set(id, { name, kwargs });
      try {
        const result = await py.async_exec_eval(`await _dlw_wasm_call(${id})`);
        if (benchmarkBuild)
          recordResult("python", name, result, py.HEAPU8.buffer);
        return result;
      } finally {
        calls.delete(id);
      }
    },
    setDialog(cb) {
      host._dlwWasmDialog = cb;
      py.exec("set_dialog_bridge(_dlw_wasm_dialog)");
    },
  };
}
