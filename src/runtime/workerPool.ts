/**
 * Python workers shared by successive mounts of the Macros and Notebooks
 * panels.
 *
 * The panels are mounted afresh whenever the contents of the workspace
 * change wholesale (workspace opened, HDF5 file imported): they then re-read
 * its macros and notebooks. Their workers outlive a mount: a new mount
 * reuses the worker of the same *generation*, and asks for a new generation
 * when the workspace is replaced (opening a workspace starts with fresh
 * Python namespaces). The worker of the previous generation is then
 * disposed — or kept when no user code ran in it, its namespace being still
 * fresh —, so that remounts never leave workers running in the background.
 */

export interface Disposable {
  dispose(): void;
  /** True while no user code ran (e.g. no notebook cell executed since the
   *  kernel started): its Python namespace is still fresh. */
  isPristine?(): boolean;
}

/** One instance per key (the workspace runtime) and generation. */
export class GenerationPool<K extends object, T extends Disposable> {
  private readonly entries = new WeakMap<K, { generation: number; item: T }>();

  constructor(private readonly create: (key: K) => T) {}

  peek(key: K): T | undefined {
    return this.entries.get(key)?.item;
  }

  /** Discard even a pristine instance when starting a new workspace. */
  dispose(key: K): void {
    const entry = this.entries.get(key);
    this.entries.delete(key);
    entry?.item.dispose();
  }

  /** The instance of ``generation`` for ``key``: created on first request;
   *  requesting another generation disposes the previous instance — unless
   *  no user code ran in it yet: it is then as fresh as a new one, and kept
   *  (no pointless restart, e.g. when examples are opened in a row). */
  acquire(key: K, generation: number): T {
    const entry = this.entries.get(key);
    if (entry?.generation === generation) return entry.item;
    if (entry?.item.isPristine?.()) {
      entry.generation = generation;
      return entry.item;
    }
    entry?.item.dispose();
    const item = this.create(key);
    this.entries.set(key, { generation, item });
    return item;
  }
}
