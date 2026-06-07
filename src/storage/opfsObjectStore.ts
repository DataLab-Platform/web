/**
 * OPFS-backed per-object byte store for the "data on disk" runtime mode.
 *
 * When the user enables the on-disk storage mode, the heavy NumPy payload
 * of every signal/image is spilled out of the Pyodide WASM heap and
 * persisted here, in the **Origin Private File System** (OPFS) — a
 * browser-managed, origin-scoped, sandboxed filesystem. The object model
 * keeps only metadata (and a thumbnail) resident; the bytes live on disk
 * and are paged back in on demand.
 *
 * Why OPFS (and not IndexedDB or the File System Access picker)?
 *   * OPFS is the only web storage that offers **synchronous** access
 *     (``createSyncAccessHandle``, Worker-only) — required by the
 *     production design for in-place incremental writes. This store uses
 *     the **asynchronous** ``createWritable`` path so it also works on the
 *     main thread today; the synchronous fast path is a drop-in upgrade
 *     once the runtime moves into a Dedicated Worker.
 *   * One file per object (a *directory of objects* layout) gives cheap,
 *     bounded writes/deletes and per-file locking — unlike a single
 *     workspace file that would serialise every access behind one lock.
 *
 * The store is deliberately dependency-free and UI-agnostic: it deals in
 * opaque ``Uint8Array`` payloads keyed by object id. The runtime decides
 * *what* those bytes are (``.npy`` encodings produced by
 * ``bootstrap.detach_object_array``).
 */

/** Directory name under the OPFS root holding the spilled object files. */
export const STORE_DIR = "dlw-object-store";

/** Per-object filename for object id *oid*. */
export function fileName(oid: string): string {
  // Object ids are short opaque tokens (``_new_id``); keep them as-is but
  // guard against any path separator sneaking in.
  return `${oid.replace(/[^A-Za-z0-9_-]/g, "_")}.npy`;
}

/**
 * Storage-backend contract for the on-disk (OPFS) spill mechanism.
 *
 * The runtime spills/pages object byte payloads through this interface
 * without caring whether the bytes hit disk via the asynchronous
 * ``createWritable`` path ({@link OpfsObjectStore}, usable on the main
 * thread) or the synchronous ``createSyncAccessHandle`` path
 * (``OpfsSyncObjectStore``, worker-only — markedly faster, see the
 * ``opfs_sync_spike`` benchmark). All methods are async so both backends
 * share one shape; the sync backend simply performs the I/O in place.
 */
export interface ObjectByteStore {
  init(): Promise<void>;
  put(oid: string, bytes: Uint8Array): Promise<void>;
  get(oid: string): Promise<Uint8Array>;
  has(oid: string): Promise<boolean>;
  delete(oid: string): Promise<void>;
  clear(): Promise<void>;
  totalBytes(): number;
  count(): number;
}

/**
 * A directory-of-objects byte store on top of OPFS.
 *
 * All methods are asynchronous. Instances are cheap; call {@link init}
 * once before use (idempotent). Not safe for concurrent use across
 * threads on the same directory (one owner per OPFS subtree).
 */
export class OpfsObjectStore implements ObjectByteStore {
  private root: FileSystemDirectoryHandle | null = null;
  private dir: FileSystemDirectoryHandle | null = null;
  /** Tracks the on-disk byte size of each stored object (for totals). */
  private readonly sizes = new Map<string, number>();
  private initialised = false;

  /** Whether this browser/context can host the store. OPFS requires a
   *  secure context and the Storage Manager ``getDirectory`` API. */
  static isSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.storage?.getDirectory === "function" &&
      typeof globalThis.isSecureContext === "boolean" &&
      globalThis.isSecureContext
    );
  }

  /** Open (creating if needed) the dedicated store directory. Idempotent. */
  async init(): Promise<void> {
    if (this.initialised) return;
    if (!OpfsObjectStore.isSupported()) {
      throw new Error("OPFS is not available in this browser/context");
    }
    this.root = await navigator.storage.getDirectory();
    this.dir = await this.root.getDirectoryHandle(STORE_DIR, { create: true });
    this.initialised = true;
  }

  private requireDir(): FileSystemDirectoryHandle {
    if (!this.dir) {
      throw new Error("OpfsObjectStore.init() must be called first");
    }
    return this.dir;
  }

  /** Persist *bytes* for object *oid*, overwriting any previous payload. */
  async put(oid: string, bytes: Uint8Array): Promise<void> {
    const dir = this.requireDir();
    const handle = await dir.getFileHandle(fileName(oid), { create: true });
    const writable = await handle.createWritable();
    try {
      // ``write`` accepts a BufferSource; pass the exact byte view. The
      // ``as ArrayBuffer`` narrows ``ArrayBufferLike`` (which, under the
      // TS 5.7+ generic typed-array lib, also admits ``SharedArrayBuffer``)
      // to the ``ArrayBuffer`` the DOM ``FileSystemWriteChunkType`` wants.
      // These payloads never come from a shared buffer, so it is sound.
      await writable.write(
        (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
          ? bytes.buffer
          : bytes.slice().buffer) as ArrayBuffer,
      );
    } finally {
      await writable.close();
    }
    this.sizes.set(oid, bytes.byteLength);
  }

  /** Read back the payload for object *oid*. Throws if it is absent. */
  async get(oid: string): Promise<Uint8Array> {
    const dir = this.requireDir();
    const handle = await dir.getFileHandle(fileName(oid));
    const file = await handle.getFile();
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf);
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

  /** Remove every stored payload and reset the directory. */
  async clear(): Promise<void> {
    if (!this.root) return;
    try {
      await this.root.removeEntry(STORE_DIR, { recursive: true });
    } catch {
      // Directory may not exist yet.
    }
    this.sizes.clear();
    this.dir = await this.root.getDirectoryHandle(STORE_DIR, { create: true });
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
