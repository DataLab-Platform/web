/**
 * Start-up of the Python workers of the Macros and Notebooks panels.
 *
 * A worker boots its own Pyodide instance and posts ``{type: "ready"}``
 * once its Python stack is installed, or ``{type: "init_error"}`` when the
 * installation failed (after its own retries, see ``packageRetry.ts``). A
 * download may also stall for good on a cold cache: the start then times
 * out. The controllers (``MacroRuntime``, ``NotebookRuntime``) terminate a
 * worker that failed to start and retry with a fresh one.
 *
 * Runs on the main thread and in the kernel worker too (the runtime starts
 * the macro worker of the AI Assistant there): no ``window`` here.
 */

/** A worker taking longer to start is considered stuck (a cold start on a
 *  slow network takes one to three minutes). */
export const WORKER_READY_TIMEOUT_MS = 5 * 60_000;
/** Attempts to start a worker (the first one and two retries). */
export const WORKER_START_ATTEMPTS = 3;
/** Delay before the first retry (then twice as long before the second). */
export const WORKER_RETRY_DELAY_MS = 3_000;

/** The worker start was cancelled (worker disposed or replaced). */
export class WorkerStartCancelled extends Error {
  constructor() {
    super("Worker start cancelled");
    this.name = "WorkerStartCancelled";
  }
}

/**
 * Resolve when ``worker`` posts ``{type: "ready"}``; reject when it posts
 * ``{type: "init_error", error}``, raises an error event, does not get
 * ready within ``timeoutMs`` or ``signal`` aborts
 * (:class:`WorkerStartCancelled`). Listeners are added beside the
 * worker's own ``onmessage`` handler, which keeps receiving every message.
 */
export function waitForWorkerReady(
  worker: Worker,
  opts: { timeoutMs?: number; signal?: AbortSignal; label?: string } = {},
): Promise<void> {
  const label = opts.label ?? "worker";
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      opts.signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; error?: unknown } | null;
      if (data?.type === "ready") {
        cleanup();
        resolve();
      } else if (data?.type === "init_error") {
        fail(new Error(`${label} failed to start: ${String(data.error)}`));
      }
    };
    const onError = (event: ErrorEvent) => {
      fail(new Error(`${label} failed to start: ${event.message || "error"}`));
    };
    const onAbort = () => fail(new WorkerStartCancelled());
    const timer = setTimeout(
      () =>
        fail(
          new Error(
            `${label} not ready after ${Math.round(
              (opts.timeoutMs ?? WORKER_READY_TIMEOUT_MS) / 1000,
            )} s`,
          ),
        ),
      opts.timeoutMs ?? WORKER_READY_TIMEOUT_MS,
    );
    if (opts.signal?.aborted) {
      onAbort();
      return;
    }
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    opts.signal?.addEventListener("abort", onAbort);
  });
}

/**
 * Start a worker with ``spawn`` and wait until it is ready; a failed or
 * stalled start is logged, the worker terminated and, after a delay, the
 * start retried with a fresh worker (``WORKER_START_ATTEMPTS`` in all).
 * ``onSpawn`` is told each new worker (the caller keeps the live one).
 * Cancelling ``signal`` terminates the worker being started.
 */
export async function startWorker(opts: {
  spawn: () => Worker;
  onSpawn: (worker: Worker) => void;
  signal: AbortSignal;
  label: string;
  timeoutMs?: number;
  attempts?: number;
  retryDelayMs?: number;
}): Promise<Worker> {
  const attempts = opts.attempts ?? WORKER_START_ATTEMPTS;
  for (let attempt = 1; ; attempt++) {
    if (opts.signal.aborted) throw new WorkerStartCancelled();
    const worker = opts.spawn();
    opts.onSpawn(worker);
    try {
      await waitForWorkerReady(worker, {
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
        label: opts.label,
      });
      return worker;
    } catch (error) {
      worker.terminate();
      if (error instanceof WorkerStartCancelled || attempt >= attempts) {
        if (!(error instanceof WorkerStartCancelled)) {
          console.error(`[${opts.label}] could not start`, error);
        }
        throw error;
      }
      const delay = (opts.retryDelayMs ?? WORKER_RETRY_DELAY_MS) * attempt;
      console.warn(
        `[${opts.label}] start failed (attempt ${attempt}); retrying ` +
          `with a fresh worker in ${delay} ms`,
        error,
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        opts.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new WorkerStartCancelled());
          },
          { once: true },
        );
      });
    }
  }
}
