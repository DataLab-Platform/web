/**
 * Wire protocol between the main thread and the runtime kernel worker.
 *
 * When DataLab-Web runs in *worker mode*, the single Pyodide instance and
 * the whole {@link DataLabRuntime} live inside a Dedicated Web Worker
 * (``kernelWorker.ts``). The UI talks to it through {@link WorkerRuntimeProxy}
 * — a main-thread object that implements {@link RuntimeApi} by forwarding
 * every method call as a ``postMessage`` request and awaiting the reply.
 *
 * This module defines the message envelopes shared by both sides so they
 * stay in lock-step. Three traffic patterns cross the boundary:
 *
 *   1. **Request/reply** — the proxy posts a {@link CallRequest} and the
 *      worker answers with a matching {@link ResultEvent} (``ok``/``error``).
 *   2. **Worker-initiated events** — workspace mutations
 *      ({@link MutationEvent}) and Python dialog requests
 *      ({@link DialogRequestEvent}) are pushed up so the main thread can
 *      flip its "dirty" flag and render dialogs.
 *   3. **State mirror** — the four synchronous accessors of
 *      {@link RuntimeApi} (``getStorageMode`` / ``getDiskStoreBytes`` /
 *      ``getSpilledCount`` / ``getMemoryUsage``) cannot do a round-trip, so
 *      the worker pushes a {@link MirrorEvent} snapshot that the proxy
 *      serves synchronously from a local cache.
 *
 * All payloads are structured-clone-safe (numbers, strings, arrays, typed
 * arrays, plain objects, ``Blob``/``File``). Binary returns produced by the
 * runtime are own-buffer copies (``.slice()``), never live views onto the
 * WASM heap, so cloning them across the boundary is bounded by the payload
 * size — not the whole heap.
 */
import type { MemoryUsage } from "../utils/memory";
import type { StorageMode } from "./runtime";

/** Synchronous-accessor snapshot the worker pushes to the proxy's cache. */
export interface KernelMirror {
  storageMode: StorageMode;
  diskStoreBytes: number;
  spilledCount: number;
  memoryUsage: MemoryUsage;
}

/** The zeroed mirror served before the worker pushes its first snapshot. */
export const INITIAL_MIRROR: KernelMirror = {
  storageMode: "ram",
  diskStoreBytes: 0,
  spilledCount: 0,
  memoryUsage: {
    wasmBytes: null,
    dataBytes: null,
    jsUsedBytes: null,
    jsLimitBytes: null,
  },
};

// --- Main thread → worker ------------------------------------------------

/** Boot the kernel: install Pyodide + the runtime with the locale-derived
 *  values the DOM-less worker cannot compute itself. */
export interface InitRequest {
  type: "init";
  lang: string;
  labels: { group: string; untitled: string };
}

/** Invoke ``runtime[method](...args)`` in the worker. */
export interface CallRequest {
  type: "call";
  id: number;
  method: string;
  args: unknown[];
}

/** Resolve a pending {@link DialogRequestEvent} with the user's answer. */
export interface DialogResponseRequest {
  type: "dialog-response";
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export type KernelRequest = InitRequest | CallRequest | DialogResponseRequest;

// --- Worker → main thread ------------------------------------------------

/** Boot-progress message, mapped to the ``onProgress`` callback. */
export interface ProgressEvent {
  type: "progress";
  message: string;
}

/** The kernel finished booting and is ready to serve calls. */
export interface ReadyEvent {
  type: "ready";
  mirror: KernelMirror;
}

/** Boot failed; the ``ready`` promise rejects with this message. */
export interface BootErrorEvent {
  type: "boot-error";
  error: string;
}

/** Reply to a {@link CallRequest}. */
export type ResultEvent =
  | { type: "result"; id: number; ok: true; value: unknown }
  | { type: "result"; id: number; ok: false; error: string };

/** A durable-workspace mutation fired by the runtime (drives the dirty
 *  flag). Mirrors ``DataLabRuntime.onWorkspaceMutation``. */
export interface MutationEvent {
  type: "mutation";
  name: string;
}

/** Python requested a dialog; the main thread renders it and answers with a
 *  {@link DialogResponseRequest}. */
export interface DialogRequestEvent {
  type: "dialog-request";
  id: number;
  kind: string;
  payload: unknown;
}

/** Fresh snapshot for the synchronous-accessor cache. */
export interface MirrorEvent {
  type: "mirror";
  mirror: KernelMirror;
}

export type KernelEvent =
  | ProgressEvent
  | ReadyEvent
  | BootErrorEvent
  | ResultEvent
  | MutationEvent
  | DialogRequestEvent
  | MirrorEvent;

/**
 * Method names on {@link RuntimeApi} that need special handling in the
 * proxy instead of a plain request/reply round-trip.
 */

/** Synchronous accessors served from the mirror cache (no round-trip). */
export const SYNC_MIRROR_METHODS = [
  "getStorageMode",
  "getDiskStoreBytes",
  "getSpilledCount",
  "getMemoryUsage",
] as const;

/** Methods that register a JS callback and therefore cannot be forwarded
 *  by value — the proxy handles them locally and bridges the events. */
export const CALLBACK_METHODS = [
  "setDialogHandler",
  "onWorkspaceMutation",
] as const;

/**
 * Walk an arbitrary value and collect every distinct ``ArrayBuffer``
 * reachable through ``TypedArray.buffer`` (or a bare ``ArrayBuffer``).
 *
 * Used to populate the ``transfer`` list of ``postMessage`` so binary
 * payloads cross the worker boundary **zero-copy** (transferred, not
 * structured-cloned) — the latency lever the definitive on-disk benchmark
 * identified, since cloning an 8–32 MiB image array dominates the call.
 *
 * Buffers are de-duplicated (``postMessage`` throws on a duplicate
 * transferable) and ``SharedArrayBuffer`` is never collected (it is not
 * transferable, and not used here). Depth is capped to avoid cycles.
 *
 * NOTE: transferring detaches the buffer on the sender side. Callers that
 * pass binary inputs to the runtime (image/signal arrays, file bytes) are
 * expected to relinquish them — they are conceptually *moved* into the
 * model, not kept.
 */
export function collectTransferables(value: unknown): ArrayBuffer[] {
  const seen = new Set<ArrayBuffer>();
  const walk = (v: unknown, depth: number): void => {
    if (depth > 8 || v == null || typeof v !== "object") return;
    if (v instanceof ArrayBuffer) {
      seen.add(v);
      return;
    }
    if (ArrayBuffer.isView(v)) {
      const buf = (v as ArrayBufferView).buffer;
      if (buf instanceof ArrayBuffer) seen.add(buf);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    for (const inner of Object.values(v as Record<string, unknown>)) {
      walk(inner, depth + 1);
    }
  };
  walk(value, 0);
  return Array.from(seen);
}
