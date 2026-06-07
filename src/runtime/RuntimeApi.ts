/**
 * Structural contract of the DataLab-Web runtime.
 *
 * ``RuntimeApi`` is the typed surface every UI consumer (React contexts,
 * components, the action registry, macro/notebook hosts, the AI assistant,
 * the remote/proxy bridges) should depend on — *instead of* the concrete
 * {@link DataLabRuntime} class. Decoupling consumers from the concrete
 * class is what lets us later swap in a worker-backed implementation
 * (``WorkerRuntimeProxy``) that hosts Pyodide in a Dedicated Web Worker and
 * spills arrays to OPFS via synchronous access handles, **without touching
 * a single call site** (DEW ADR #2 — "data on disk" performance step).
 *
 * Why a mapped type (and not a hand-written interface)?
 *   * The runtime exposes ~150 public methods; a hand-copied interface
 *     would inevitably drift from the implementation.
 *   * ``keyof DataLabRuntime`` yields only the **public** members
 *     (``private``/``protected`` fields and the private constructor are
 *     excluded), so this captures exactly the public surface and stays in
 *     lock-step with the class automatically.
 *   * Mapping over the class instance type strips its *nominal* brand, so
 *     the result is a purely **structural** contract: a different class
 *     (the future ``WorkerRuntimeProxy``) can satisfy it, and any new
 *     method added to {@link DataLabRuntime} immediately becomes a
 *     compile error in that proxy until it is forwarded — keeping the two
 *     implementations in sync by construction.
 *
 * Note on synchronous members: a few accessors are intentionally
 * synchronous (``getStorageMode``, ``getDiskStoreBytes``,
 * ``getSpilledCount``, ``getMemoryUsage``). A worker-backed proxy will
 * satisfy these from a locally-cached mirror that the worker pushes on
 * change, so the synchronous shape is preserved across the boundary.
 *
 * Static members (``DataLabRuntime.load``,
 * ``DataLabRuntime.isDiskStorageSupported``) are deliberately **not** part
 * of this contract — they are not instance members and remain on the
 * concrete class / a capability helper.
 */
import type { DataLabRuntime } from "./runtime";

export type RuntimeApi = {
  [K in keyof DataLabRuntime]: DataLabRuntime[K];
};
