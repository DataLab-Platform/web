/**
 * Client SDK for the DataLab-Web remote-control bridge.
 *
 * Hides the ``postMessage`` plumbing behind a Promise-based API that
 * mirrors DataLab Qt's :class:`BaseProxy`. Intended to be embedded in a
 * host page that loads DataLab-Web in an ``<iframe>``.
 *
 * Usage:
 *
 *   ```ts
 *   const iframe = document.getElementById("dlw") as HTMLIFrameElement;
 *   const client = new DataLabWebClient(iframe, {
 *     targetOrigin: "http://localhost:5173",
 *   });
 *   await client.ready();
 *   const id = await client.addSignal("Sine", xs, ys);
 *   const ids = await client.applyFeature("fft", { sources: [id] });
 *   const data = await client.getSignalXY(ids[0]);
 *   ```
 *
 * The SDK has zero runtime dependencies (no React, no bundler-specific
 * imports) so it can be consumed by any page.
 */

export interface DataLabWebClientOptions {
  /** Origin of the DataLab-Web iframe. Required so we don't leak
   *  request payloads to the wrong document. Use the iframe's
   *  ``src`` origin (e.g. ``"https://datalab.example.com"``). */
  targetOrigin: string;
  /** Default request timeout in ms. ``0`` disables. Defaults to 30 s. */
  defaultTimeoutMs?: number;
  /** Override ``window`` for tests. */
  win?: Window & typeof globalThis;
}

export interface DataLabWebRpcError {
  code: string;
  message: string;
}

export class DataLabWebRemoteError extends Error {
  readonly code: string;
  constructor(err: DataLabWebRpcError) {
    super(err.message);
    this.name = "DataLabWebRemoteError";
    this.code = err.code;
  }
}

export interface SignalXY {
  id: string;
  title: string;
  size: number;
  x: number[] | Float64Array;
  y: number[] | Float64Array;
  xlabel?: string;
  ylabel?: string;
  xunit?: string;
  yunit?: string;
}

export interface ImageData2D {
  id: string;
  title: string;
  data: Float32Array[];
  shape: [number, number];
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface RpcResponse {
  id: number | string;
  type: "response";
  result?: unknown;
  error?: DataLabWebRpcError;
}

interface RpcEvent {
  type: "event";
  name: string;
  payload?: unknown;
}

type EventListener = (payload: unknown) => void;

export class DataLabWebClient {
  private readonly win: Window & typeof globalThis;
  private readonly targetOrigin: string;
  private readonly defaultTimeoutMs: number;
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private listeners = new Map<string, Set<EventListener>>();
  private readyPromise: Promise<string> | null = null;
  private disposed = false;

  constructor(
    private readonly iframe: HTMLIFrameElement,
    options: DataLabWebClientOptions,
  ) {
    this.win = options.win ?? (window as Window & typeof globalThis);
    this.targetOrigin = options.targetOrigin;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.win.addEventListener("message", this.handleMessage);
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  /** Wait until the iframe responds to a basic probe. Resolves with the
   *  reported version string. Memoised — repeated calls return the same
   *  promise. Use this to gate calls that depend on Pyodide being ready. */
  ready(timeoutMs = 60_000): Promise<string> {
    if (!this.readyPromise) {
      this.readyPromise = this.pollReady(timeoutMs);
    }
    return this.readyPromise;
  }

  private async pollReady(timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let lastErr: unknown = null;
    while (Date.now() < deadline) {
      try {
        return (await this.call("get_version", undefined, 5_000)) as string;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw new Error(
      `DataLab-Web did not become ready within ${timeoutMs} ms` +
        (lastErr ? ` (last error: ${String(lastErr)})` : ""),
    );
  }

  /** Detach the message listener and reject any pending requests. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.win.removeEventListener("message", this.handleMessage);
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error("DataLabWebClient disposed"));
    }
    this.pending.clear();
    this.listeners.clear();
  }

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------

  on(name: string, cb: EventListener): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(cb);
    return () => set?.delete(cb);
  }

  // ---------------------------------------------------------------------
  // Low-level RPC
  // ---------------------------------------------------------------------

  /** Send an arbitrary RPC request. Prefer the typed helpers below. */
  call(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error("DataLabWebClient disposed"));
    }
    const target = this.iframe.contentWindow;
    if (!target) {
      return Promise.reject(new Error("iframe has no contentWindow"));
    }
    const id = this.nextId++;
    const request = { id, type: "request" as const, method, params };
    const transfer = collectTransferables(request);

    return new Promise((resolve, reject) => {
      const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;
      const timer =
        effectiveTimeout > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(
                new Error(
                  `Remote call "${method}" timed out after ${effectiveTimeout} ms`,
                ),
              );
            }, effectiveTimeout)
          : null;
      this.pending.set(id, { resolve, reject, timer });
      try {
        target.postMessage(
          request,
          this.targetOrigin,
          transfer.length > 0 ? transfer : undefined,
        );
      } catch (err) {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  // ---------------------------------------------------------------------
  // BaseProxy-mirroring helpers
  // ---------------------------------------------------------------------

  getVersion(): Promise<string> {
    return this.call("get_version") as Promise<string>;
  }

  addSignal(
    title: string,
    xdata: number[] | Float64Array,
    ydata: number[] | Float64Array,
    extras: {
      xunit?: string;
      yunit?: string;
      xlabel?: string;
      ylabel?: string;
      group_id?: string | null;
    } = {},
  ): Promise<string> {
    return this.call("add_signal", {
      title,
      xdata: Array.from(xdata),
      ydata: Array.from(ydata),
      ...extras,
    }) as Promise<string>;
  }

  addImage(
    title: string,
    data: number[][],
    extras: {
      xunit?: string;
      yunit?: string;
      zunit?: string;
      xlabel?: string;
      ylabel?: string;
      zlabel?: string;
      group_id?: string | null;
    } = {},
  ): Promise<string> {
    return this.call("add_image", {
      title,
      data,
      ...extras,
    }) as Promise<string>;
  }

  listSignals(): Promise<unknown[]> {
    return this.call("list_signals") as Promise<unknown[]>;
  }

  listImages(): Promise<unknown[]> {
    return this.call("list_images") as Promise<unknown[]>;
  }

  getObject(oid: string): Promise<{ id: string; kind: string; title: string }> {
    return this.call("get_object", { oid }) as Promise<{
      id: string;
      kind: string;
      title: string;
    }>;
  }

  getObjectUuids(panel: "signal" | "image" = "signal"): Promise<string[]> {
    return this.call("get_object_uuids", { panel }) as Promise<string[]>;
  }

  deleteObject(oid: string): Promise<null> {
    return this.call("delete_object", { oid }) as Promise<null>;
  }

  getSignalXY(oid: string): Promise<SignalXY> {
    return this.call("get_signal_xy", { oid }) as Promise<SignalXY>;
  }

  getImageData(oid: string): Promise<ImageData2D> {
    return this.call("get_image_data", { oid }) as Promise<ImageData2D>;
  }

  /** Apply a registered Sigima processing.
   *
   *  ``params.sources`` defaults to the current selection on the
   *  DataLab-Web side; pass an explicit array to be deterministic. */
  applyFeature(
    featureId: string,
    options: {
      sources?: string[] | null;
      operand?: string | null;
      params?: Record<string, unknown> | null;
    } = {},
  ): Promise<string[]> {
    return this.call("apply_feature", {
      feature_id: featureId,
      params: options.params ?? null,
      sources: options.sources ?? null,
      operand: options.operand ?? null,
    }) as Promise<string[]>;
  }

  /** DataLab Qt parity alias for :meth:`applyFeature`. */
  calc(
    featureId: string,
    params: Record<string, unknown> | null = null,
    sources: string[] | null = null,
  ): Promise<string[]> {
    return this.applyFeature(featureId, { params, sources });
  }

  listFeatures(): Promise<unknown[]> {
    return this.call("list_features") as Promise<unknown[]>;
  }

  selectObjects(
    oids: string[],
    panel: "signal" | "image" | null = null,
  ): Promise<null> {
    return this.call("select_objects", { oids, panel }) as Promise<null>;
  }

  setCurrentPanel(panel: "signal" | "image" | "macro"): Promise<null> {
    return this.call("set_current_panel", { panel }) as Promise<null>;
  }

  getCurrentPanel(): Promise<string> {
    return this.call("get_current_panel") as Promise<string>;
  }

  resetAll(): Promise<null> {
    return this.call("reset_all") as Promise<null>;
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private handleMessage = (event: MessageEvent) => {
    if (event.source !== this.iframe.contentWindow) return;
    const data = event.data as RpcResponse | RpcEvent | null;
    if (!data || typeof data !== "object") return;
    if (data.type === "response") {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (pending.timer) clearTimeout(pending.timer);
      if (data.error) {
        pending.reject(new DataLabWebRemoteError(data.error));
      } else {
        pending.resolve(data.result);
      }
    } else if (data.type === "event") {
      const set = this.listeners.get(data.name);
      if (set) {
        for (const cb of set) {
          try {
            cb(data.payload);
          } catch (err) {
            console.error(
              `[DataLabWebClient] listener for "${data.name}" threw`,
              err,
            );
          }
        }
      }
    }
  };
}

function collectTransferables(value: unknown, depth = 0): ArrayBuffer[] {
  if (depth > 8 || value == null || typeof value !== "object") return [];
  const out: ArrayBuffer[] = [];
  if (value instanceof ArrayBuffer) {
    out.push(value);
    return out;
  }
  if (ArrayBuffer.isView(value)) {
    const buf = (value as ArrayBufferView).buffer;
    if (buf instanceof ArrayBuffer) out.push(buf);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value)
      out.push(...collectTransferables(item, depth + 1));
    return out;
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    out.push(...collectTransferables(v, depth + 1));
  }
  return out;
}
