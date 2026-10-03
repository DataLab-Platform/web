import { describe, expect, it, vi } from "vitest";

import { DataLabRuntime } from "../../../src/runtime/runtime";

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
  storageMode: "ram" | "disk";
  opfsStore: {
    get: (oid: string) => Promise<Uint8Array>;
    put: (oid: string, bytes: Uint8Array) => Promise<void>;
    clear: () => Promise<void>;
  } | null;
  spilledOids: Set<string>;
  callPy<T>(name: string, kwargs?: Record<string, unknown>): Promise<T>;
}

/** Disk-mode runtime with one spilled object ("old") and one freshly-loaded
 *  resident object ("new") reported by ``spillable_objects``. */
function makeDiskRuntime() {
  const runtime = Object.create(DataLabRuntime.prototype) as RuntimeInternals;
  const store = {
    get: vi.fn(async () => new Uint8Array([1])),
    put: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  };
  runtime.py = {
    globals: {
      get: (name) => ({
        callKwargs: () => {
          if (name === "spillable_objects") return [{ oid: "new" }];
          if (name === "detach_object_array") return new Uint8Array([2]);
          return null;
        },
        destroy: () => {},
      }),
    },
  };
  runtime._queue = Promise.resolve();
  runtime.storageMode = "disk";
  runtime.opfsStore = store;
  runtime.spilledOids = new Set(["old"]);
  return { runtime, store };
}

describe("DataLabRuntime disk guard on workspace open", () => {
  it("keeps the current on-disk objects when a file is appended", async () => {
    const { runtime, store } = makeDiskRuntime();

    await runtime.callPy("open_workspace_from_bytes", { replace: false });

    expect(store.clear).not.toHaveBeenCalled();
    expect(runtime.spilledOids).toEqual(new Set(["old", "new"]));
    expect(store.put).toHaveBeenCalledWith("new", new Uint8Array([2]));
  });

  it("forgets the old store when the workspace is replaced", async () => {
    const { runtime, store } = makeDiskRuntime();

    await runtime.callPy("open_workspace_from_bytes", { replace: true });

    expect(store.clear).toHaveBeenCalledOnce();
    expect(runtime.spilledOids).toEqual(new Set(["new"]));
  });
});
