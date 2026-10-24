/**
 * Unit tests for {@link OpfsObjectStore} — the asynchronous OPFS backend used
 * by the on-disk runtime mode on the main thread.
 *
 * A real OPFS is unavailable under jsdom, so we inject a fake OPFS tree whose
 * file handles mimic ``createWritable``: writes go to a swap buffer that
 * ``close`` commits and ``abort`` discards.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OpfsObjectStore } from "../../../src/storage/opfsObjectStore";

class FakeFile {
  bytes = new Uint8Array(0);
}

/** Fake ``FileSystemWritableFileStream`` writing to a swap buffer. */
class FakeWritable {
  private swap: Uint8Array | null = null;
  closed = false;
  aborted = false;
  constructor(
    private readonly file: FakeFile,
    private readonly failWrite: () => boolean,
  ) {}
  async write(data: ArrayBuffer): Promise<void> {
    // A failing write leaves a partial swap file behind
    this.swap = new Uint8Array(data).slice(0, 1);
    if (this.failWrite()) {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    }
    this.swap = new Uint8Array(data).slice();
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.swap) this.file.bytes = this.swap;
  }
  async abort(): Promise<void> {
    this.aborted = true;
    this.swap = null;
  }
}

class FakeFileHandle {
  constructor(
    private readonly file: FakeFile,
    private readonly owner: FakeDirHandle,
  ) {}
  async createWritable(): Promise<FakeWritable> {
    const writable = new FakeWritable(this.file, () => this.owner.failWrites);
    this.owner.writables.push(writable);
    return writable;
  }
  async getFile(): Promise<Blob> {
    return new Blob([this.file.bytes.slice()]);
  }
}

class FakeDirHandle {
  files = new Map<string, FakeFile>();
  subdirs = new Map<string, FakeDirHandle>();
  writables: FakeWritable[] = [];
  failWrites = false;
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
    return new FakeFileHandle(f, this);
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
};

let opfsRoot: FakeDirHandle;

/** Return the directory holding the files of *store* in the fake tree. */
function storeDir(): FakeDirHandle {
  const dirs: FakeDirHandle[] = [];
  const walk = (dir: FakeDirHandle) => {
    if (dir.files.size) dirs.push(dir);
    dir.subdirs.forEach(walk);
  };
  walk(opfsRoot);
  expect(dirs).toHaveLength(1);
  return dirs[0];
}

beforeEach(() => {
  opfsRoot = new FakeDirHandle();
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: { getDirectory: async () => opfsRoot },
  });
  Object.defineProperty(globalThis, "isSecureContext", {
    configurable: true,
    value: true,
  });
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
});

describe("OpfsObjectStore", () => {
  it("round-trips a payload byte-for-byte", async () => {
    const store = new OpfsObjectStore();
    await store.init();
    await store.put("obj-1", new Uint8Array([1, 2, 3, 250]));
    expect(Array.from(await store.get("obj-1"))).toEqual([1, 2, 3, 250]);
    expect(store.count()).toBe(1);
  });

  it("discards a failed write instead of committing it", async () => {
    const store = new OpfsObjectStore();
    await store.init();
    await store.put("obj-1", new Uint8Array([1, 2, 3]));
    const dir = storeDir();
    dir.failWrites = true;

    await expect(
      store.put("obj-1", new Uint8Array([7, 8, 9, 10])),
    ).rejects.toThrow("quota exceeded");

    const failed = dir.writables[dir.writables.length - 1];
    expect(failed.aborted).toBe(true);
    expect(failed.closed).toBe(false);
    // The previous copy is intact
    expect(Array.from(await store.get("obj-1"))).toEqual([1, 2, 3]);
    expect(store.totalBytes()).toBe(3);
  });
});
