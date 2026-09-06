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
  opfsStore: { get: (oid: string) => Promise<Uint8Array> } | null;
  spilledOids: Set<string>;
  _latestReadGenerations: Map<string, number>;
  callPy<T>(name: string, kwargs?: Record<string, unknown>): Promise<T>;
  callPyLatest<T>(
    key: string,
    name: string,
    kwargs?: Record<string, unknown>,
  ): Promise<T | null>;
  getSignalViewSnapshot: DataLabRuntime["getSignalViewSnapshot"];
  previewFeature: DataLabRuntime["previewFeature"];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeRuntime(
  invoke: (name: string, kwargs: Record<string, unknown>) => unknown,
): RuntimeInternals {
  const runtime = Object.create(DataLabRuntime.prototype) as RuntimeInternals;
  runtime.py = {
    globals: {
      get: (name) => ({
        callKwargs: (kwargs) => invoke(name, kwargs),
        destroy: () => {},
      }),
    },
  };
  runtime._queue = Promise.resolve();
  runtime.storageMode = "ram";
  runtime.opfsStore = null;
  runtime.spilledOids = new Set();
  runtime._latestReadGenerations = new Map();
  return runtime;
}

describe("DataLabRuntime latest-read queue", () => {
  it("runs the active read, every mutation, and only the latest waiting read", async () => {
    const active = deferred<string>();
    const executed: string[] = [];
    const runtime = makeRuntime((name, kwargs) => {
      const label = name === "mutate" ? "mutation" : String(kwargs.id);
      executed.push(label);
      return label === "A" ? active.promise : label;
    });

    const readA = runtime.callPyLatest<string>("selection-view", "snapshot", {
      id: "A",
    });
    await Promise.resolve();
    const readB = runtime.callPyLatest<string>("selection-view", "snapshot", {
      id: "B",
    });
    const mutation = runtime.callPy<string>("mutate");
    const readC = runtime.callPyLatest<string>("selection-view", "snapshot", {
      id: "C",
    });

    active.resolve("A");

    await expect(readA).resolves.toBe("A");
    await expect(readB).resolves.toBeNull();
    await expect(mutation).resolves.toBe("mutation");
    await expect(readC).resolves.toBe("C");
    expect(executed).toEqual(["A", "mutation", "C"]);
  });

  it("decodes every binary signal in an atomic snapshot", async () => {
    const bytes = (values: number[]) =>
      new Uint8Array(new Float64Array(values).buffer);
    const runtime = makeRuntime(() => ({
      kind: "signal",
      current: {
        id: "A",
        encoding: "f64",
        x_bytes: bytes([0, 1]),
        y_bytes: bytes([2, 3]),
      },
      extras: [
        {
          id: "B",
          encoding: "f64",
          x_bytes: bytes([4]),
          y_bytes: bytes([5]),
        },
      ],
      annotations: { shapes: [], annotations: [] },
      roi: [],
      results: [],
      extra_results: [],
    }));

    const snapshot = await runtime.getSignalViewSnapshot("A", ["A", "B"]);

    expect(snapshot?.current.x).toBeInstanceOf(Float64Array);
    expect(Array.from(snapshot?.current.y ?? [])).toEqual([2, 3]);
    expect(Array.from(snapshot?.extras[0].x ?? [])).toEqual([4]);
  });

  it("pages a spilled preview source in and releases it after the read", async () => {
    const calls: string[] = [];
    const sourceBytes = new Uint8Array([1, 2, 3]);
    const runtime = makeRuntime((name) => {
      calls.push(name);
      if (name === "release_object_array") return true;
      if (name === "preview_feature") {
        return {
          kind: "signal",
          data: {
            id: "preview",
            uuid: null,
            title: "Preview",
            size: 2,
            xlabel: "x",
            ylabel: "y",
            xunit: "",
            yunit: "",
            x: [0, 1],
            y: [2, 3],
          },
        };
      }
      return null;
    });
    const get = vi.fn(async () => sourceBytes);
    runtime.storageMode = "disk";
    runtime.opfsStore = { get };
    runtime.spilledOids.add("signal-1");

    const result = await runtime.previewFeature("normalize", "signal-1", {});

    expect(result.kind).toBe("signal");
    expect(get).toHaveBeenCalledWith("signal-1");
    expect(calls.indexOf("attach_object_array")).toBeLessThan(
      calls.indexOf("preview_feature"),
    );
    expect(calls.indexOf("release_object_array")).toBeGreaterThan(
      calls.indexOf("preview_feature"),
    );
    expect(runtime.spilledOids.has("signal-1")).toBe(true);
  });
});
