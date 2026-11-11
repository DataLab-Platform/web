/**
 * Main-thread controller for the notebook Web Worker.
 *
 * Mirrors :class:`MacroRuntime` but with a per-cell execution protocol
 * (``execute_cell`` instead of ``run``) and a persistent worker (no
 * warm-replacement: the user namespace must survive across cells).
 *
 * Cells are queued — the runtime is single-tracked, like the macro
 * runtime, so a Run-All naturally serialises executions. Restart and
 * Interrupt both terminate the worker; the main thread spawns a fresh
 * one and the user is informed that the namespace was lost.
 */

import type { RuntimeApi } from "../runtime/runtime";
import {
  buildProxyBridge,
  type BridgeExternalCallbacks,
  type BridgeMethod,
} from "../runtime/proxyBridge";
import { GenerationPool } from "../runtime/workerPool";
import { startWorker, WorkerStartCancelled } from "../runtime/workerReady";
import { pyodideLang } from "../i18n/locale";

/** Outputs are MIME bundles, exactly like Jupyter ``display_data``. */
export type MimeBundle = Record<string, unknown>;

export interface CellExecCallbacks {
  onStarted?: (execCount: number) => void;
  onStream?: (kind: "stdout" | "stderr", text: string) => void;
  onDisplayData?: (mime: MimeBundle) => void;
  onExecuteResult?: (mime: MimeBundle, execCount: number) => void;
  onError?: (ename: string, evalue: string, traceback: string) => void;
  onFinished?: (
    status: "ok" | "error" | "interrupted",
    execCount: number,
  ) => void;
}

interface BridgeCallMessage {
  type: "bridge_call";
  id: string;
  method: string;
  payload: unknown;
}

interface OutboundReply {
  type: "bridge_reply";
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** Status of the runtime as a whole. */
export type NotebookRuntimeStatus = "idle" | "loading" | "running" | "stopping";

/** A start cancelled by a dispose or a restart is not an error. */
function ignoreCancelled(error: unknown): void {
  if (!(error instanceof WorkerStartCancelled)) throw error;
}

/** Kernels of the Notebooks panel, shared by its successive mounts (see
 *  :class:`GenerationPool`). */
const panelKernels = new GenerationPool<RuntimeApi, NotebookRuntime>(
  (runtime) => new NotebookRuntime(runtime),
);

/** The kernel of the Notebooks panel for ``generation``: the panel is
 *  mounted afresh when the workspace is replaced or reset, and gets a new
 *  kernel only with a new generation (the previous one is terminated,
 *  unless no cell ran in it). */
export function panelNotebookRuntime(
  runtime: RuntimeApi,
  generation: number,
): NotebookRuntime {
  return panelKernels.acquire(runtime, generation);
}

interface QueuedRun {
  cellId: string;
  code: string;
  callbacks: CellExecCallbacks;
  resolve: () => void;
  reject: (err: Error) => void;
}

export class NotebookRuntime {
  private worker: Worker | null = null;
  private workerReady = false;
  /** Start of the worker in progress (shared by concurrent callers). */
  private starting: Promise<void> | null = null;
  /** Cancels the start in progress (dispose, interrupt, restart). */
  private startAbort: AbortController | null = null;
  private currentRun: QueuedRun | null = null;
  private queue: QueuedRun[] = [];
  private status: NotebookRuntimeStatus = "idle";
  /** A cell was sent to the current worker (its namespace is not fresh). */
  private used = false;

  externalCallbacks: BridgeExternalCallbacks = {};

  constructor(private readonly runtime: RuntimeApi) {}

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  /** Eagerly create & init the worker so the first cell run is fast. */
  async preload(): Promise<void> {
    await this.ensureWorker().catch(ignoreCancelled);
  }

  getStatus(): NotebookRuntimeStatus {
    return this.status;
  }

  /** True while no cell ran in the kernel (fresh user namespace). */
  isPristine(): boolean {
    return !this.used && !this.currentRun && this.queue.length === 0;
  }

  /**
   * Execute *code* as a single cell. Resolves when the cell completes
   * (successfully or with an error — errors are reported via callbacks,
   * not by rejecting). Rejects only on infrastructure failures.
   */
  executeCell(
    cellId: string,
    code: string,
    callbacks: CellExecCallbacks,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ cellId, code, callbacks, resolve, reject });
      void this.pump();
    });
  }

  /**
   * Hard-stop the running cell (terminates the worker). Loses the user
   * namespace — the caller is expected to confirm with the user first.
   * Resolves once a fresh worker has been spawned and is ready.
   */
  async interrupt(): Promise<void> {
    if (this.status !== "running" || !this.worker) {
      // Nothing to interrupt — no-op rather than throwing.
      return;
    }
    this.status = "stopping";
    const interrupted = this.currentRun;
    this.terminateWorker();
    this.currentRun = null;
    interrupted?.callbacks.onError?.(
      "KeyboardInterrupt",
      "Cell interrupted — kernel restarted (user namespace lost).",
      "",
    );
    interrupted?.callbacks.onFinished?.("interrupted", 0);
    interrupted?.resolve();
    // Drain pending queue with the same diagnosis.
    const pending = this.queue.splice(0);
    for (const q of pending) {
      q.callbacks.onError?.(
        "KeyboardInterrupt",
        "Cell skipped — kernel was interrupted.",
        "",
      );
      q.callbacks.onFinished?.("interrupted", 0);
      q.resolve();
    }
    this.status = "idle";
    await this.ensureWorker().catch(ignoreCancelled);
  }

  /** Restart the kernel: a running cell is interrupted; an idle (or still
   *  starting) kernel is terminated as well and replaced by a fresh one,
   *  so that the user namespace is always lost. */
  async restart(): Promise<void> {
    if (this.status === "running" && this.worker) {
      await this.interrupt();
      return;
    }
    this.terminateWorker();
    this.status = "idle";
    await this.ensureWorker().catch(ignoreCancelled);
  }

  dispose(): void {
    this.terminateWorker();
    this.currentRun = null;
    this.queue = [];
    this.status = "idle";
  }

  // ---------------------------------------------------------------------
  // Worker lifecycle
  // ---------------------------------------------------------------------

  /** Terminate the worker, ready or still starting. */
  private terminateWorker(): void {
    this.startAbort?.abort();
    this.startAbort = null;
    this.starting = null;
    try {
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;
    this.workerReady = false;
    this.used = false;
  }

  private ensureWorker(): Promise<void> {
    if (this.worker && this.workerReady) return Promise.resolve();
    if (!this.starting) {
      const abort = new AbortController();
      this.startAbort = abort;
      this.status = "loading";
      const starting = startWorker({
        spawn: () => this.spawnWorker(),
        onSpawn: (worker) => {
          this.worker = worker;
          this.workerReady = false;
        },
        signal: abort.signal,
        label: "notebook kernel",
      }).then(
        () => {
          if (this.starting !== starting) return;
          this.starting = null;
          this.startAbort = null;
          this.workerReady = true;
          if (this.status === "loading") this.status = "idle";
        },
        (error: unknown) => {
          if (this.starting === starting) {
            this.starting = null;
            this.startAbort = null;
            this.worker = null;
            this.status = "idle";
          }
          throw error;
        },
      );
      this.starting = starting;
    }
    return this.starting;
  }

  private spawnWorker(): Worker {
    const w = new Worker(
      new URL("../runtime/notebookWorker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    w.onmessage = (ev) => this.handleWorkerMessage(ev.data);
    w.onerror = (ev) => {
      const msg = ev.message || "notebook worker error";
      const cb = this.currentRun;
      if (cb) {
        cb.callbacks.onError?.("WorkerError", msg, msg);
        cb.callbacks.onFinished?.("error", 0);
        cb.resolve();
        this.currentRun = null;
      }
      this.status = "idle";
      this.workerReady = false;
    };
    w.postMessage({ type: "init", lang: pyodideLang() });
    return w;
  }

  // ---------------------------------------------------------------------
  // Pump (single-track queue)
  // ---------------------------------------------------------------------

  private async pump(): Promise<void> {
    if (this.status === "running" || this.status === "stopping") return;
    const next = this.queue.shift();
    if (!next) return;
    try {
      await this.ensureWorker();
    } catch (err) {
      if (err instanceof WorkerStartCancelled) {
        // Disposed or restarted meanwhile: the cell is not run.
        next.callbacks.onFinished?.("interrupted", 0);
        next.resolve();
        return;
      }
      next.callbacks.onError?.(
        "WorkerInitError",
        err instanceof Error ? err.message : String(err),
        "",
      );
      next.callbacks.onFinished?.("error", 0);
      next.reject(err instanceof Error ? err : new Error(String(err)));
      void this.pump();
      return;
    }
    this.currentRun = next;
    this.status = "running";
    this.used = true;
    this.worker!.postMessage({
      type: "exec_cell",
      cellId: next.cellId,
      code: next.code,
    });
  }

  // ---------------------------------------------------------------------
  // Worker → main-thread message dispatch
  // ---------------------------------------------------------------------

  private handleWorkerMessage(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const msg = data as Record<string, unknown>;
    const type = msg.type as string | undefined;
    const run = this.currentRun;
    switch (type) {
      case "ready":
        return; // handled in waitForReady
      case "cell_started":
        run?.callbacks.onStarted?.(Number(msg.execCount ?? 0));
        return;
      case "stream": {
        const kind = msg.kind === "stderr" ? "stderr" : "stdout";
        run?.callbacks.onStream?.(kind, String(msg.text ?? ""));
        return;
      }
      case "display_data":
        run?.callbacks.onDisplayData?.(msg.mime as MimeBundle);
        return;
      case "execute_result":
        run?.callbacks.onExecuteResult?.(
          msg.mime as MimeBundle,
          Number(msg.execCount ?? 0),
        );
        return;
      case "error":
        run?.callbacks.onError?.(
          String(msg.ename ?? ""),
          String(msg.evalue ?? ""),
          String(msg.traceback ?? ""),
        );
        return;
      case "cell_finished": {
        const ok = Boolean(msg.ok);
        const execCount = Number(msg.execCount ?? 0);
        const cb = this.currentRun;
        this.currentRun = null;
        this.status = "idle";
        cb?.callbacks.onFinished?.(ok ? "ok" : "error", execCount);
        cb?.resolve();
        void this.pump();
        return;
      }
      case "bridge_call":
        void this.handleBridgeCall(msg as unknown as BridgeCallMessage);
        return;
      default:
        return;
    }
  }

  private async handleBridgeCall(msg: BridgeCallMessage): Promise<void> {
    const fn = this.bridgeMethods[msg.method];
    let reply: OutboundReply;
    if (!fn) {
      reply = {
        type: "bridge_reply",
        id: msg.id,
        ok: false,
        error: `Unknown proxy method: ${msg.method}`,
      };
    } else {
      try {
        const value = await fn(msg.payload);
        reply = { type: "bridge_reply", id: msg.id, ok: true, value };
      } catch (err) {
        reply = {
          type: "bridge_reply",
          id: msg.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    this.worker?.postMessage(reply);
  }

  private get bridgeMethods(): Record<string, BridgeMethod> {
    return buildProxyBridge(this.runtime, this.externalCallbacks);
  }
}
