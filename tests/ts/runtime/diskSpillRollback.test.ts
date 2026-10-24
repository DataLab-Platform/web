import { describe, expect, it, vi } from "vitest";

import { DataLabRuntime } from "../../../src/runtime/runtime";

/** Private disk-mode members exercised by these tests. */
type RuntimeInternals = {
  py: {
    globals: {
      get: (name: string) => {
        callKwargs: (kwargs: Record<string, unknown>) => unknown;
        destroy: () => void;
      };
    };
  };
  storageMode: "ram" | "disk";
  opfsStore: {
    put: (oid: string, bytes: Uint8Array) => Promise<void>;
    delete: (oid: string) => Promise<void>;
  };
  spilledOids: Set<string>;
  spillDirect(oid: string): Promise<boolean>;
  settleDirect(oid: string, rewrite: boolean): Promise<void>;
};

const PAYLOAD = new Uint8Array([1, 2, 3, 4]);

/**
 * Disk-mode runtime whose fake Python side mirrors the spill bookkeeping of
 * ``bootstrap.py`` (``detach_object_array`` drops the array and marks the
 * object spilled, ``attach_object_array`` restores it), with an OPFS store
 * whose ``put`` behaves as *put*.
 */
function makeRuntime(put: (oid: string, bytes: Uint8Array) => Promise<void>) {
  const runtime = Object.create(DataLabRuntime.prototype) as RuntimeInternals;
  const calls: Array<{ name: string; kwargs: Record<string, unknown> }> = [];
  const py = { spilled: new Set<string>() };
  const handlers: Record<string, (kwargs: Record<string, unknown>) => unknown> =
    {
      detach_object_array: ({ oid }) => {
        py.spilled.add(String(oid));
        return PAYLOAD;
      },
      attach_object_array: ({ oid }) => {
        py.spilled.delete(String(oid));
        return true;
      },
      settle_object_array: ({ oid }) => {
        py.spilled.add(String(oid));
        return { state: "rewritten", payload: PAYLOAD };
      },
    };
  runtime.py = {
    globals: {
      get: (name) => ({
        callKwargs: (kwargs) => {
          calls.push({ name, kwargs });
          return handlers[name]?.(kwargs) ?? null;
        },
        destroy: () => {},
      }),
    },
  };
  runtime.storageMode = "disk";
  const store = {
    put: vi.fn(put),
    delete: vi.fn<(oid: string) => Promise<void>>(async () => {}),
  };
  runtime.opfsStore = store;
  runtime.spilledOids = new Set();
  const attachCalls = () =>
    calls.filter((c) => c.name === "attach_object_array").map((c) => c.kwargs);
  return { runtime, store, py, attachCalls };
}

const quotaExceeded = async () => {
  throw new DOMException("quota exceeded", "QuotaExceededError");
};

describe("disk spill — a failed OPFS write never loses the data", () => {
  it("spills an object once its bytes are persisted", async () => {
    const { runtime, store, py, attachCalls } = makeRuntime(async () => {});

    await expect(runtime.spillDirect("A")).resolves.toBe(true);

    expect(store.put).toHaveBeenCalledWith("A", PAYLOAD);
    expect(runtime.spilledOids).toEqual(new Set(["A"]));
    expect(py.spilled).toEqual(new Set(["A"]));
    expect(attachCalls()).toEqual([]);
  });

  it("attaches the bytes back when the first spill cannot be written", async () => {
    const { runtime, store, py, attachCalls } = makeRuntime(quotaExceeded);

    await expect(runtime.spillDirect("A")).rejects.toThrow("quota exceeded");

    // Same bytes, flagged as not persisted: the object is resident again
    expect(attachCalls()).toEqual([
      { oid: "A", payload: PAYLOAD, on_disk: false },
    ]);
    expect(py.spilled).toEqual(new Set());
    expect(runtime.spilledOids).toEqual(new Set());
    // A partially written copy is removed
    expect(store.delete).toHaveBeenCalledWith("A");
  });

  it("attaches the changed data back when its rewrite cannot be written", async () => {
    const { runtime, py, attachCalls } = makeRuntime(quotaExceeded);

    await expect(runtime.settleDirect("A", false)).rejects.toThrow(
      "quota exceeded",
    );

    expect(attachCalls()).toEqual([
      { oid: "A", payload: PAYLOAD, on_disk: false },
    ]);
    expect(py.spilled).toEqual(new Set());
    expect(runtime.spilledOids).toEqual(new Set());
  });

  it("keeps the data resident when a forced rewrite cannot be written", async () => {
    const { runtime, py, attachCalls } = makeRuntime(quotaExceeded);

    await expect(runtime.settleDirect("A", true)).rejects.toThrow(
      "quota exceeded",
    );

    expect(attachCalls()).toHaveLength(1);
    expect(py.spilled).toEqual(new Set());
    expect(runtime.spilledOids).toEqual(new Set());
  });
});
