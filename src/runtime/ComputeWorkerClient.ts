/**
 * Main-thread client for the disposable {@link computeWorker}.
 *
 * {@link ComputeWorkerClient} owns one compute-worker instance and drives it
 * over the {@link computeProtocol} envelopes. Its reason to exist is
 * **cancellation without a ``SharedArrayBuffer``**: {@link cancel} calls
 * ``Worker.terminate()``, which kills the in-flight Sigima call instantly —
 * even a single long C call that no cooperative flag could interrupt — and
 * rejects the pending {@link run} with a {@link ProcessingCancelledError}.
 * After a cancel (or any terminate) the client is spent; the orchestrator
 * lazily creates a fresh one for the next processing.
 *
 * The client depends only on a narrow {@link ComputeWorkerLike} transport so
 * unit tests can inject a fake worker and validate the protocol — including
 * the terminate-on-cancel path — without booting Pyodide.
 */
import type {
  ComputeEvent,
  ComputeRequest,
  SerializedResultItem,
} from "./computeProtocol";

/** Thrown into the pending {@link ComputeWorkerClient.run} promise when a
 *  processing is cancelled (the worker was terminated). */
export class ProcessingCancelledError extends Error {
  constructor(message = "Processing cancelled") {
    super(message);
    this.name = "ProcessingCancelledError";
  }
}

/** The slice of the ``Worker`` API the client needs — narrowed so unit
 *  tests can inject a fake transport without a real ``Worker``. */
export interface ComputeWorkerLike {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (ev: { data: unknown }) => void,
  ): void;
  addEventListener(
    type: "error",
    listener: (ev: { message?: string; filename?: string }) => void,
  ): void;
  terminate(): void;
}

/** Inputs for a single feature run (kernel-resolved, serialised). */
export interface ComputeRunInput {
  featureId: string;
  sourceIds: string[];
  sourcesB64: string[];
  params?: Record<string, unknown> | null;
  operandB64?: string | null;
}

interface PendingRun {
  resolve: (items: SerializedResultItem[]) => void;
  reject: (error: unknown) => void;
}

/**
 * Connection manager for one compute worker. Holds the boot handshake and
 * the pending-run table, and exposes {@link run} / {@link cancel}.
 */
export class ComputeWorkerClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRun>();
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: unknown) => void;
  private settledReady = false;
  private terminated = false;

  constructor(
    private readonly worker: ComputeWorkerLike,
    private readonly onProgress?: (message: string) => void,
  ) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker.addEventListener("message", (ev) =>
      this.handleEvent(ev.data as ComputeEvent),
    );
    this.worker.addEventListener("error", (ev) => {
      const detail = ev.message
        ? `${ev.message}${ev.filename ? ` (${ev.filename})` : ""}`
        : "compute worker failed to start";
      this.failReady(new Error(detail));
    });
  }

  /** Send the boot request. Resolves once the worker reports ``ready``. */
  init(lang: string): Promise<void> {
    this.post({ type: "init", lang });
    return this.readyPromise;
  }

  /** Run a feature on serialised inputs. Rejects with
   *  {@link ProcessingCancelledError} if {@link cancel} terminates the
   *  worker before the result arrives. */
  run(input: ComputeRunInput): Promise<SerializedResultItem[]> {
    if (this.terminated) {
      return Promise.reject(
        new ProcessingCancelledError("Compute worker already terminated"),
      );
    }
    const id = this.nextId++;
    return new Promise<SerializedResultItem[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({
        type: "run",
        id,
        featureId: input.featureId,
        sourceIds: input.sourceIds,
        sourcesB64: input.sourcesB64,
        params: input.params ?? null,
        operandB64: input.operandB64 ?? null,
      });
    });
  }

  /** True once the worker has been terminated (cancelled or disposed). */
  get isTerminated(): boolean {
    return this.terminated;
  }

  /**
   * Cancel the in-flight processing by terminating the worker. Every
   * pending {@link run} rejects with {@link ProcessingCancelledError}. The
   * client is spent afterwards — create a new one for the next run.
   */
  cancel(): void {
    this.teardown(new ProcessingCancelledError());
  }

  /** Tear down without the cancel semantics (e.g. app shutdown). */
  dispose(): void {
    this.teardown(new ProcessingCancelledError("Compute worker disposed"));
  }

  // --- Internals ---------------------------------------------------------

  private teardown(reason: Error): void {
    if (this.terminated) return;
    this.terminated = true;
    this.failReady(reason);
    for (const { reject } of this.pending.values()) reject(reason);
    this.pending.clear();
    this.worker.terminate();
  }

  private failReady(err: unknown): void {
    if (this.settledReady) return;
    this.settledReady = true;
    this.rejectReady(err);
  }

  private handleEvent(event: ComputeEvent): void {
    switch (event.type) {
      case "progress":
        this.onProgress?.(event.message);
        break;
      case "ready":
        if (!this.settledReady) {
          this.settledReady = true;
          this.resolveReady();
        }
        break;
      case "boot-error":
        this.failReady(new Error(event.error));
        break;
      case "result": {
        const pending = this.pending.get(event.id);
        if (!pending) break;
        this.pending.delete(event.id);
        if (event.ok) pending.resolve(event.items);
        else pending.reject(new Error(event.error));
        break;
      }
    }
  }

  private post(message: ComputeRequest): void {
    this.worker.postMessage(message);
  }
}

/** Spawn a real compute worker and return a booted {@link ComputeWorkerClient}.
 *
 * @param lang POSIX ``LANG`` value matching the UI locale (e.g. ``"fr"``).
 * @param onProgress Optional boot-progress sink.
 */
export async function createComputeWorker(
  lang: string,
  onProgress?: (message: string) => void,
): Promise<ComputeWorkerClient> {
  const worker = new Worker(new URL("./computeWorker.ts", import.meta.url), {
    type: "module",
  });
  const client = new ComputeWorkerClient(worker, onProgress);
  await client.init(lang);
  return client;
}
