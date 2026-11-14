/**
 * Coordinates workspace replacement with calls already accepted from
 * macro/notebook workers and remote-control clients.
 */

export class WorkspaceBridgeGate {
  private pauses = 0;
  private readonly pending = new Set<Promise<unknown>>();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pauses > 0) {
      throw new Error("The workspace is being reset.");
    }
    const task = Promise.resolve().then(operation);
    this.pending.add(task);
    try {
      return await task;
    } finally {
      this.pending.delete(task);
    }
  }

  /** Prevent new calls and wait for accepted calls to finish. */
  async pause(): Promise<void> {
    this.pauses += 1;
    await Promise.allSettled([...this.pending]);
  }

  resume(): void {
    if (this.pauses === 0) {
      throw new Error("Workspace bridge is not paused.");
    }
    this.pauses -= 1;
  }
}

const gates = new WeakMap<object, WorkspaceBridgeGate>();

export function workspaceBridgeGate(runtime: object): WorkspaceBridgeGate {
  let gate = gates.get(runtime);
  if (!gate) {
    gate = new WorkspaceBridgeGate();
    gates.set(runtime, gate);
  }
  return gate;
}
