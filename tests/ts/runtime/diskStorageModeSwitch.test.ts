/**
 * Robustness of the on-disk storage mode against storage failures:
 *
 * - a switch to the on-disk mode that fails (store initialisation, write
 *   error) leaves the runtime in RAM mode, with every array resident, and may
 *   be retried;
 * - a successful Python call is never reported as failed because its objects
 *   could not be stored on disk afterwards (it would be applied twice if the
 *   user retried it).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DataLabRuntime } from "../../../src/runtime/runtime";

/** Behaviour of the fake OPFS stores, shared with the mocked modules. */
const opfs = vi.hoisted(() => ({
  initFailures: 0,
  failingPuts: new Set<string>(),
  failGets: false,
  failClear: false,
  instances: [] as Array<{ files: Map<string, Uint8Array> }>,
}));

vi.mock("../../../src/storage/opfsSyncObjectStore", () => ({
  OpfsSyncObjectStore: class {
    static isSupported(): boolean {
      return false;
    }
  },
}));

vi.mock("../../../src/storage/opfsObjectStore", () => ({
  OpfsObjectStore: class {
    readonly files = new Map<string, Uint8Array>();
    private initialised = false;

    static isSupported(): boolean {
      return true;
    }

    constructor() {
      opfs.instances.push(this);
    }

    async init(): Promise<void> {
      if (opfs.initFailures > 0) {
        opfs.initFailures -= 1;
        throw new DOMException("storage denied", "SecurityError");
      }
      this.initialised = true;
    }

    async put(oid: string, bytes: Uint8Array): Promise<void> {
      if (!this.initialised) throw new Error("init() must be called first");
      if (opfs.failingPuts.has(oid)) {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      }
      this.files.set(oid, bytes);
    }

    async get(oid: string): Promise<Uint8Array> {
      const bytes = this.files.get(oid);
      if (opfs.failGets || !bytes) {
        throw new DOMException(`cannot read ${oid}`, "NotReadableError");
      }
      return bytes;
    }

    async delete(oid: string): Promise<void> {
      this.files.delete(oid);
    }

    async clear(): Promise<void> {
      if (opfs.failClear) throw new DOMException("busy", "InvalidStateError");
      this.files.clear();
    }

    totalBytes(): number {
      return 0;
    }
  },
}));

type Handler = (kwargs: Record<string, unknown>) => unknown;

interface RuntimeInternals {
  py: {
    globals: {
      get: (name: string) => {
        callKwargs: (kwargs: Record<string, unknown>) => unknown;
        destroy: () => void;
      };
    };
  };
  _queue: Promise<unknown>;
  _latestReadGenerations: Map<string, number>;
  mutationListeners: Set<(name: string) => void>;
  storageMode: "ram" | "disk";
  opfsStore: unknown;
  spilledOids: Set<string>;
  storageErrorListeners: Set<(message: string) => void>;
  storageFailing: boolean;
  onStorageError(listener: (message: string) => void): () => void;
  setStorageMode(mode: "ram" | "disk"): Promise<void>;
  callPy<T>(name: string, kwargs?: Record<string, unknown>): Promise<T>;
}

const PAYLOAD = new Uint8Array([1, 2, 3]);

/**
 * Runtime whose fake Python side keeps the spill bookkeeping of
 * ``bootstrap.py``: *resident* objects hold their array, spilled ones only
 * their metadata. *handlers* answer the calls under test.
 */
function makeRuntime(
  resident: string[],
  handlers: Record<string, Handler> = {},
) {
  const runtime = Object.create(DataLabRuntime.prototype) as RuntimeInternals;
  const calls: string[] = [];
  const py = { resident: new Set(resident), spilled: new Set<string>() };
  const builtins: Record<string, Handler> = {
    spillable_objects: () => Array.from(py.resident, (oid) => ({ oid })),
    detach_object_array: ({ oid }) => {
      py.resident.delete(String(oid));
      py.spilled.add(String(oid));
      return PAYLOAD;
    },
    attach_object_array: ({ oid }) => {
      py.spilled.delete(String(oid));
      py.resident.add(String(oid));
      return true;
    },
    settle_object_array: ({ oid }) => {
      py.resident.delete(String(oid));
      py.spilled.add(String(oid));
      return { state: "rewritten", payload: PAYLOAD };
    },
    disk_sweep_state: () => ({
      spilled: Array.from(py.spilled),
      resident: Array.from(py.resident),
    }),
    collect_garbage: () => ({}),
  };
  runtime.py = {
    globals: {
      get: (name) => ({
        callKwargs: (kwargs) => {
          const key = name.replace(/^bridge_/, "");
          calls.push(key);
          const handler = handlers[key] ?? builtins[key];
          const value = handler ? handler(kwargs) : null;
          return name.startsWith("bridge_") ? { value } : value;
        },
        destroy: () => {},
      }),
    },
  };
  runtime._queue = Promise.resolve();
  runtime._latestReadGenerations = new Map();
  runtime.mutationListeners = new Set();
  runtime.storageMode = "ram";
  runtime.opfsStore = null;
  runtime.spilledOids = new Set();
  runtime.storageErrorListeners = new Set();
  runtime.storageFailing = false;
  const storageErrors: string[] = [];
  runtime.onStorageError((message) => storageErrors.push(message));
  return { runtime, py, calls, storageErrors };
}

beforeEach(() => {
  opfs.initFailures = 0;
  opfs.failingPuts.clear();
  opfs.failGets = false;
  opfs.failClear = false;
  opfs.instances.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("switch to the on-disk storage mode", () => {
  it("may be retried after the store could not be initialised", async () => {
    const { runtime, py } = makeRuntime(["A"]);
    opfs.initFailures = 1;

    await expect(runtime.setStorageMode("disk")).rejects.toThrow(
      "storage denied",
    );
    expect(runtime.storageMode).toBe("ram");
    expect(runtime.opfsStore).toBeNull();
    expect(py.resident).toEqual(new Set(["A"]));

    await runtime.setStorageMode("disk");

    expect(runtime.storageMode).toBe("disk");
    expect(runtime.spilledOids).toEqual(new Set(["A"]));
    expect(py.spilled).toEqual(new Set(["A"]));
  });

  it("stays in RAM mode with every array resident when a spill fails", async () => {
    const { runtime, py } = makeRuntime(["A", "B", "C"]);
    opfs.failingPuts.add("B");

    await expect(runtime.setStorageMode("disk")).rejects.toThrow(
      "quota exceeded",
    );

    expect(runtime.storageMode).toBe("ram");
    expect(runtime.spilledOids).toEqual(new Set());
    expect(py.resident).toEqual(new Set(["A", "B", "C"]));
    expect(py.spilled).toEqual(new Set());
    expect(opfs.instances[0].files.size).toBe(0);

    // A later switch, once the store accepts the data, spills everything
    opfs.failingPuts.clear();
    await runtime.setStorageMode("disk");
    expect(runtime.storageMode).toBe("disk");
    expect(runtime.spilledOids).toEqual(new Set(["A", "B", "C"]));
  });

  it("stays in on-disk mode when spilled arrays cannot be read back", async () => {
    const { runtime, py } = makeRuntime(["A", "B"]);
    opfs.failingPuts.add("B");
    opfs.failGets = true;

    await expect(runtime.setStorageMode("disk")).rejects.toThrow(
      "quota exceeded",
    );

    // "A" is still on disk only: the guard must keep paging it in
    expect(runtime.storageMode).toBe("disk");
    expect(runtime.spilledOids).toEqual(new Set(["A"]));
    expect(py.spilled).toEqual(new Set(["A"]));
  });
});

describe("a successful call is not failed by on-disk storage errors", () => {
  /** Disk-mode runtime with *spilled* objects on disk. */
  async function diskRuntime(
    spilled: string[],
    handlers: Record<string, Handler> = {},
  ) {
    const made = makeRuntime(spilled, handlers);
    await made.runtime.setStorageMode("disk");
    made.calls.length = 0;
    return made;
  }

  it("returns the result when a paged-in object cannot be rewritten", async () => {
    const { runtime, py, calls, storageErrors } = await diskRuntime(
      ["A", "B"],
      { set_image_data: () => "done" },
    );
    opfs.failingPuts.add("A");

    // ``set_image_data`` pages its object in and rewrites it afterwards
    await expect(runtime.callPy("set_image_data", { oid: "A" })).resolves.toBe(
      "done",
    );

    // "A" stays resident with its data, "B" is still on disk
    expect(py.resident).toEqual(new Set(["A"]));
    expect(runtime.spilledOids).toEqual(new Set(["B"]));
    expect(py.spilled).toEqual(new Set(["B"]));
    expect(calls).toContain("disk_sweep_state");
    expect(calls).toContain("collect_garbage");
    // The storage error is reported, without failing the call
    expect(storageErrors).toEqual(["quota exceeded"]);
  });

  it("reports a storage error once, until the store works again", async () => {
    const { runtime, storageErrors } = await diskRuntime(["A"], {
      set_image_data: () => "done",
      get_image_data: () => "read",
    });
    opfs.failingPuts.add("A");
    await runtime.callPy("set_image_data", { oid: "A" });
    await runtime.callPy("set_image_data", { oid: "A" });
    // A call that does not use the store does not end the failure
    await runtime.callPy("get_image_data", { oid: "A" });
    await runtime.callPy("set_image_data", { oid: "A" });
    expect(storageErrors).toHaveLength(1);

    opfs.failingPuts.clear();
    await runtime.callPy("set_image_data", { oid: "A" });
    expect(runtime.spilledOids).toEqual(new Set(["A"]));
    opfs.failingPuts.add("A");
    await runtime.callPy("set_image_data", { oid: "A" });
    expect(storageErrors).toHaveLength(2);
  });

  it("returns the result when the old store cannot be cleared", async () => {
    const { runtime, py } = await diskRuntime(["old"], {
      open_workspace_from_bytes: () => {
        py.spilled.clear();
        py.resident.add("new");
        return "opened";
      },
    });
    opfs.failClear = true;

    await expect(
      runtime.callPy("open_workspace_from_bytes", { replace: true }),
    ).resolves.toBe("opened");

    // The sweep still spills the objects of the new workspace
    expect(runtime.spilledOids).toEqual(new Set(["new"]));
    expect(py.spilled).toEqual(new Set(["new"]));
    expect(py.resident).toEqual(new Set());
  });
});
