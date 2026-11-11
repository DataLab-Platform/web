/**
 * Timing primitives of the showcase: abortable sleeps and the operator
 * pause (F9), which freezes every hold of a playing demo.
 */

/** Raised inside a scenario when the showcase is quit (Esc). */
export class ShowcaseAborted extends Error {
  constructor() {
    super("showcase aborted");
    this.name = "ShowcaseAborted";
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ShowcaseAborted();
}

/** ``setTimeout`` as a promise, rejected with :class:`ShowcaseAborted` when
 *  ``signal`` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ShowcaseAborted());
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new ShowcaseAborted());
    };
    const timer = window.setTimeout(
      () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
      Math.max(0, ms),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Operator pause: while paused, holds stop counting time. */
export class PauseController {
  private paused = false;
  private readonly listeners = new Set<(paused: boolean) => void>();

  get isPaused(): boolean {
    return this.paused;
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    for (const listener of this.listeners) listener(paused);
  }

  toggle(): boolean {
    this.setPaused(!this.paused);
    return this.paused;
  }

  /** Be notified of pause changes; returns the unsubscribe function. */
  onChange(listener: (paused: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Wait until ``ms`` milliseconds of *unpaused* time have elapsed
   *  (measured on the clock, so that throttled timers of a background tab
   *  do not stretch the wait). */
  async hold(ms: number, signal?: AbortSignal, slice = 50): Promise<void> {
    let remaining = Math.max(0, ms);
    let last = Date.now();
    for (;;) {
      throwIfAborted(signal);
      const now = Date.now();
      if (!this.paused) remaining -= now - last;
      last = now;
      if (!this.paused && remaining <= 0) return;
      await sleep(this.paused ? slice : Math.min(slice, remaining), signal);
    }
  }

  /** Resolve as soon as the pause is released (immediately if not paused). */
  async waitWhilePaused(signal?: AbortSignal, slice = 50): Promise<void> {
    while (this.paused) await sleep(slice, signal);
    throwIfAborted(signal);
  }
}
