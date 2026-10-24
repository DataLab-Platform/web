/**
 * Synchronous OPFS byte store for the on-disk runtime mode — worker only.
 *
 * This is the fast counterpart of {@link OpfsObjectStore}. Where the async
 * store writes through ``createWritable`` (an out-of-place, whole-file
 * rewrite that is the only option on the main thread), this store uses
 * ``FileSystemFileHandle.createSyncAccessHandle`` — a **synchronous,
 * in-place** read/write handle that the spec restricts to Dedicated Web
 * Workers. The ``opfs_sync_spike`` benchmark measured it 4–7× faster for
 * the 8–32 MiB image payloads DataLab-Web spills (DEW ADR #2).
 *
 * It is therefore only selectable when the runtime itself runs inside a
 * worker ({@link kernelWorker}); on the main thread the runtime falls back
 * to {@link OpfsObjectStore}. Both implement {@link ObjectByteStore}, so the
 * spill/page-in machinery in ``runtime.ts`` is backend-agnostic.
 *
 * Layout is identical to the async store (a *directory of objects*: one
 * file per object id in the directory of the store's session, see
 * :mod:`opfsSession`), so the two are interchangeable.
 */
import { fileName, type ObjectByteStore } from "./opfsObjectStore";
import {
  openSessionDirectory,
  resetSessionDirectory,
  type SessionDirectory,
} from "./opfsSession";

/** Minimal shape of the synchronous access handle (Worker-only API). The
 *  read/write buffers are narrowed to ``Uint8Array`` (all we pass) to avoid
 *  the ``ArrayBufferLike`` vs ``ArrayBuffer`` clash the DOM ``BufferSource``
 *  type triggers under TS 5.7+ generic typed arrays. */
interface SyncAccessHandle {
  read(buffer: Uint8Array, options?: { at?: number }): number;
  write(buffer: Uint8Array, options?: { at?: number }): number;
  truncate(newSize: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

type SyncCapableFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle(): Promise<SyncAccessHandle>;
};

/**
 * A directory-of-objects byte store using synchronous OPFS access handles.
 *
 * Worker-only. Call {@link init} once before use (idempotent).
 */
export class OpfsSyncObjectStore implements ObjectByteStore {
  private session: SessionDirectory | null = null;
  private dir: FileSystemDirectoryHandle | null = null;
  private readonly sizes = new Map<string, number>();
  private initialised = false;

  /**
   * Whether this context can host the synchronous store: it requires a
   * secure context, the Storage Manager ``getDirectory`` API **and** the
   * worker-only ``createSyncAccessHandle`` method. On the main thread the
   * method is absent (or throws), so this returns ``false`` and the runtime
   * uses {@link OpfsObjectStore} instead.
   */
  static isSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.storage?.getDirectory === "function" &&
      typeof globalThis.isSecureContext === "boolean" &&
      globalThis.isSecureContext &&
      typeof FileSystemFileHandle !== "undefined" &&
      typeof (FileSystemFileHandle.prototype as Partial<SyncCapableFileHandle>)
        .createSyncAccessHandle === "function"
    );
  }

  async init(): Promise<void> {
    if (this.initialised) return;
    if (!OpfsSyncObjectStore.isSupported()) {
      throw new Error("synchronous OPFS access handles are unavailable here");
    }
    this.session = await openSessionDirectory(
      await navigator.storage.getDirectory(),
    );
    this.dir = this.session.dir;
    this.initialised = true;
  }

  private requireDir(): FileSystemDirectoryHandle {
    if (!this.dir) {
      throw new Error("OpfsSyncObjectStore.init() must be called first");
    }
    return this.dir;
  }

  private async handle(oid: string): Promise<SyncAccessHandle> {
    const dir = this.requireDir();
    const fh = (await dir.getFileHandle(fileName(oid), {
      create: true,
    })) as SyncCapableFileHandle;
    return fh.createSyncAccessHandle();
  }

  /**
   * Persist *bytes* for *oid*, overwriting any previous payload in place.
   *
   * A write may transfer fewer bytes than requested: the remaining bytes are
   * written in turn, and a write that transfers nothing throws, so that the
   * caller never takes an incomplete copy for a stored payload.
   */
  async put(oid: string, bytes: Uint8Array): Promise<void> {
    const h = await this.handle(oid);
    try {
      // In-place write, then shrink the file to the exact payload length so
      // a smaller re-spill never leaves stale trailing bytes.
      let written = 0;
      while (written < bytes.byteLength) {
        const count = h.write(bytes.subarray(written), { at: written });
        if (!(count > 0)) {
          throw new Error(
            `Incomplete OPFS write for ${oid}: ${written} of ${bytes.byteLength} bytes`,
          );
        }
        written += count;
      }
      h.truncate(bytes.byteLength);
      h.flush();
    } finally {
      h.close();
    }
    this.sizes.set(oid, bytes.byteLength);
  }

  /**
   * Read back the payload for *oid*. Throws if it is absent, or if fewer
   * bytes than the file size can be read (a read may transfer fewer bytes
   * than requested: the remaining bytes are read in turn).
   */
  async get(oid: string): Promise<Uint8Array> {
    const h = await this.handle(oid);
    try {
      const size = h.getSize();
      const out = new Uint8Array(size);
      let read = 0;
      while (read < size) {
        const count = h.read(out.subarray(read), { at: read });
        if (!(count > 0)) {
          throw new Error(
            `Incomplete OPFS read for ${oid}: ${read} of ${size} bytes`,
          );
        }
        read += count;
      }
      return out;
    } finally {
      h.close();
    }
  }

  /** Whether a payload is currently stored for *oid*. */
  async has(oid: string): Promise<boolean> {
    const dir = this.requireDir();
    try {
      await dir.getFileHandle(fileName(oid));
      return true;
    } catch {
      return false;
    }
  }

  /** Delete *oid*'s payload (silent no-op when absent). */
  async delete(oid: string): Promise<void> {
    const dir = this.requireDir();
    try {
      await dir.removeEntry(fileName(oid));
    } catch {
      // Already gone — nothing to do.
    }
    this.sizes.delete(oid);
  }

  /** Remove every payload of this store (and only those). */
  async clear(): Promise<void> {
    if (!this.session) return;
    this.sizes.clear();
    this.dir = await resetSessionDirectory(this.session);
  }

  /** Total on-disk byte size of all payloads written through this instance. */
  totalBytes(): number {
    let total = 0;
    for (const n of this.sizes.values()) total += n;
    return total;
  }

  /** Number of objects currently tracked as stored. */
  count(): number {
    return this.sizes.size;
  }
}
