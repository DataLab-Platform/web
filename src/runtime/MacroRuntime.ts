/**
 * Main-thread controller for the macro Web Worker.
 *
 * Owns the live ``Worker`` instance plus a "warm" spare worker (kept
 * ready so a Stop+Run sequence is fast despite Pyodide's ~5 s
 * cold-start).  Routes ``proxy.*`` bridge calls from the worker to a
 * whitelisted set of :class:`DataLabRuntime` methods.
 */

import type { RuntimeApi } from "./runtime";
import {
  buildProxyBridge,
  type BridgeExternalCallbacks,
  type BridgeMethod,
} from "./proxyBridge";
import {
  startWorker,
  waitForWorkerReady,
  WorkerStartCancelled,
} from "./workerReady";
import { pyodideLang } from "../i18n/locale";

export type MacroStreamKind = "stdout" | "stderr" | "system";

export interface MacroRunCallbacks {
  onStream?: (kind: MacroStreamKind, text: string) => void;
  onStarted?: (name: string) => void;
  onFinished?: (status: "ok" | "error" | "stopped", error?: string) => void;
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

/** A start cancelled by a dispose is not an error. */
function ignoreCancelled(error: unknown): void {
  if (!(error instanceof WorkerStartCancelled)) throw error;
}

/** A worker started in advance, promoted when the live one is stopped. */
interface SpareWorker {
  worker: Worker;
  ready: boolean;
  abort: AbortController;
}

export class MacroRuntime {
  private worker: Worker | null = null;
  /** Whether the (current) worker has finished its initial Pyodide load. */
  private workerReady = false;
  /** Start of the live worker in progress (shared by concurrent callers). */
  private starting: Promise<void> | null = null;
  private startAbort: AbortController | null = null;
  /** Spare worker, so that Stop ⇒ Run is near-instant. */
  private spare: SpareWorker | null = null;
  private currentRun: MacroRunCallbacks | null = null;
  private state: "idle" | "running" | "stopping" = "idle";

  constructor(private readonly runtime: RuntimeApi) {}

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  /** Eagerly create & init the worker so the first Run is fast. */
  async preload(): Promise<void> {
    await this.ensureWorker().catch(ignoreCancelled);
  }

  isRunning(): boolean {
    return this.state === "running";
  }

  /** Run *code* and stream output to the supplied callbacks. */
  async run(
    code: string,
    name: string,
    callbacks: MacroRunCallbacks,
  ): Promise<void> {
    if (this.state !== "idle") {
      throw new Error("A macro is already running. Stop it first.");
    }
    await this.ensureWorker();
    this.currentRun = callbacks;
    this.state = "running";
    callbacks.onStream?.("system", `▶ Running "${name}"…\n`);
    this.worker!.postMessage({ type: "run", code, name });
  }

  /** Hard-stop the running macro (terminates the worker). */
  stop(): void {
    if (this.state !== "running" || !this.worker) return;
    this.state = "stopping";
    const cb = this.currentRun;
    this.terminateLive();
    cb?.onStream?.("system", "■ Stopped by user.\n");
    cb?.onFinished?.("stopped");
    this.currentRun = null;
    this.state = "idle";
    // Promote the spare worker when ready (or start a fresh one) so the
    // next Run is instant.
    const spare = this.spare;
    if (spare?.ready) {
      this.spare = null;
      this.adopt(spare.worker);
      this.spawnSpare();
    } else {
      void this.ensureWorker().catch(ignoreCancelled);
    }
  }

  /** Terminate every worker (live, starting and spare). */
  dispose(): void {
    this.terminateLive();
    if (this.spare) {
      this.spare.abort.abort();
      this.spare.worker.terminate();
      this.spare = null;
    }
    this.currentRun = null;
    this.state = "idle";
  }

  // ---------------------------------------------------------------------
  // Worker lifecycle
  // ---------------------------------------------------------------------

  /** Terminate the live worker, ready or still starting. */
  private terminateLive(): void {
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
  }

  /** Start the live worker (with a fresh one if it fails to start, see
   *  ``workerReady.ts``), then a spare one. */
  private ensureWorker(): Promise<void> {
    if (this.worker && this.workerReady) return Promise.resolve();
    if (!this.starting) {
      const abort = new AbortController();
      this.startAbort = abort;
      const starting = startWorker({
        spawn: () => this.spawnWorker(),
        onSpawn: (worker) => {
          this.worker = worker;
          this.workerReady = false;
        },
        signal: abort.signal,
        label: "macro worker",
      }).then(
        () => {
          if (this.starting !== starting) return;
          this.starting = null;
          this.startAbort = null;
          this.workerReady = true;
          this.spawnSpare();
        },
        (error: unknown) => {
          if (this.starting === starting) {
            this.starting = null;
            this.startAbort = null;
            this.worker = null;
          }
          throw error;
        },
      );
      this.starting = starting;
    }
    return this.starting;
  }

  private createWorker(): Worker {
    const w = new Worker(new URL("./macroWorker.ts", import.meta.url), {
      type: "module",
    });
    w.postMessage({ type: "init", lang: pyodideLang() });
    return w;
  }

  /** Route the messages of the live worker to the running macro. */
  private attach(w: Worker): void {
    w.onmessage = (ev) => this.handleWorkerMessage(ev.data);
    w.onerror = (ev) => {
      const msg = ev.message || "worker error";
      this.currentRun?.onStream?.("stderr", msg + "\n");
      this.currentRun?.onFinished?.("error", msg);
      this.currentRun = null;
      this.state = "idle";
    };
  }

  private spawnWorker(): Worker {
    const w = this.createWorker();
    this.attach(w);
    return w;
  }

  private adopt(w: Worker): void {
    this.attach(w);
    this.worker = w;
    this.workerReady = true;
  }

  /** Start a spare worker (unless one exists); one that fails to start is
   *  dropped (the next Stop then starts a fresh live worker). */
  private spawnSpare(): void {
    if (this.spare) return;
    const spare: SpareWorker = {
      worker: this.createWorker(),
      ready: false,
      abort: new AbortController(),
    };
    this.spare = spare;
    waitForWorkerReady(spare.worker, {
      signal: spare.abort.signal,
      label: "macro worker (spare)",
    }).then(
      () => {
        spare.ready = true;
      },
      (error: unknown) => {
        if (error instanceof WorkerStartCancelled) return;
        console.warn("[macro worker] spare worker failed to start", error);
        spare.worker.terminate();
        if (this.spare === spare) this.spare = null;
      },
    );
  }

  // ---------------------------------------------------------------------
  // Worker → main-thread message dispatch
  // ---------------------------------------------------------------------

  private handleWorkerMessage(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const msg = data as Record<string, unknown>;
    const type = msg.type as string | undefined;
    switch (type) {
      case "ready":
        // Already handled by waitForWorkerReady; ignore late arrivals.
        return;
      case "stdout":
        this.currentRun?.onStream?.("stdout", String(msg.text ?? ""));
        return;
      case "stderr":
        this.currentRun?.onStream?.("stderr", String(msg.text ?? ""));
        return;
      case "started":
        this.currentRun?.onStarted?.(String(msg.name ?? ""));
        return;
      case "finished": {
        const ok = Boolean(msg.ok);
        const cb = this.currentRun;
        this.currentRun = null;
        this.state = "idle";
        cb?.onStream?.(
          "system",
          ok ? "✓ Finished.\n" : `✗ Finished with error.\n`,
        );
        cb?.onFinished?.(ok ? "ok" : "error", msg.error as string | undefined);
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

  // ---------------------------------------------------------------------
  // Bridge whitelist — methods reachable from a macro via ``proxy.*``.
  // The actual handlers live in :file:`proxyBridge.ts` so the notebook
  // worker (which speaks the same protocol) can reuse them verbatim.
  // ---------------------------------------------------------------------

  private get bridgeMethods(): Record<string, BridgeMethod> {
    return buildProxyBridge(this.runtime, this.externalCallbacks);
  }

  // ---------------------------------------------------------------------
  // External callbacks — wired by App.tsx so the bridge can read the
  // current selection / active panel without re-implementing them here.
  // ---------------------------------------------------------------------

  externalCallbacks: BridgeExternalCallbacks = {};
}
