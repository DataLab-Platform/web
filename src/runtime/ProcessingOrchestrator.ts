/**
 * Main-thread orchestrator for **interruptible processing**.
 *
 * Ties together the three halves of the cancellable path:
 *
 *   1. {@link RuntimeApi.extractFeatureInputs} (kernel) — pickle the source
 *      objects without running anything.
 *   2. {@link ComputeWorkerClient.run} (disposable worker) — run the heavy
 *      Sigima call off-thread; cancellable by terminating the worker.
 *   3. {@link RuntimeApi.commitFeatureResults} (kernel) — insert the results
 *      into the model.
 *
 * {@link cancel} terminates the in-flight compute worker: the kernel model is
 * never touched (the extract step does not mutate it and commit never runs),
 * so the workspace stays intact and the cancelled result is simply discarded.
 * This is the browser analogue of the desktop "separate process" option, and
 * needs no ``SharedArrayBuffer`` — plain static hosting keeps working.
 *
 * One compute worker is kept alive and reused across runs to amortise its
 * Pyodide boot, then terminated after an idle delay to reclaim its ~150–300 MB
 * heap. A cancel terminates it immediately; the next run lazily spawns a fresh
 * one. The orchestrator depends only on injectable collaborators (the runtime
 * surface and a client factory) so it is unit-testable without Pyodide.
 */
import {
  ComputeWorkerClient,
  createComputeWorker,
} from "./ComputeWorkerClient";
import type { SerializedResultItem } from "./computeProtocol";
import type { RuntimeApi } from "./RuntimeApi";

/** The runtime methods the orchestrator needs (kernel extract / commit). */
export type ProcessingRuntime = Pick<
  RuntimeApi,
  "extractFeatureInputs" | "commitFeatureResults"
>;

/** A single feature run resolved by the action layer. */
export interface ProcessingRunInput {
  featureId: string;
  sourceIds: string[];
  operandId?: string | null;
  params?: Record<string, unknown> | null;
}

/** Factory producing a booted {@link ComputeWorkerClient}. Injectable so unit
 *  tests can supply a fake without spawning a real worker. */
export type ComputeWorkerFactory = (
  lang: string,
  onProgress?: (message: string) => void,
) => Promise<ComputeWorkerClient>;

/** Re-exported so callers can detect a user cancellation. */
export { ProcessingCancelledError } from "./ComputeWorkerClient";

const DEFAULT_IDLE_MS = 60_000;

export class ProcessingOrchestrator {
  private client: ComputeWorkerClient | null = null;
  private clientPromise: Promise<ComputeWorkerClient> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly runtime: ProcessingRuntime,
    private readonly lang: string,
    private readonly factory: ComputeWorkerFactory = createComputeWorker,
    private readonly idleMs: number = DEFAULT_IDLE_MS,
  ) {}

  /**
   * Run *input*'s feature with cancellation support: extract (kernel) →
   * compute (worker) → commit (kernel). Returns the new object ids.
   *
   * Rejects with {@link ProcessingCancelledError} if {@link cancel} runs
   * before the compute result arrives — in which case the model is untouched.
   */
  async runFeature(input: ProcessingRunInput): Promise<string[]> {
    const { featureId, sourceIds } = input;
    const operandId = input.operandId ?? null;
    const params = input.params ?? null;

    // 1. Kernel resolves + pickles the sources (read-only; no mutation).
    const { sources_b64, operand_b64 } =
      await this.runtime.extractFeatureInputs(featureId, sourceIds, operandId);

    // 2. The disposable worker runs the heavy call (cancellable).
    const client = await this.ensureClient();
    const items = await client.run({
      featureId,
      sourceIds,
      sourcesB64: sources_b64,
      params,
      operandB64: operand_b64,
    });

    // 3. Kernel commits the results into the model.
    this.touchIdle();
    return this.runtime.commitFeatureResults(
      featureId,
      sourceIds,
      items as SerializedResultItem[],
      operandId,
      params,
    );
  }

  /**
   * Cancel the in-flight processing by terminating the compute worker. The
   * pending {@link runFeature} rejects with {@link ProcessingCancelledError};
   * the next run lazily spawns a fresh worker.
   */
  cancel(): void {
    this.clearIdle();
    this.client?.cancel();
    this.client = null;
    this.clientPromise = null;
  }

  /** Tear down the orchestrator (app shutdown). */
  dispose(): void {
    this.clearIdle();
    this.client?.dispose();
    this.client = null;
    this.clientPromise = null;
  }

  // --- Internals ---------------------------------------------------------

  private async ensureClient(): Promise<ComputeWorkerClient> {
    this.clearIdle();
    if (this.client && !this.client.isTerminated) return this.client;
    if (!this.clientPromise) {
      this.clientPromise = this.factory(this.lang).then((c) => {
        this.client = c;
        return c;
      });
    }
    return this.clientPromise;
  }

  private touchIdle(): void {
    this.clearIdle();
    if (this.idleMs <= 0) return;
    this.idleTimer = setTimeout(() => {
      this.client?.dispose();
      this.client = null;
      this.clientPromise = null;
      this.idleTimer = null;
    }, this.idleMs);
  }

  private clearIdle(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
