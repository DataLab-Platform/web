/**
 * Minimal stand-in for ``Worker`` in jsdom: records the messages posted to
 * the worker and lets the test answer as the worker would (``emit``).
 */
export class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  readonly posted: unknown[] = [];

  constructor(
    readonly url: URL | string,
    readonly options?: WorkerOptions,
  ) {
    super();
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Message from the worker (ignored once terminated, like a real one). */
  emit(data: unknown): void {
    if (this.terminated) return;
    const event = new MessageEvent("message", { data });
    this.onmessage?.(event);
    this.dispatchEvent(event);
  }

  /** Workers not terminated yet. */
  static alive(): FakeWorker[] {
    return FakeWorker.instances.filter((worker) => !worker.terminated);
  }

  static reset(): void {
    FakeWorker.instances = [];
  }
}
