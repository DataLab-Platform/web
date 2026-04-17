/**
 * Main-thread controller for the macro Web Worker.
 *
 * Owns the live ``Worker`` instance plus a "warm" replacement worker
 * (kept ready so a Stop+Run sequence is fast despite Pyodide's ~5 s
 * cold-start).  Routes ``proxy.*`` bridge calls from the worker to a
 * whitelisted set of :class:`SigimaRuntime` methods.
 */

import type { SigimaRuntime } from "./runtime";

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

/** Only these :class:`SigimaRuntime` methods are reachable from a macro. */
type BridgeMethod = (...args: unknown[]) => Promise<unknown>;

export class MacroRuntime {
  private worker: Worker | null = null;
  private warmWorker: Worker | null = null;
  /** Whether the (current) worker has finished its initial Pyodide load. */
  private workerReady = false;
  private currentRun: MacroRunCallbacks | null = null;
  private state: "idle" | "running" | "stopping" = "idle";

  constructor(private readonly sigima: SigimaRuntime) {}

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
  // Each handler receives the raw payload (already JSON-deserialised).
  // ---------------------------------------------------------------------

  private get bridgeMethods(): Record<string, BridgeMethod> {
    const s = this.sigima;
    const ext = this.externalCallbacks;
    const arr = (v: unknown): number[] | number[][] =>
      v as number[] | number[][];
    return {
      add_signal: async (p: unknown) => {
        const a = p as {
          title: string;
          xdata: number[];
          ydata: number[];
          xunit?: string;
          yunit?: string;
          xlabel?: string;
          ylabel?: string;
          group_id?: string | null;
        };
        const oid = await s.addSignalFromArrays({
          title: a.title,
          xdata: a.xdata,
          ydata: a.ydata,
          xunit: a.xunit ?? "",
          yunit: a.yunit ?? "",
          xlabel: a.xlabel ?? "",
          ylabel: a.ylabel ?? "",
          group_id: a.group_id ?? null,
        });
        ext.onModelChanged?.("signal");
        return oid;
      },
      add_image: async (p: unknown) => {
        const a = p as {
          title: string;
          data: number[][];
          xunit?: string;
          yunit?: string;
          zunit?: string;
          xlabel?: string;
          ylabel?: string;
          zlabel?: string;
          group_id?: string | null;
        };
        const oid = await s.addImageFromArray({
          title: a.title,
          data: a.data,
          xunit: a.xunit ?? "",
          yunit: a.yunit ?? "",
          zunit: a.zunit ?? "",
          xlabel: a.xlabel ?? "",
          ylabel: a.ylabel ?? "",
          zlabel: a.zlabel ?? "",
          group_id: a.group_id ?? null,
        });
        ext.onModelChanged?.("image");
        return oid;
      },
      list_signals: async () => s.listSignals(),
      list_images: async () =>
        (await s.runPython(`
[{"id": oid, "title": e.obj.title}
 for oid, e in _MODEL._objects.items() if e.kind == "image"]
`)) as unknown,
      get_object: async (p: unknown) => {
        const oid = (p as { oid: string }).oid;
        return (await s.runPython(`
_e = _MODEL._objects[${JSON.stringify(oid)}]
{
  "id": _e.oid,
  "kind": _e.kind,
  "title": _e.obj.title,
}
`)) as unknown;
      },
      get_object_uuids: async (p: unknown) => {
        const panel = (p as { panel: string }).panel;
        return (await s.runPython(`
[oid for oid, e in _MODEL._objects.items() if e.kind == ${JSON.stringify(panel)}]
`)) as unknown;
      },
      delete_object: async (p: unknown) => {
        const oid = (p as { oid: string }).oid;
        await s.runPython(`_MODEL.delete_object(${JSON.stringify(oid)})`);
        ext.onModelChanged?.(null);
        return null;
      },
      apply_feature: async (p: unknown) => {
        const a = p as {
          feature_id: string;
          params: Record<string, unknown> | null;
          sources: string[] | null;
          operand: string | null;
        };
        // Resolve sources: explicit ⇒ as-is; else current selection on
        // the source's panel (delegated to JS layer via callbacks).
        const sources = a.sources ?? ext.getSelection?.() ?? [];
        const ids = await s.applyFeature(
          a.feature_id,
          sources,
          a.operand,
          a.params,
        );
        ext.onModelChanged?.(null);
        return ids;
      },
      list_features: async () => s.listFeatures(),
      get_current_panel: async () => ext.getCurrentPanel?.() ?? "signal",
      set_current_panel: async (p: unknown) => {
        const panel = (p as { panel: string }).panel;
        ext.setCurrentPanel?.(panel);
        return null;
      },
      select_objects: async (p: unknown) => {
        const a = p as { oids: string[]; panel: string | null };
        ext.selectObjects?.(a.oids, a.panel);
        return null;
      },
      call_method: async (p: unknown) => {
        const a = p as {
          name: string;
          args: unknown[];
          kwargs: Record<string, unknown>;
        };
        const handler = ext.callMethod;
        if (!handler) {
          throw new Error("call_method bridge not wired");
        }
        return handler(a.name, a.args, a.kwargs);
      },
      // Reference ``arr`` so TypeScript does not flag it as unused if
      // future bridge handlers want a quick array coercion helper.
      _noop: async () => arr([]),
    };
  }

  // ---------------------------------------------------------------------
  // External callbacks — wired by App.tsx so the bridge can read the
  // current selection / active panel without re-implementing them here.
  // ---------------------------------------------------------------------

  externalCallbacks: {
    getSelection?: () => string[];
    getCurrentPanel?: () => string;
    setCurrentPanel?: (panel: string) => void;
    selectObjects?: (ids: string[], panel: string | null) => void;
    onModelChanged?: (panel: string | null) => void;
    callMethod?: (
      name: string,
      args: unknown[],
      kwargs: Record<string, unknown>,
    ) => Promise<unknown>;
  } = {};
}
