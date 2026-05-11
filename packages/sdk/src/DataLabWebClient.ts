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

/** MAJOR version of the wire protocol this SDK supports.
 *
 *  When the iframe reports a different MAJOR via
 *  ``get_protocol_version``, ``ready()`` rejects: the host page must
 *  upgrade the SDK (or the bundle) to a compatible pair.
 *
 *  See ``RPC_PROTOCOL_VERSION`` in ``remoteBridge.ts`` for the
 *  authoritative server-side value and bump rules. */
export const SUPPORTED_PROTOCOL_MAJOR = 1;

/** Default value assumed when the iframe does not implement
 *  ``get_protocol_version`` (older bundle predating versioning). */
const DEFAULT_PROTOCOL_VERSION = "1.0";

export class DataLabWebClient {
  private readonly win: Window & typeof globalThis;
  private readonly targetOrigin: string;
  private readonly defaultTimeoutMs: number;
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private listeners = new Map<string, Set<EventListener>>();
  private readyPromise: Promise<string> | null = null;
  private _protocolVersion: string | null = null;
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

  /** Wire-protocol version reported by the iframe (semver
   *  ``MAJOR.MINOR``). ``null`` until ``ready()`` resolves. */
  get protocolVersion(): string | null {
    return this._protocolVersion;
  }

  /** Wait until the iframe responds to a basic probe. Resolves with the
   *  reported version string. Memoised — repeated calls return the same
   *  promise. Use this to gate calls that depend on Pyodide being ready.
   *
   *  Also negotiates the wire-protocol version: rejects if the iframe
   *  reports a MAJOR incompatible with this SDK (see
   *  ``SUPPORTED_PROTOCOL_MAJOR``). */
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
        const version = (await this.call(
          "get_version",
          undefined,
          5_000,
        )) as string;
        // Negotiate protocol compatibility *after* a successful probe.
        // Older bundles may not implement ``get_protocol_version``; we
        // treat ``unknown_method`` as "protocol 1.0" for graceful
        // fallback. Any other failure surfaces as a normal rejection.
        let proto: string;
        try {
          proto = (await this.call(
            "get_protocol_version",
            undefined,
            5_000,
          )) as string;
        } catch (err) {
          if (
            err instanceof DataLabWebRemoteError &&
            err.code === "unknown_method"
          ) {
            proto = DEFAULT_PROTOCOL_VERSION;
          } else {
            throw err;
          }
        }
        const remoteMajor = parseProtocolMajor(proto);
        if (remoteMajor !== SUPPORTED_PROTOCOL_MAJOR) {
          throw new Error(
            `DataLab-Web wire-protocol mismatch: iframe reports ${proto}, ` +
              `SDK supports MAJOR ${SUPPORTED_PROTOCOL_MAJOR}. ` +
              `Upgrade either the SDK or the DataLab-Web bundle to a ` +
              `compatible pair.`,
          );
        }
        this._protocolVersion = proto;
        return version;
      } catch (err) {
        // Protocol-mismatch errors are terminal — no point retrying.
        if (
          err instanceof Error &&
          err.message.startsWith("DataLab-Web wire-protocol mismatch")
        ) {
          throw err;
        }
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

  /** Return the wire-protocol version reported by the iframe (semver
   *  ``MAJOR.MINOR``). Independent from the application version
   *  returned by :meth:`getVersion`. */
  getProtocolVersion(): Promise<string> {
    return this.call("get_protocol_version") as Promise<string>;
  }

  /** Push a 1-D signal to DataLab-Web.
   *
   *  ``xdata``/``ydata`` may be a ``Float64Array`` (recommended for
   *  large signals — passed zero-copy via structured-clone
   *  transferables and ingested as a numpy view), a
   *  ``Float32Array`` (will be widened to float64 on the Python
   *  side), or a plain ``number[]`` (slow legacy path, kept for
   *  convenience on small signals). */
  addSignal(
    title: string,
    xdata: number[] | Float32Array | Float64Array,
    ydata: number[] | Float32Array | Float64Array,
    extras: {
      xunit?: string;
      yunit?: string;
      xlabel?: string;
      ylabel?: string;
      group_id?: string | null;
    } = {},
  ): Promise<string> {
    // Normalise to Float64Array so the wire payload is a single
    // typed-array memcpy on every browser.  ``Array.from`` would
    // boxify each value into a JS Number — at 1 M samples that's
    // ~50 MB of intermediate JS heap allocations.
    const xs = toFloat64Array(xdata);
    const ys = toFloat64Array(ydata);
    return this.call("add_signal", {
      title,
      xdata: xs,
      ydata: ys,
      ...extras,
    }) as Promise<string>;
  }

  /** Push a 2-D image to DataLab-Web.
   *
   *  Accepts either:
   *  - a nested ``number[][]`` (legacy, slow but trivially serialisable);
   *  - a flat typed array + ``{ width, height }`` (fast path:
   *    zero-copy across iframe and Pyodide).  Use this for any image
   *    larger than a few hundred kB.
   */
  addImage(
    title: string,
    data:
      | number[][]
      | { width: number; height: number; data: Float32Array | Float64Array },
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
    if (Array.isArray(data)) {
      return this.call("add_image", {
        title,
        data,
        ...extras,
      }) as Promise<string>;
    }
    return this.call("add_image", {
      title,
      data: data.data,
      width: data.width,
      height: data.height,
      dtype: data.data instanceof Float32Array ? "float32" : "float64",
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

  /** Read back X / Y arrays of a signal.
   *
   *  Uses the binary ``encoding="bytes"`` mode of ``get_signal_xy``
   *  — the Pyodide side ships raw little-endian float64 bytes which
   *  we re-wrap as ``Float64Array`` here.  For a 1 M-sample signal
   *  this is a single 8 MB memcpy across the bridge instead of
   *  building a 1 M-element JSON array.
   */
  async getSignalXY(oid: string): Promise<SignalXY> {
    const raw = (await this.call("get_signal_xy", {
      oid,
      encoding: "bytes",
    })) as SignalXY & {
      encoding?: string;
      x_bytes?: ArrayBufferView | ArrayBuffer;
      y_bytes?: ArrayBufferView | ArrayBuffer;
    };
    if (raw.encoding === "f64" && raw.x_bytes && raw.y_bytes) {
      return {
        ...raw,
        x: bytesToFloat64Array(raw.x_bytes),
        y: bytesToFloat64Array(raw.y_bytes),
      };
    }
    return raw as SignalXY;
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

  /** Return the ids currently selected on the active panel.
   *  Empty array when nothing is selected. */
  getSelection(): Promise<string[]> {
    return this.call("get_selection") as Promise<string[]>;
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

/** Parse the MAJOR component of a ``MAJOR.MINOR`` semver-ish string.
 *  Returns ``NaN`` if the input is malformed. */
function parseProtocolMajor(version: string): number {
  if (typeof version !== "string") return NaN;
  const head = version.split(".", 1)[0];
  const n = Number.parseInt(head, 10);
  return Number.isFinite(n) ? n : NaN;
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

/** Coerce ``number[]`` / ``Float32Array`` / ``Float64Array`` into a
 *  ``Float64Array`` without copying when the input already is one. */
function toFloat64Array(
  data: number[] | Float32Array | Float64Array,
): Float64Array {
  if (data instanceof Float64Array) return data;
  if (data instanceof Float32Array) return Float64Array.from(data);
  return Float64Array.from(data);
}

/** Re-wrap a raw ``Uint8Array`` / ``ArrayBuffer`` returned by the
 *  Pyodide bridge as a ``Float64Array`` view (zero-copy). */
function bytesToFloat64Array(raw: ArrayBufferView | ArrayBuffer): Float64Array {
  if (raw instanceof ArrayBuffer) return new Float64Array(raw);
  return new Float64Array(
    raw.buffer,
    raw.byteOffset,
    raw.byteLength / Float64Array.BYTES_PER_ELEMENT,
  );
}
