/// <reference lib="webworker" />
/**
 * Runtime kernel worker — hosts the single Pyodide instance and the whole
 * {@link DataLabRuntime} inside a Dedicated Web Worker.
 *
 * This is the worker-mode home of the runtime: the UI thread talks to it
 * exclusively through {@link WorkerRuntimeProxy} over the envelopes defined
 * in {@link workerProtocol}. Moving Pyodide off the UI thread is what
 * unlocks **synchronous** OPFS access handles (``createSyncAccessHandle``,
 * worker-only) for fast on-disk spills — the performance step de-risked by
 * the ``opfs_sync_spike`` benchmark (DEW ADR #2).
 *
 * The worker is a thin RPC server: it boots the runtime once, then for each
 * {@link CallRequest} invokes ``runtime[method](...args)`` and posts the
 * result back. Workspace mutations and Python dialog requests are pushed up
 * as events; after every call it refreshes the main thread's synchronous
 * mirror (storage mode, spill stats, memory usage).
 *
 * It must stay a standalone entry point so Vite can resolve
 * ``new Worker(new URL("./kernelWorker.ts", import.meta.url))``.
 */
import { DataLabRuntime, type PyodideLoader } from "./runtime";
import { PYODIDE_INDEX } from "./workerBase";
import { collectTransferables } from "./workerProtocol";
import type {
  KernelEvent,
  KernelMirror,
  KernelRequest,
} from "./workerProtocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(event: KernelEvent, transfer?: Transferable[]): void {
  ctx.postMessage(event, transfer ?? []);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Module workers can't use ``importScripts``; load the ESM Pyodide build
 *  via a dynamic ``import()`` (mirrors ``workerBase.bootPyodide``). */
const workerPyodideLoader: PyodideLoader = async (opts) => {
  const mod = (await import(
    /* @vite-ignore */ `${PYODIDE_INDEX}pyodide.mjs`
  )) as {
    loadPyodide: (o: { indexURL: string }) => Promise<unknown>;
  };
  return mod.loadPyodide(opts);
};

let runtime: DataLabRuntime | null = null;
let booting = false;

/** Pending Python-dialog round-trips awaiting a main-thread answer. */
let nextDialogId = 1;
const pendingDialogs = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: unknown) => void }
>();

/** Read the four synchronous accessors into a mirror snapshot. */
function snapshot(rt: DataLabRuntime): KernelMirror {
  return {
    storageMode: rt.getStorageMode(),
    diskStoreBytes: rt.getDiskStoreBytes(),
    spilledCount: rt.getSpilledCount(),
    memoryUsage: rt.getMemoryUsage(),
  };
}

async function boot(
  lang: string,
  labels: { group: string; untitled: string },
): Promise<void> {
  if (runtime || booting) return;
  booting = true;
  try {
    const rt = await DataLabRuntime.load(
      (message) => post({ type: "progress", message }),
      {
        loadPyodide: workerPyodideLoader,
        lang,
        labels,
      },
    );
    // Forward workspace mutations so the main thread can flip its dirty flag.
    rt.onWorkspaceMutation((name) => post({ type: "mutation", name }));
    // Route Python dialog requests up to the main thread, which owns the UI.
    rt.setDialogHandler(
      (kind, payload) =>
        new Promise((resolve, reject) => {
          const id = nextDialogId++;
          pendingDialogs.set(id, { resolve, reject });
          post({ type: "dialog-request", id, kind, payload });
        }),
    );
    runtime = rt;
    post({ type: "ready", mirror: snapshot(rt) });
  } catch (err) {
    post({ type: "boot-error", error: errMessage(err) });
  } finally {
    booting = false;
  }
}

async function handleCall(
  id: number,
  method: string,
  args: unknown[],
): Promise<void> {
  if (!runtime) {
    post({ type: "result", id, ok: false, error: "runtime not booted" });
    return;
  }
  try {
    const fn = (runtime as unknown as Record<string, unknown>)[method];
    if (typeof fn !== "function") {
      throw new Error(`unknown runtime method: ${method}`);
    }
    const value = await (fn as (...a: unknown[]) => unknown).apply(
      runtime,
      args,
    );
    // Post the refreshed synchronous mirror *before* the result. Message
    // order is preserved, so the main thread updates its mirror cache
    // before the awaiting caller resumes — making the synchronous
    // accessors (getSpilledCount, getMemoryUsage, …) consistent with the
    // value just returned, rather than lagging one round-trip behind.
    post({ type: "mirror", mirror: snapshot(runtime) });
    // Transfer (not clone) any ArrayBuffers in the return value: binary
    // payloads (image/signal bytes, HDF5 workspace, …) are freshly built
    // by the runtime (Python ``.tobytes()`` → a new JS ArrayBuffer), so
    // moving them back to the main thread zero-copy is always safe.
    post({ type: "result", id, ok: true, value }, collectTransferables(value));
  } catch (err) {
    post({ type: "mirror", mirror: snapshot(runtime) });
    post({ type: "result", id, ok: false, error: errMessage(err) });
  }
}

ctx.onmessage = (ev: MessageEvent<KernelRequest>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "init":
      void boot(msg.lang, msg.labels);
      break;
    case "call":
      void handleCall(msg.id, msg.method, msg.args);
      break;
    case "dialog-response": {
      const pending = pendingDialogs.get(msg.id);
      if (!pending) break;
      pendingDialogs.delete(msg.id);
      if (msg.ok) pending.resolve(msg.value);
      else pending.reject(new Error(msg.error ?? "dialog failed"));
      break;
    }
  }
};
