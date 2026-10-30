/**
 * Unit tests for {@link OpfsSyncObjectStore} — the synchronous-handle OPFS
 * backend used by the on-disk runtime mode when running inside a worker.
 *
 * A real OPFS / ``createSyncAccessHandle`` is unavailable under jsdom, so we
 * inject a fake OPFS tree (directory + file handles backed by in-memory
 * ``Uint8Array`` buffers) and a fake synchronous access handle. This lets us
 * validate the store's behaviour deterministically: the in-place write +
 * ``truncate`` (no stale trailing bytes on a smaller re-spill), the sized
 * read-back, short transfers (the File System standard lets ``read`` and
 * ``write`` transfer fewer bytes than requested), and the bookkeeping
 * (``totalBytes`` / ``count`` / ``delete``).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OpfsSyncObjectStore } from "../../../src/storage/opfsSyncObjectStore";

/** In-memory file backing a fake sync access handle. */
class FakeFile {
  bytes = new Uint8Array(0);
}

/** Transfer limits applied by every fake handle (reset before each test). */
const transfer = {
  /** Largest number of bytes a single ``read``/``write`` call transfers. */
  maxBytes: Infinity,
  /** Number of ``write`` calls after which writes throw. */
  failWritesAfter: Infinity,
  /** Number of leading bytes of a file that ``read`` can reach. */
  readable: Infinity,
  writeCalls: 0,
  readCalls: 0,
};

/** Fake ``FileSystemSyncAccessHandle`` over a {@link FakeFile}. */
class FakeSyncHandle {
  constructor(private readonly file: FakeFile) {}
  write(buf: ArrayBufferView, { at = 0 }: { at?: number } = {}): number {
    transfer.writeCalls += 1;
    if (transfer.writeCalls > transfer.failWritesAfter) {
      throw new DOMException("write failed", "InvalidStateError");
    }
    const length = Math.min(buf.byteLength, transfer.maxBytes);
    const src = new Uint8Array(buf.buffer, buf.byteOffset, length);
    const end = at + src.byteLength;
    if (end > this.file.bytes.byteLength) {
      const grown = new Uint8Array(end);
      grown.set(this.file.bytes, 0);
      this.file.bytes = grown;
    }
    this.file.bytes.set(src, at);
    return src.byteLength;
  }
  read(buf: ArrayBufferView, { at = 0 }: { at?: number } = {}): number {
    transfer.readCalls += 1;
    const length = Math.min(buf.byteLength, transfer.maxBytes);
    const dst = new Uint8Array(buf.buffer, buf.byteOffset, length);
    const end = Math.min(at + dst.byteLength, transfer.readable);
    const slice = this.file.bytes.subarray(at, Math.max(at, end));
    dst.set(slice);
    return slice.byteLength;
  }
  truncate(size: number): void {
    this.file.bytes = this.file.bytes.subarray(0, size).slice();
  }
  getSize(): number {
    return this.file.bytes.byteLength;
  }
  flush(): void {}
  close(): void {}
}

class FakeFileHandle {
  constructor(private readonly file: FakeFile) {}
  async createSyncAccessHandle(): Promise<FakeSyncHandle> {
    return new FakeSyncHandle(this.file);
  }
}

class FakeDirHandle {
  files = new Map<string, FakeFile>();
  subdirs = new Map<string, FakeDirHandle>();
  async getDirectoryHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FakeDirHandle> {
    let d = this.subdirs.get(name);
    if (!d) {
      if (!opts?.create) throw new Error("NotFound");
      d = new FakeDirHandle();
      this.subdirs.set(name, d);
    }
    return d;
  }
  async getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FakeFileHandle> {
    let f = this.files.get(name);
    if (!f) {
      if (!opts?.create) throw new Error("NotFound");
      f = new FakeFile();
      this.files.set(name, f);
    }
    return new FakeFileHandle(f);
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.subdirs.delete(name)) {
      throw new Error("NotFound");
    }
  }
}

const ORIGINAL = {
  storage: (navigator as { storage?: unknown }).storage,
  secure: globalThis.isSecureContext,
  fileHandle: (globalThis as { FileSystemFileHandle?: unknown })
    .FileSystemFileHandle,
};

let opfsRoot: FakeDirHandle;

beforeEach(() => {
  Object.assign(transfer, {
    maxBytes: Infinity,
    failWritesAfter: Infinity,
    readable: Infinity,
    writeCalls: 0,
    readCalls: 0,
  });
  opfsRoot = new FakeDirHandle();
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: { getDirectory: async () => opfsRoot },
  });
  Object.defineProperty(globalThis, "isSecureContext", {
    configurable: true,
    value: true,
  });
  // Advertise the worker-only capability so ``isSupported`` passes.
  (globalThis as { FileSystemFileHandle?: unknown }).FileSystemFileHandle =
    function FileSystemFileHandle() {} as unknown;
  (
    (globalThis as { FileSystemFileHandle: { prototype: object } })
      .FileSystemFileHandle.prototype as {
      createSyncAccessHandle?: unknown;
    }
  ).createSyncAccessHandle = function () {};
});

afterEach(() => {
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: ORIGINAL.storage,
  });
  Object.defineProperty(globalThis, "isSecureContext", {
    configurable: true,
    value: ORIGINAL.secure,
  });
  (globalThis as { FileSystemFileHandle?: unknown }).FileSystemFileHandle =
    ORIGINAL.fileHandle;
});

describe("OpfsSyncObjectStore", () => {
  it("reports supported when the sync-handle capability is present", () => {
    expect(OpfsSyncObjectStore.isSupported()).toBe(true);
  });

  it("reports unsupported when createSyncAccessHandle is absent", () => {
    delete (
      (globalThis as { FileSystemFileHandle: { prototype: object } })
        .FileSystemFileHandle.prototype as {
        createSyncAccessHandle?: unknown;
      }
    ).createSyncAccessHandle;
    expect(OpfsSyncObjectStore.isSupported()).toBe(false);
  });

  it("round-trips a payload byte-for-byte", async () => {
    const store = new OpfsSyncObjectStore();
    await store.init();
    const payload = new Uint8Array([1, 2, 3, 4, 250, 251, 252]);
    await store.put("obj-1", payload);
    const read = await store.get("obj-1");
    expect(Array.from(read)).toEqual(Array.from(payload));
  });

  it("truncates on a smaller re-spill (no stale trailing bytes)", async () => {
    const store = new OpfsSyncObjectStore();
    await store.init();
    await store.put("obj-1", new Uint8Array([9, 9, 9, 9, 9, 9]));
    await store.put("obj-1", new Uint8Array([1, 2, 3]));
    const read = await store.get("obj-1");
    expect(Array.from(read)).toEqual([1, 2, 3]);
  });

  it("tracks totals and count, and clears on delete", async () => {
    const store = new OpfsSyncObjectStore();
    await store.init();
    await store.put("a", new Uint8Array(10));
    await store.put("b", new Uint8Array(6));
    expect(store.count()).toBe(2);
    expect(store.totalBytes()).toBe(16);
    await store.delete("a");
    expect(store.count()).toBe(1);
    expect(store.totalBytes()).toBe(6);
    expect(await store.has("a")).toBe(false);
    expect(await store.has("b")).toBe(true);
  });

  it("writes and reads a payload transferred in several fragments", async () => {
    const store = new OpfsSyncObjectStore();
    await store.init();
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    transfer.maxBytes = 3;
    await store.put("obj-1", payload);
    expect(transfer.writeCalls).toBe(3);
    expect(store.totalBytes()).toBe(7);
    const read = await store.get("obj-1");
    expect(transfer.readCalls).toBe(3);
    expect(Array.from(read)).toEqual(Array.from(payload));
  });

  it("fails a write that makes no progress", async () => {
    // Regression: a short write was taken for a complete one, so that the
    // object was released from memory while its file held partial data.
    const store = new OpfsSyncObjectStore();
    await store.init();
    transfer.maxBytes = 0;
    await expect(
      store.put("obj-1", new Uint8Array([1, 2, 3, 4])),
    ).rejects.toThrow("Incomplete OPFS write for obj-1: 0 of 4 bytes");
    expect(store.count()).toBe(0);
    expect(store.totalBytes()).toBe(0);
  });

  it("fails a write interrupted after a first fragment", async () => {
    const store = new OpfsSyncObjectStore();
    await store.init();
    transfer.maxBytes = 2;
    transfer.failWritesAfter = 1;
    await expect(
      store.put("obj-1", new Uint8Array([1, 2, 3, 4])),
    ).rejects.toThrow("write failed");
    expect(store.count()).toBe(0);
  });

  it("fails a read that cannot reach the end of the file", async () => {
    // Regression: a short read returned a buffer partly filled with zeros.
    const store = new OpfsSyncObjectStore();
    await store.init();
    await store.put("obj-1", new Uint8Array([1, 2, 3, 4]));
    transfer.readable = 2;
    await expect(store.get("obj-1")).rejects.toThrow(
      "Incomplete OPFS read for obj-1: 2 of 4 bytes",
    );
  });

  it("fails to read an absent payload without creating it", async () => {
    // Regression: reading an absent payload created an empty file and
    // returned no bytes, which were then taken for the object data.
    const store = new OpfsSyncObjectStore();
    await store.init();
    await expect(store.get("missing")).rejects.toThrow();
    expect(await store.has("missing")).toBe(false);
  });

  it("clears every stored payload", async () => {
    const store = new OpfsSyncObjectStore();
    await store.init();
    await store.put("a", new Uint8Array(4));
    await store.put("b", new Uint8Array(4));
    await store.clear();
    expect(store.count()).toBe(0);
    expect(store.totalBytes()).toBe(0);
  });
});
