/**
 * Unit tests for the per-session directories of the on-disk object stores
 * ({@link openSessionDirectory}), with a fake OPFS tree and a fake Web Locks
 * manager: the stores of two sessions never share or clear each other's
 * files, and the directories of ended sessions are reclaimed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OpfsObjectStore } from "../../../src/storage/opfsObjectStore";
import {
  SESSION_LOCK_PREFIX,
  SESSIONS_DIR,
  openSessionDirectory,
} from "../../../src/storage/opfsSession";

class FakeFile {
  bytes = new Uint8Array(0);
}

class FakeFileHandle {
  readonly kind = "file";
  constructor(
    readonly name: string,
    private readonly file: FakeFile,
  ) {}
  async createWritable() {
    const file = this.file;
    let swap: Uint8Array | null = null;
    return {
      write: async (data: ArrayBuffer) => {
        swap = new Uint8Array(data).slice();
      },
      close: async () => {
        if (swap) file.bytes = swap;
      },
      abort: async () => {
        swap = null;
      },
    };
  }
  async getFile(): Promise<Blob> {
    return new Blob([this.file.bytes.slice()]);
  }
}

class FakeDirHandle {
  readonly kind = "directory";
  files = new Map<string, FakeFile>();
  subdirs = new Map<string, FakeDirHandle>();
  constructor(readonly name = "") {}
  async getDirectoryHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FakeDirHandle> {
    let d = this.subdirs.get(name);
    if (!d) {
      if (!opts?.create) throw new Error("NotFound");
      d = new FakeDirHandle(name);
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
    return new FakeFileHandle(name, f);
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.subdirs.delete(name)) {
      throw new Error("NotFound");
    }
  }
  async *values(): AsyncIterable<FakeDirHandle | FakeFileHandle> {
    for (const dir of this.subdirs.values()) yield dir;
    for (const [name, file] of this.files) yield new FakeFileHandle(name, file);
  }
}

/** Fake Web Locks manager: exclusive locks, held while their callback's
 *  promise is pending. */
class FakeLockManager {
  readonly held = new Set<string>();
  async request(
    name: string,
    options: { mode?: string; ifAvailable?: boolean },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown> {
    if (this.held.has(name)) {
      if (options.ifAvailable) return callback(null);
      throw new Error("Lock contention is not simulated");
    }
    this.held.add(name);
    try {
      return await callback({ name, mode: options.mode });
    } finally {
      this.held.delete(name);
    }
  }
}

const ORIGINAL = {
  storage: (navigator as { storage?: unknown }).storage,
  locks: (navigator as { locks?: unknown }).locks,
  secure: globalThis.isSecureContext,
};

let opfsRoot: FakeDirHandle;
let locks: FakeLockManager | undefined;

function setLocks(manager: FakeLockManager | undefined): void {
  locks = manager;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: manager,
  });
}

function sessions(): FakeDirHandle {
  const parent = opfsRoot.subdirs.get(SESSIONS_DIR);
  expect(parent).toBeDefined();
  return parent as FakeDirHandle;
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
  setLocks(new FakeLockManager());
});

afterEach(() => {
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: ORIGINAL.storage,
  });
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: ORIGINAL.locks,
  });
  Object.defineProperty(globalThis, "isSecureContext", {
    configurable: true,
    value: ORIGINAL.secure,
  });
});

describe("OPFS session directories", () => {
  it("gives each store its own directory, owned by a held lock", async () => {
    const first = new OpfsObjectStore();
    const second = new OpfsObjectStore();
    await first.init();
    await second.init();

    const names = Array.from(sessions().subdirs.keys());
    expect(names).toHaveLength(2);
    expect(locks?.held).toEqual(
      new Set(names.map((name) => SESSION_LOCK_PREFIX + name)),
    );
  });

  it("never clears the files of another session", async () => {
    const first = new OpfsObjectStore();
    const second = new OpfsObjectStore();
    await first.init();
    await second.init();
    await first.put("a", new Uint8Array([1, 2, 3]));
    await second.put("b", new Uint8Array([4, 5]));

    // e.g. the second tab switches back to RAM or replaces its workspace
    await second.clear();

    expect(Array.from(await first.get("a"))).toEqual([1, 2, 3]);
    expect(await second.has("b")).toBe(false);
    await second.put("c", new Uint8Array([6]));
    expect(Array.from(await second.get("c"))).toEqual([6]);
  });

  it("reclaims the directories of ended sessions only", async () => {
    const parent = await opfsRoot.getDirectoryHandle(SESSIONS_DIR, {
      create: true,
    });
    const ended = await parent.getDirectoryHandle("ended", { create: true });
    await ended.getFileHandle("x.npy", { create: true });
    await parent.getDirectoryHandle("running", { create: true });
    locks?.held.add(SESSION_LOCK_PREFIX + "running");
    const legacy = await opfsRoot.getDirectoryHandle("dlw-object-store", {
      create: true,
    });
    await legacy.getFileHandle("old.npy", { create: true });

    const session = await openSessionDirectory(
      opfsRoot as unknown as FileSystemDirectoryHandle,
    );

    expect(new Set(sessions().subdirs.keys())).toEqual(
      new Set(["running", session.name]),
    );
    // The shared directory of earlier versions is left to them
    expect(opfsRoot.subdirs.get("dlw-object-store")?.files.has("old.npy")).toBe(
      true,
    );
  });

  it("keeps every directory without the Web Locks API", async () => {
    setLocks(undefined);
    const parent = await opfsRoot.getDirectoryHandle(SESSIONS_DIR, {
      create: true,
    });
    await parent.getDirectoryHandle("unknown", { create: true });

    const store = new OpfsObjectStore();
    await store.init();
    await store.put("a", new Uint8Array([1]));

    expect(sessions().subdirs.size).toBe(2);
    expect(sessions().subdirs.has("unknown")).toBe(true);
  });
});
