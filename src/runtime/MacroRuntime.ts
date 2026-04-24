/**
 * Main-thread controller for the macro Web Worker.
 *
 * Owns the live ``Worker`` instance plus a "warm" replacement worker
 * (kept ready so a Stop+Run sequence is fast despite Pyodide's ~5 s
 * cold-start).  Routes ``proxy.*`` bridge calls from the worker to a
 * whitelisted set of :class:`DataLabRuntime` methods.
 */

import type { DataLabRuntime } from "./runtime";
import {
  buildProxyBridge,
  type BridgeExternalCallbacks,
  type BridgeMethod,
} from "./proxyBridge";

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

export class MacroRuntime {
  private worker: Worker | null = null;
  private warmWorker: Worker | null = null;
  /** Whether the (current) worker has finished its initial Pyodide load. */
  private workerReady = false;
  private currentRun: MacroRunCallbacks | null = null;
  private state: "idle" | "running" | "stopping" = "idle";

  constructor(private readonly runtime: DataLabRuntime) {}

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  /** Eagerly create & init the worker so the first Run is fast. */
  async preload(): Promise<void> {
    await this.ensureWorker();
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
    try {
      this.worker.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;
    this.workerReady = false;
    cb?.onStream?.("system", "■ Stopped by user.\n");
    cb?.onFinished?.("stopped");
    this.currentRun = null;
    this.state = "idle";
    // Promote the warm worker (or spawn one) so the next Run is instant.
    if (this.warmWorker) {
      this.adoptWarmWorker();
    } else {
      void this.ensureWorker();
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.warmWorker?.terminate();
    this.worker = null;
    this.warmWorker = null;
    this.workerReady = false;
    this.currentRun = null;
    this.state = "idle";
  }

  // ---------------------------------------------------------------------
  // Worker lifecycle
  // ---------------------------------------------------------------------

  private async ensureWorker(): Promise<void> {
    if (this.worker && this.workerReady) return;
    if (!this.worker) {
      this.worker = this.spawnWorker();
    }
    if (!this.workerReady) {
      await this.waitForReady(this.worker);
      this.workerReady = true;
      // As soon as the live worker is ready, pre-warm a replacement so
      // Stop ⇒ Run is near-instant.
      this.spawnWarmWorker();
    }
  }

  private spawnWorker(): Worker {
    const w = new Worker(new URL("./macroWorker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (ev) => this.handleWorkerMessage(ev.data);
    w.onerror = (ev) => {
      const msg = ev.message || "worker error";
      this.currentRun?.onStream?.("stderr", msg + "\n");
      this.currentRun?.onFinished?.("error", msg);
      this.currentRun = null;
      this.state = "idle";
    };
    w.postMessage({ type: "init" });
    return w;
  }

  private spawnWarmWorker(): void {
    if (this.warmWorker) return;
    const w = new Worker(new URL("./macroWorker.ts", import.meta.url), {
      type: "module",
    });
    let ready = false;
    w.onmessage = (ev) => {
      const data = ev.data as { type?: string };
      if (data?.type === "ready") {
        ready = true;
      }
      // Warm worker should not receive anything else before adoption.
    };
    w.postMessage({ type: "init" });
    this.warmWorker = w;
    // Track readiness for adoptWarmWorker(); we only adopt if ready.
    (w as unknown as { __ready: () => boolean }).__ready = () => ready;
  }

  private adoptWarmWorker(): void {
    const w = this.warmWorker!;
    this.warmWorker = null;
    this.worker = w;
    this.workerReady =
      (w as unknown as { __ready?: () => boolean }).__ready?.() ?? false;
    w.onmessage = (ev) => this.handleWorkerMessage(ev.data);
    w.onerror = (ev) => {
      const msg = ev.message || "worker error";
      this.currentRun?.onStream?.("stderr", msg + "\n");
      this.currentRun?.onFinished?.("error", msg);
      this.currentRun = null;
      this.state = "idle";
    };
    if (!this.workerReady) {
      // Will resolve once the warm worker finishes loading Pyodide.
      void this.waitForReady(w).then(() => {
        this.workerReady = true;
        this.spawnWarmWorker();
      });
    } else {
      this.spawnWarmWorker();
    }
  }

  private waitForReady(w: Worker): Promise<void> {
    return new Promise((resolve, reject) => {
      const prev = w.onmessage;
      const onMsg = (ev: MessageEvent) => {
        const data = ev.data as { type?: string };
        if (data?.type === "ready") {
          w.onmessage = prev;
          resolve();
        } else if (prev) {
          // Forward unrelated messages (defensive — shouldn't happen).
          (prev as (e: MessageEvent) => void).call(w, ev);
        }
      };
      w.onmessage = onMsg;
      const onErr = (ev: ErrorEvent) => {
        reject(new Error(ev.message || "worker init failed"));
      };
      w.addEventListener("error", onErr, { once: true });
    });
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
        // Already handled in waitForReady; ignore late arrivals.
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
