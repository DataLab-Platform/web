/**
 * Wire protocol between the main thread and the disposable **compute
 * worker** (``computeWorker.ts``).
 *
 * To make a long-running processing *interruptible* without a
 * ``SharedArrayBuffer`` — which would force COOP/COEP cross-origin
 * isolation and break plain static hosting (GitHub Pages) — the heavy
 * Sigima call is delegated to a separate, disposable Pyodide worker.
 * Cancelling means ``Worker.terminate()`` on that worker: the kernel
 * worker that owns the object model is never touched, so the workspace
 * survives and only the in-flight result is discarded. This mirrors the
 * desktop application's "separate process" option.
 *
 * The compute worker is **pure**: it receives *serialised* inputs
 * (base-64-pickled source/operand objects) and returns *serialised*
 * outputs. It never holds workspace state — the kernel resolves the
 * sources from its model, ships them here, and reinserts the results.
 *
 * Payloads are plain JSON-friendly values (strings, numbers, arrays), so
 * they cross ``postMessage`` by structured clone with no special handling.
 */

/**
 * One serialised result entry: ``[source_oid_or_null, pickled_b64]``.
 *
 * Mirrors a single item of the Python ``ApplyResult`` — the source oid is
 * passed back unchanged so the kernel can map the result to its source
 * group / title; ``null`` for ``n_to_1`` (no single source).
 */
export type SerializedResultItem = [string | null, string];

// --- Main thread → compute worker ---------------------------------------

/** Boot the worker with the locale-derived ``LANG`` (the DOM-less worker
 *  cannot read ``localStorage`` itself). */
export interface ComputeInitRequest {
  type: "init";
  lang: string;
}

/** Run a feature on serialised inputs. One in-flight ``run`` at a time:
 *  the kernel awaits each result, and cancellation terminates the worker. */
export interface ComputeRunRequest {
  type: "run";
  id: number;
  featureId: string;
  sourceIds: string[];
  sourcesB64: string[];
  params: Record<string, unknown> | null;
  operandB64: string | null;
}

export type ComputeRequest = ComputeInitRequest | ComputeRunRequest;

// --- Compute worker → main thread ---------------------------------------

/** Boot-progress message, surfaced through the client's ``onProgress``. */
export interface ComputeProgressEvent {
  type: "progress";
  message: string;
}

/** The worker booted Pyodide + Sigima and built its feature catalogue. */
export interface ComputeReadyEvent {
  type: "ready";
}

/** Boot failed; the ``init`` promise rejects with this message. */
export interface ComputeBootErrorEvent {
  type: "boot-error";
  error: string;
}

/** Reply to a {@link ComputeRunRequest}. */
export type ComputeResultEvent =
  | { type: "result"; id: number; ok: true; items: SerializedResultItem[] }
  | { type: "result"; id: number; ok: false; error: string };

export type ComputeEvent =
  | ComputeProgressEvent
  | ComputeReadyEvent
  | ComputeBootErrorEvent
  | ComputeResultEvent;
