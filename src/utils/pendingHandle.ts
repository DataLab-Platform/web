/**
 * Imperative handle of a component that becomes available later.
 *
 * A lazy-loaded panel exposes its handle only once its chunk is loaded and
 * it is mounted (or, in the Macros panel, once its macros are restored),
 * whereas other panels can call it as soon as they are shown. Pass `ref`
 * as the component's `ref` and call `wait()` instead of reading the handle:
 * calls made too early then wait for the handle instead of failing.
 */
export class PendingHandle<T> {
  private handle: T | null = null;
  private readonly waiters = new Set<(handle: T) => void>();

  /**
   * @param name Name of the component, used in the timeout error.
   */
  constructor(private readonly name: string) {}

  /** Callback ref receiving the handle, `null` while it is unavailable. */
  readonly ref = (handle: T | null): void => {
    this.handle = handle;
    if (handle === null) return;
    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const resolve of waiters) resolve(handle);
  };

  /**
   * Wait for the handle.
   *
   * @param timeoutMs Maximum waiting time, in milliseconds.
   * @returns The handle, at once when it is available.
   * @throws Error when the handle is still unavailable after `timeoutMs`.
   */
  wait(timeoutMs: number): Promise<T> {
    if (this.handle !== null) return Promise.resolve(this.handle);
    return new Promise<T>((resolve, reject) => {
      const waiter = (handle: T): void => {
        clearTimeout(timer);
        resolve(handle);
      };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(
          new Error(
            `${this.name} is not available after ${timeoutMs / 1000} s`,
          ),
        );
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }
}
