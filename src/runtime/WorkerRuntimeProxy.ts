/**
 * Main-thread client for the runtime kernel worker.
 *
 * {@link WorkerRuntimeProxy} implements {@link RuntimeApi} by forwarding
 * every method call to the Pyodide-hosting {@link kernelWorker} over
 * ``postMessage`` (see {@link workerProtocol} for the envelopes). It is the
 * worker-mode counterpart of the in-thread {@link DataLabRuntime}: consumers
 * depend only on ``RuntimeApi``, so swapping one for the other is invisible
 * to the UI (DEW ADR #2 — moving Pyodide off the UI thread so OPFS spills
 * can use synchronous access handles).
 *
 * Three concerns get bespoke handling instead of a plain round-trip:
 *
 *   * **Synchronous accessors** (``getStorageMode`` etc.) are served from a
 *     locally-cached {@link KernelMirror} that the worker pushes on change.
 *   * **Callback registrars** (``setDialogHandler``, ``onWorkspaceMutation``,
 *     ``onStorageError``) keep the JS callback on the main thread and bridge
 *     the worker's events to it — a function can't cross ``postMessage``.
 *   * Every other method is forwarded generically through a ``Proxy`` trap,
 *     so the ~150-method surface needs no hand-written forwarders and any
 *     new ``RuntimeApi`` method works automatically.
 */
import type { RuntimeApi } from "./runtime";
import {
  INITIAL_MIRROR,
  ScientificRefusalError,
  SYNC_MIRROR_METHODS,
  collectTransferables,
  type KernelEvent,
  type KernelMirror,
  type KernelRequest,
} from "./workerProtocol";
import { pyodideLang } from "../i18n/locale";
import { currentRuntimeLabels, type RuntimeLabels } from "./runtimeLabels";

/** The slice of the ``Worker`` API the client needs — narrowed so unit
 *  tests can inject a fake transport without a real Worker. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (ev: { data: unknown }) => void,
  ): void;
  addEventListener(
    type: "error",
    listener: (ev: { message?: string; filename?: string }) => void,
  ): void;
  terminate(): void;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const SYNC_SET = new Set<string>(SYNC_MIRROR_METHODS);

/**
 * Connection manager for the kernel worker. Holds the pending-call table,
 * the synchronous mirror, the mutation listeners and the dialog handler,
 * and exposes a {@link RuntimeApi} façade via {@link asRuntime}.
 */
export class WorkerRuntimeProxy {
  private nextCallId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private mirror: KernelMirror = INITIAL_MIRROR;
  private readonly mutationListeners = new Set<(name: string) => void>();
  private readonly storageErrorListeners = new Set<(message: string) => void>();
  private dialogHandler:
    ((kind: string, payload: unknown) => Promise<unknown>) | null = null;

  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: unknown) => void;
  private settledReady = false;
  private terminalError: Error | null = null;
  private started = false;
  private wasmRequested = false;
  private timeout?: ReturnType<typeof setTimeout>;

  /** Lazily-built ``RuntimeApi`` façade (a ``Proxy`` over this client). */
  private runtimeFacade: RuntimeApi | null = null;

  constructor(
    private readonly worker: WorkerLike,
    private readonly onProgress?: (message: string) => void,
    private readonly onFatal?: (message: string) => void,
  ) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker.addEventListener("message", (ev) =>
      this.handleEvent(ev.data as KernelEvent),
    );
    // A module-load crash (or any uncaught error before the worker installs
    // its message handler) would otherwise leave ``init`` hanging forever:
    // surface it as a boot failure with whatever detail the browser gives.
    this.worker.addEventListener("error", (ev) => {
      const detail = ev.message
        ? `${ev.message}${ev.filename ? ` (${ev.filename})` : ""}`
        : "runtime worker failed to start";
      this.fail(
        new Error(
          this.settledReady ? `runtime worker error: ${detail}` : detail,
        ),
      );
    });
  }

  /** Send the boot request. Resolves once the worker reports ``ready``. */
  init(
    lang: string,
    labels: RuntimeLabels,
    wasmAssetRoot?: string,
  ): Promise<void> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (this.started) return this.readyPromise;
    this.started = true;
    this.wasmRequested = !!wasmAssetRoot;
    this.timeout = setTimeout(
      () => this.fail(new Error("Runtime worker startup timed out")),
      300_000,
    );
    try {
      this.post({
        type: "init",
        lang,
        labels,
        ...(wasmAssetRoot ? { wasmAssetRoot } : {}),
      });
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
    return this.readyPromise;
  }

  /** The ``RuntimeApi`` view consumers use. Stable across calls. */
  asRuntime(): RuntimeApi {
    if (!this.runtimeFacade) {
      this.runtimeFacade = this.buildFacade();
    }
    return this.runtimeFacade;
  }

  /** Tear down the worker and reject any in-flight calls. */
  dispose(): void {
    this.fail(new Error("runtime worker disposed"), false);
  }

  private fail(error: Error, notify = true): void {
    if (this.terminalError) return;
    this.terminalError = error;
    clearTimeout(this.timeout);
    if (this.started && !this.settledReady) this.rejectReady(error);
    this.rejectPending(error);
    this.worker.terminate();
    if (notify && this.settledReady) this.onFatal?.(error.message);
  }

  // --- Internals ---------------------------------------------------------

  private rejectPending(err: Error): void {
    const pending = Array.from(this.pending.values());
    this.pending.clear();
    for (const { reject } of pending) reject(err);
  }

  private post(message: KernelRequest, transfer?: Transferable[]): void {
    try {
      this.worker.postMessage(message, transfer);
    } catch (err) {
      const detail =
        message.type === "call"
          ? `call ${message.method}(args: ${message.args
              .map((a) => typeof a)
              .join(", ")})`
          : message.type;
      console.error("[workerRuntime] postMessage failed:", detail, err);
      throw err;
    }
  }

  private buildFacade(): RuntimeApi {
    const handler: ProxyHandler<object> = {
      get: (_target, prop) => {
        if (typeof prop !== "string") return undefined;
        // Critical: never forward ``then``. ``RuntimeApi`` has no ``then``
        // method, but returning a function here would make the Proxy look
        // like a thenable — so ``await createWorkerRuntime()`` (or any
        // ``Promise.resolve(runtime)``) would call ``proxy.then(resolve,
        // reject)``, forwarding two functions across ``postMessage`` and
        // throwing ``DataCloneError``. Returning ``undefined`` keeps the
        // façade a plain (non-thenable) object.
        if (prop === "then") return undefined;
        if (SYNC_SET.has(prop)) {
          return this.syncAccessor(prop);
        }
        if (prop === "setDialogHandler") {
          return (
            h: ((kind: string, payload: unknown) => Promise<unknown>) | null,
          ) => {
            this.dialogHandler = h;
          };
        }
        if (prop === "onWorkspaceMutation") {
          return (listener: (name: string) => void) =>
            this.addListener(this.mutationListeners, listener);
        }
        if (prop === "onStorageError") {
          return (listener: (message: string) => void) =>
            this.addListener(this.storageErrorListeners, listener);
        }
        // Generic async forward for every other method.
        return (...args: unknown[]) => this.call(prop, args);
      },
    };
    // The Proxy structurally satisfies RuntimeApi: every access yields a
    // function with the right shape (sync accessors, the callback
    // registrars, or a generic async forward).
    return new Proxy({}, handler) as unknown as RuntimeApi;
  }

  private syncAccessor(prop: string): () => unknown {
    switch (prop) {
      case "getStorageMode":
        return () => this.mirror.storageMode;
      case "getDiskStoreBytes":
        return () => this.mirror.diskStoreBytes;
      case "getSpilledCount":
        return () => this.mirror.spilledCount;
      case "getMemoryUsage":
        return () => this.mirror.memoryUsage;
      default:
        return () => undefined;
    }
  }

  private call(method: string, args: unknown[]): Promise<unknown> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    const id = this.nextCallId++;
    // Transfer (not clone) any ArrayBuffers in the arguments: binary inputs
    // (image/signal arrays, file bytes) are moved into the runtime, so this
    // avoids the structured-clone copy the benchmark showed dominates the
    // call. The buffers are detached on this side afterwards.
    const transfer = collectTransferables(args);
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.post({ type: "call", id, method, args }, transfer);
      } catch (err) {
        // Never sent: no result will come for this call
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  private addListener<T>(
    listeners: Set<(value: T) => void>,
    listener: (value: T) => void,
  ): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /** Call every listener of *listeners* with *value*, logging their errors. */
  private notify<T>(
    listeners: Set<(value: T) => void>,
    value: T,
    kind: string,
  ): void {
    for (const cb of listeners) {
      try {
        cb(value);
      } catch (err) {
        console.warn(`[workerRuntime] ${kind} listener threw`, err);
      }
    }
  }

  private handleEvent(event: KernelEvent): void {
    if (this.terminalError) return;
    switch (event.type) {
      case "progress":
        this.onProgress?.(event.message);
        break;
      case "ready":
        if ((event.engine === "wasm64") !== this.wasmRequested) {
          this.fail(new Error("Worker started with the wrong engine"));
          break;
        }
        clearTimeout(this.timeout);
        this.mirror = event.mirror;
        if (!this.settledReady) {
          this.settledReady = true;
          this.resolveReady();
        }
        break;
      case "boot-error":
        this.fail(new Error(event.error));
        break;
      case "result": {
        const pending = this.pending.get(event.id);
        if (!pending) break;
        this.pending.delete(event.id);
        if (event.ok) pending.resolve(event.value);
        else if (event.refusal) {
          pending.reject(new ScientificRefusalError(event.refusal));
        } else pending.reject(new Error(event.error));
        break;
      }
      case "mutation":
        this.notify(this.mutationListeners, event.name, "mutation");
        break;
      case "storage-error":
        this.notify(this.storageErrorListeners, event.message, "storage-error");
        break;
      case "dialog-request":
        void this.handleDialogRequest(event.id, event.kind, event.payload);
        break;
      case "mirror":
        this.mirror = event.mirror;
        break;
    }
  }

  private async handleDialogRequest(
    id: number,
    kind: string,
    payload: unknown,
  ): Promise<void> {
    if (!this.dialogHandler) {
      this.post({
        type: "dialog-response",
        id,
        ok: false,
        error: "no dialog handler registered",
      });
      return;
    }
    try {
      const value = await this.dialogHandler(kind, payload);
      if (this.terminalError) return;
      this.post({ type: "dialog-response", id, ok: true, value });
    } catch (err) {
      if (this.terminalError) return;
      this.post({
        type: "dialog-response",
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Boot Pyodide inside a Dedicated Web Worker and return a {@link RuntimeApi}
 * façade backed by it. The returned promise resolves once the kernel has
 * finished installing the scientific stack and Sigima.
 *
 * @param onProgress Boot-progress callback (same contract as
 *  ``DataLabRuntime.load``).
 * @param deps Test seam — inject a fake worker and locale values.
 */
export async function createWorkerRuntime(
  onProgress?: (message: string) => void,
  deps?: {
    worker?: WorkerLike;
    lang?: string;
    labels?: RuntimeLabels;
    wasmAssetRoot?: string;
    onFatal?: (message: string) => void;
    signal?: AbortSignal;
  },
): Promise<RuntimeApi> {
  const worker: WorkerLike =
    deps?.worker ??
    (new Worker(new URL("./kernelWorker.ts", import.meta.url), {
      type: "module",
    }) as unknown as WorkerLike);
  const proxy = new WorkerRuntimeProxy(worker, onProgress, deps?.onFatal);
  deps?.signal?.addEventListener("abort", () => proxy.dispose(), {
    once: true,
  });
  if (deps?.signal?.aborted) proxy.dispose();
  // Compute locale-derived values on the main thread (the DOM-less worker
  // cannot) and pass them to the kernel boot.
  const lang = deps?.lang ?? pyodideLang();
  const labels = deps?.labels ?? currentRuntimeLabels();
  await proxy.init(lang, labels, deps?.wasmAssetRoot);
  return proxy.asRuntime();
}
