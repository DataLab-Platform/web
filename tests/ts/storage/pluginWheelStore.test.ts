import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PLUGIN_WHEEL_STORE_DIR,
  PluginWheelStore,
  type UserPluginWheelRecord,
} from "../../../src/storage/pluginWheelStore";

class FakeFile {
  bytes = new Uint8Array(0);
}

class FakeFileHandle {
  constructor(private readonly file: FakeFile) {}

  async createWritable() {
    return {
      write: async (value: string | ArrayBuffer | ArrayBufferView) => {
        if (typeof value === "string") {
          this.file.bytes = new TextEncoder().encode(value);
        } else if (ArrayBuffer.isView(value)) {
          this.file.bytes = new Uint8Array(
            value.buffer,
            value.byteOffset,
            value.byteLength,
          ).slice();
        } else {
          this.file.bytes = new Uint8Array(value).slice();
        }
      },
      close: async () => {},
    };
  }

  async getFile() {
    const bytes = this.file.bytes.slice();
    return {
      arrayBuffer: async () => bytes.buffer,
      text: async () => new TextDecoder().decode(bytes),
    };
  }
}

class FakeDirHandle {
  readonly files = new Map<string, FakeFile>();
  readonly subdirs = new Map<string, FakeDirHandle>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    let dir = this.subdirs.get(name);
    if (!dir) {
      if (!options?.create) throw new Error("NotFound");
      dir = new FakeDirHandle();
      this.subdirs.set(name, dir);
    }
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    let file = this.files.get(name);
    if (!file) {
      if (!options?.create) throw new Error("NotFound");
      file = new FakeFile();
      this.files.set(name, file);
    }
    return new FakeFileHandle(file);
  }

  async removeEntry(name: string) {
    if (!this.files.delete(name) && !this.subdirs.delete(name)) {
      throw new Error("NotFound");
    }
  }
}

const ORIGINAL = {
  storage: (navigator as { storage?: unknown }).storage,
  secure: globalThis.isSecureContext,
};

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
let root: FakeDirHandle;

function record(
  sha256 = SHA_A,
  overrides: Partial<UserPluginWheelRecord> = {},
): UserPluginWheelRecord {
  return {
    artifactId: `sha256:${sha256}`,
    sha256,
    filename: "example_plugin-1.0.0-py3-none-any.whl",
    sizeBytes: 4,
    distribution: "example-plugin",
    version: "1.0.0",
    pluginIds: ["org.example.plugin"],
    enabledPluginIds: ["org.example.plugin"],
    installedAt: "2026-03-25T12:00:00.000Z",
    ...overrides,
  };
}

async function writeFakeFile(
  dir: FakeDirHandle,
  name: string,
  value: string | Uint8Array,
) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(value);
  await writable.close();
}

beforeEach(() => {
  root = new FakeDirHandle();
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: { getDirectory: async () => root },
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

describe("PluginWheelStore", () => {
  it("uses a dedicated OPFS subtree", async () => {
    const store = new PluginWheelStore();
    await store.init();
    expect(root.subdirs.has(PLUGIN_WHEEL_STORE_DIR)).toBe(true);
    expect(root.subdirs.has("dlw-object-store")).toBe(false);
  });

  it("stages, commits, and restores wheel bytes", async () => {
    const store = new PluginWheelStore();
    await store.init();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await store.stage(SHA_A, bytes);
    await store.commit(record());

    const restored = await new PluginWheelStore();
    await restored.init();
    expect(restored.list()).toEqual([record()]);
    expect(Array.from(await restored.readBytes(SHA_A))).toEqual([1, 2, 3, 4]);
  });

  it("rolls back staged bytes after a failed import", async () => {
    const store = new PluginWheelStore();
    await store.init();
    await store.stage(SHA_A, new Uint8Array([1, 2, 3, 4]));
    await store.rollback(SHA_A);
    await expect(store.readBytes(SHA_A)).rejects.toThrow("NotFound");
    expect(store.list()).toEqual([]);
  });

  it("recovers the latest complete next index after interruption", async () => {
    const dir = await root.getDirectoryHandle(PLUGIN_WHEEL_STORE_DIR, {
      create: true,
    });
    await writeFakeFile(dir, `${SHA_B}.whl`, new Uint8Array([5, 6, 7, 8]));
    await writeFakeFile(
      dir,
      "index.json",
      JSON.stringify({ schemaVersion: 1, generation: 1, artifacts: [] }),
    );
    const recovered = record(SHA_B, {
      artifactId: `sha256:${SHA_B}`,
      distribution: "recovered-plugin",
    });
    await writeFakeFile(
      dir,
      "index.next.json",
      JSON.stringify({
        schemaVersion: 1,
        generation: 2,
        artifacts: [recovered],
      }),
    );

    const store = new PluginWheelStore();
    await store.init();

    expect(store.list()).toEqual([recovered]);
    expect(dir.files.has("index.next.json")).toBe(false);
  });

  it("persists enable state and removes an artifact", async () => {
    const store = new PluginWheelStore();
    await store.init();
    await store.stage(SHA_A, new Uint8Array([1, 2, 3, 4]));
    await store.commit(record());

    await store.setEnabledPluginIds(`sha256:${SHA_A}`, []);
    expect(store.list()[0].enabledPluginIds).toEqual([]);

    await store.remove(`sha256:${SHA_A}`);
    expect(store.list()).toEqual([]);
    await expect(store.readBytes(SHA_A)).rejects.toThrow("NotFound");
  });
});
