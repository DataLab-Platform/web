/**
 * Remote-control bridge for DataLab-Web embedded in an iframe.
 *
 * Exposes the same whitelist of methods as :func:`buildProxyBridge` (the
 * one already used by the macro and notebook workers — itself a mirror of
 * DataLab Qt's :class:`BaseProxy`) over ``window.postMessage``, so a host
 * page embedding DataLab-Web in an ``<iframe>`` can drive it remotely
 * (push signals/images, run Sigima processings, read results back).
 *
 * Activation: the bridge does **nothing** unless the iframe URL carries a
 * ``?allowedOrigins=`` query parameter listing one or more comma-separated
 * origins (or the literal ``*`` wildcard, intended for local development
 * only). Without it, no message listener is installed — there is zero
 * impact on the standalone DataLab-Web app.
 *
 * Wire protocol: small JSON-RPC dialect.
 *
 *   request : { id, type: "request", method, params? }
 *   response: { id, type: "response", result? | error? }
 *   event   : { type: "event", name, payload? }
 *
 * Responses with binary payloads (e.g. ``Float64Array``) attach those
 * buffers as ``Transferable`` to ``postMessage`` for zero-copy transfer.
 */

import { buildProxyBridge, type BridgeMethod } from "./proxyBridge";
import type { DataLabRuntime } from "./runtime";

export interface RemoteBridgeOptions {
  /** Initial selection / panel callbacks reused from the existing
   *  ``BridgeExternalCallbacks`` plumbing. Optional — defaults are sane
   *  for a headless embedding. */
  getSelection?: () => string[];
  getCurrentPanel?: () => string;
  setCurrentPanel?: (panel: string) => void;
  selectObjects?: (ids: string[], panel: string | null) => void;
  /** Called whenever a remote RPC mutates the in-memory object model.
   *  Wired by ``RuntimeContext`` to dispatch a ``CustomEvent`` so
   *  ``App.tsx`` can refresh the panel tree without RuntimeContext
   *  needing a direct reference to App's ``refresh`` callback. */
  onModelChanged?: (panel: string | null) => void;
  /** Override the source of allowed origins. Defaults to parsing the
   *  current ``location.search`` for ``?allowedOrigins=…``. Tests pass
   *  this explicitly. */
  allowedOriginsSource?: string | URLSearchParams | null;
  /** Override ``window`` for tests. */
  win?: Window & typeof globalThis;
  /** Application version returned by the synthetic ``get_version``
   *  bridge method. Defaults to ``import.meta.env.VITE_APP_VERSION``. */
  version?: string;
}

/** Name of the ``CustomEvent`` dispatched on ``window`` whenever a
 *  remote RPC mutates the object model. ``event.detail`` is
 *  ``{ panel: "signal" | "image" | null }``. */
export const REMOTE_MODEL_CHANGED_EVENT = "datalab-web:remote-model-changed";

interface RpcRequest {
  id: number | string;
  type: "request";
  method: string;
  params?: unknown;
}

interface RpcResponse {
  id: number | string;
  type: "response";
  result?: unknown;
  error?: { code: string; message: string };
}

interface RpcEvent {
  type: "event";
  name: string;
  payload?: unknown;
}

type OutboundMessage = RpcResponse | RpcEvent;

export interface RemoteBridgeHandle {
  /** Stop listening and release the message handler. */
  dispose(): void;
  /** Push an event to all known peer windows. */
  emit(name: string, payload?: unknown): void;
  /** The list of origins authorised for this session. ``["*"]`` means
   *  wildcard (development convenience only). */
  readonly allowedOrigins: readonly string[];
}

/**
 * Parse the ``allowedOrigins`` query parameter into a normalised list.
 *
 * - Returns an empty list if the parameter is missing or empty.
 * - Splits on commas and trims whitespace.
 * - Leaves the ``"*"`` wildcard as-is (caller decides how to treat it).
 */
export function parseAllowedOrigins(
  source: string | URLSearchParams | null | undefined,
): string[] {
  if (source == null) return [];
  const params =
    typeof source === "string" ? new URLSearchParams(source) : source;
  const raw = params.get("allowedOrigins");
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isOriginAllowed(origin: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return false;
  if (allowed.includes("*")) return true;
  return allowed.includes(origin);
}

/**
 * Walk an arbitrary value and collect every ``ArrayBuffer`` reachable
 * through ``TypedArray.buffer``. Used to populate the second argument of
 * ``postMessage`` so binary payloads transfer zero-copy.
 *
 * Caps the depth at 8 to avoid blowing the stack on cyclic structures.
 */
export function collectTransferables(value: unknown, depth = 0): ArrayBuffer[] {
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

/**
 * Activate the remote bridge.
 *
 * Returns ``null`` when no ``allowedOrigins`` is configured — callers can
 * use this signal to skip any further wiring (e.g. emitting a
 * ``ready`` event).
 */
export function activateRemoteBridge(
  runtime: DataLabRuntime,
  options: RemoteBridgeOptions = {},
): RemoteBridgeHandle | null {
  const win = options.win ?? (typeof window !== "undefined" ? window : null);
  if (!win) return null;

  const source =
    options.allowedOriginsSource !== undefined
      ? options.allowedOriginsSource
      : (win.location?.search ?? "");
  const allowedOrigins = parseAllowedOrigins(source);
  if (allowedOrigins.length === 0) return null;

  const peers = new Set<MessageEventSource>();
  const queuedEvents: RpcEvent[] = [];

  // ``post`` is defined further down; declare a forward reference so
  // the notification helpers below can capture it via closure.
  let post:
    | ((target: MessageEventSource, origin: string, msg: OutboundMessage) => void)
    | null = null;

  const flushEvents = () => {
    if (!post || queuedEvents.length === 0 || peers.size === 0) return;
    const drained = queuedEvents.splice(0);
    for (const peer of peers) {
      for (const evt of drained) post(peer, "*", evt);
    }
  };

  // Notification fan-out: every model mutation triggers (a) a
  // ``CustomEvent`` on ``window`` so the React app can refresh its
  // panel tree, and (b) an outbound RPC ``event`` so the host page can
  // react too (``client.on("model-changed", …)``).
  const notifyModelChanged = (panel: string | null) => {
    try {
      win.dispatchEvent(
        new CustomEvent(REMOTE_MODEL_CHANGED_EVENT, { detail: { panel } }),
      );
    } catch (err) {
      console.warn("[remoteBridge] dispatchEvent failed", err);
    }
    queuedEvents.push({
      type: "event",
      name: "model-changed",
      payload: { panel },
    });
    flushEvents();
  };

  const bridge: Record<string, BridgeMethod> = {
    ...buildProxyBridge(runtime, {
      getSelection: options.getSelection,
      getCurrentPanel: options.getCurrentPanel,
      setCurrentPanel: options.setCurrentPanel,
      selectObjects: options.selectObjects,
      onModelChanged: (panel) => {
        options.onModelChanged?.(panel);
        notifyModelChanged(panel);
      },
    }),
    // Synthetic method — parity with DataLab Qt's ``BaseProxy.get_version``.
    get_version: async () =>
      options.version ??
      ((globalThis as unknown as { __DLW_VERSION__?: string }).__DLW_VERSION__
        ? (globalThis as unknown as { __DLW_VERSION__: string }).__DLW_VERSION__
        : "unknown"),
  };

  post = (
    target: MessageEventSource,
    origin: string,
    msg: OutboundMessage,
  ) => {
    const transfer = collectTransferables(msg);
    const targetOrigin = origin === "" ? "*" : origin;
    try {
      // ``MessageEventSource`` has a narrower type than ``Window`` but
      // ``postMessage`` is structurally compatible at runtime.
      (target as unknown as Window).postMessage(
        msg,
        targetOrigin,
        transfer.length > 0 ? transfer : undefined,
      );
    } catch (err) {
      // Last-resort fallback: drop transferables and retry. Some
      // environments (older Safari, jsdom) don't accept the third arg.
      if (transfer.length > 0) {
        (target as unknown as Window).postMessage(msg, targetOrigin);
        return;
      }
      throw err;
    }
  };

  const handle = async (event: MessageEvent) => {
    if (!isOriginAllowed(event.origin, allowedOrigins)) return;
    const data = event.data as Partial<RpcRequest> | null;
    if (!data || data.type !== "request" || typeof data.method !== "string") {
      return;
    }
    const source = event.source;
    if (!source) return;
    peers.add(source);

    const fn = bridge[data.method];
    let response: RpcResponse;
    if (!fn) {
      response = {
        id: data.id ?? 0,
        type: "response",
        error: {
          code: "unknown_method",
          message: `Unknown method: ${data.method}`,
        },
      };
    } else {
      try {
        const result = await fn(data.params ?? {});
        response = { id: data.id ?? 0, type: "response", result };
      } catch (err) {
        response = {
          id: data.id ?? 0,
          type: "response",
          error: {
            code: "method_error",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }
    post(source, event.origin, response);
  };

  const listener = (event: MessageEvent) => {
    void handle(event);
  };

  win.addEventListener("message", listener);

  return {
    allowedOrigins,
    dispose() {
      win.removeEventListener("message", listener);
      peers.clear();
    },
    emit(name, payload) {
      const evt: RpcEvent = { type: "event", name, payload };
      for (const peer of peers) {
        // Origin is unknown here (we only know ``event.origin`` per peer),
        // so we re-broadcast with ``"*"`` — restricted in practice because
        // ``peers`` only contains sources whose origin was whitelisted.
        post(peer, "*", evt);
      }
    },
  };
}
