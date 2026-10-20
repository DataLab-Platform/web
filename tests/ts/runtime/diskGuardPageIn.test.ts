import { describe, expect, it, vi } from "vitest";

import { DataLabRuntime } from "../../../src/runtime/runtime";

type Handler = (kwargs: Record<string, unknown>) => unknown;

type RuntimeInternals = Pick<
  DataLabRuntime,
  | "getSignalViewSnapshot"
  | "getImageViewSnapshot"
  | "getFeatureSchema"
  | "resolveFeatureChoices"
  | "resolveFeatureCallbacks"
  | "getLastProcessing"
  | "assessPluginRecipes"
  | "checkPluginRecipeBindings"
  | "runPluginRecipe"
  | "launchPluginTool"
  | "describeObjectProvenance"
  | "deleteGroup"
  | "getPanelTree"
> & {
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
  opfsStore: {
    get: (oid: string) => Promise<Uint8Array>;
    put: (oid: string, bytes: Uint8Array) => Promise<void>;
    delete: (oid: string) => Promise<void>;
    clear: () => Promise<void>;
  };
  spilledOids: Set<string>;
  callPy<T>(name: string, kwargs?: Record<string, unknown>): Promise<T>;
};

/**
 * Disk-mode runtime whose fake Python side keeps the spill bookkeeping of
 * ``bootstrap.py``: *spilled* objects start on disk (both sides agree), and
 * *handlers* answer the calls under test.
 */
function makeDiskRuntime(
  spilled: string[],
  handlers: Record<string, Handler> = {},
) {
  const runtime = Object.create(DataLabRuntime.prototype) as RuntimeInternals;
  const calls: Array<{ name: string; kwargs: Record<string, unknown> }> = [];
  const py = {
    spilled: new Set(spilled),
    resident: new Set<string>(),
  };
  const builtins: Record<string, Handler> = {
    attach_object_array: ({ oid }) => {
      py.spilled.delete(String(oid));
      return true;
    },
    settle_object_array: ({ oid }) => {
      py.spilled.add(String(oid));
      return { state: "released" };
    },
    detach_object_array: ({ oid }) => {
      py.spilled.add(String(oid));
      py.resident.delete(String(oid));
      return new Uint8Array([7]);
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
          calls.push({ name: key, kwargs });
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
  runtime.storageMode = "disk";
  const store = {
    get: vi.fn<(oid: string) => Promise<Uint8Array>>(
      async () => new Uint8Array([1]),
    ),
    put: vi.fn<(oid: string, bytes: Uint8Array) => Promise<void>>(
      async () => {},
    ),
    delete: vi.fn<(oid: string) => Promise<void>>(async () => {}),
    clear: vi.fn<() => Promise<void>>(async () => {}),
  };
  runtime.opfsStore = store;
  runtime.spilledOids = new Set(spilled);
  const attached = () =>
    calls
      .filter((c) => c.name === "attach_object_array")
      .map((c) => c.kwargs.oid);
  const indexOf = (name: string) => calls.findIndex((c) => c.name === name);
  return { runtime, store, py, calls, attached, indexOf };
}

describe("disk guard — objects read by a call are paged in", () => {
  it("pages in the current and selected signals of a view snapshot", async () => {
    const { runtime, attached, indexOf } = makeDiskRuntime(["A", "B", "C"], {
      get_signal_view_snapshot: () => ({
        kind: "signal",
        current: { id: "A", x: [0, 1], y: [2, 3] },
        extras: [],
        annotations: { shapes: [], annotations: [] },
        roi: [],
        results: [],
        extra_results: [],
      }),
    });

    await runtime.getSignalViewSnapshot("A", ["A", "B"]);

    expect(attached()).toEqual(["A", "B"]);
    expect(indexOf("attach_object_array")).toBeLessThan(
      indexOf("get_signal_view_snapshot"),
    );
    expect(runtime.spilledOids).toEqual(new Set(["A", "B", "C"]));
  });

  it("pages in the current and selected images of a view snapshot", async () => {
    const { runtime, attached } = makeDiskRuntime(["I1", "I2"], {
      get_image_view_snapshot: () => ({
        kind: "image",
        mode: "multi",
        images: [],
        annotations: { shapes: [], annotations: [] },
        roi: [],
        lut_range: null,
        results: [],
      }),
    });

    await runtime.getImageViewSnapshot("I1", ["I2", "I1"]);

    expect(attached()).toEqual(["I1", "I2"]);
    expect(runtime.spilledOids).toEqual(new Set(["I1", "I2"]));
  });

  it("pages in the source of a processing dialog", async () => {
    const { runtime, attached } = makeDiskRuntime(["S", "other"], {
      get_feature_schema: () => ({ schema: {}, values: {} }),
      resolve_feature_choices: () => [],
      resolve_feature_callbacks: () => ({}),
    });

    await runtime.getFeatureSchema("image:radial_profile", "S");
    await runtime.resolveFeatureChoices("image:radial_profile", "x0", {}, "S");
    await runtime.resolveFeatureCallbacks(
      "image:radial_profile",
      "x0",
      {},
      "S",
    );

    expect(attached()).toEqual(["S", "S", "S"]);
    expect(runtime.spilledOids).toEqual(new Set(["S", "other"]));
  });

  it("pages in the source of the Processing tab, not the result", async () => {
    const { runtime, attached, calls } = makeDiskRuntime(["R", "S"], {
      last_processing_input_ids: () => ["S"],
      get_last_processing: () => null,
    });

    await runtime.getLastProcessing("R");

    expect(calls[0]).toEqual({
      name: "last_processing_input_ids",
      kwargs: { oid: "R" },
    });
    expect(attached()).toEqual(["S"]);
  });

  it("pages in the objects an application method is assessed or run on", async () => {
    const { runtime, attached } = makeDiskRuntime(["A", "B", "C"], {
      assess_plugin_recipes: () => ({}),
      check_plugin_recipe_bindings: () => ({}),
      run_plugin_recipe: () => ({ objects: [], results: [], diagnostics: [] }),
      launch_plugin_tool: () => ({ signal: [], image: [] }),
    });

    await runtime.assessPluginRecipes("plugin", ["A", "B"]);
    expect(attached()).toEqual(["A", "B"]);
    await runtime.checkPluginRecipeBindings("plugin", "recipe", {
      signals: ["A"],
      reference: ["C"],
    });
    expect(attached()).toEqual(["A", "B", "A", "C"]);
    await runtime.runPluginRecipe("plugin", "recipe", { signals: ["B", "C"] });
    expect(attached()).toEqual(["A", "B", "A", "C", "B", "C"]);
    await runtime.launchPluginTool("plugin", "tool", ["A"]);
    expect(attached()).toEqual(["A", "B", "A", "C", "B", "C", "A"]);
    expect(runtime.spilledOids).toEqual(new Set(["A", "B", "C"]));
  });

  it("never pages in the objects described by the provenance", async () => {
    const { runtime, attached } = makeDiskRuntime(["A"], {
      describe_object_provenance: () => ({ available: false }),
    });

    await runtime.describeObjectProvenance("A");

    expect(attached()).toEqual([]);
  });
});

describe("disk guard — paged-in objects are settled after the call", () => {
  it("rewrites the on-disk copy of an object whose data the call changed", async () => {
    const payload = new Uint8Array([4, 2]);
    const env = makeDiskRuntime(["A"], {
      set_object_property_values: () => null,
      settle_object_array: ({ oid }) => {
        env.py.spilled.add(String(oid));
        return { state: "rewritten", payload };
      },
    });
    const { runtime, store } = env;

    await runtime.callPy("set_object_property_values", {
      oid: "A",
      values: {},
    });

    expect(store.put).toHaveBeenCalledWith("A", payload);
    expect(runtime.spilledOids.has("A")).toBe(true);
  });

  it("keeps the on-disk copy of an object only read by the call", async () => {
    const { runtime, store } = makeDiskRuntime(["A"], {
      get_object_stats: () => ({}),
    });

    await runtime.callPy("get_object_stats", { oid: "A" });

    expect(store.put).not.toHaveBeenCalled();
    expect(runtime.spilledOids.has("A")).toBe(true);
  });

  it("deletes the on-disk copy of an object that left the model", async () => {
    const { runtime, store } = makeDiskRuntime(["A"], {
      get_object_stats: () => null,
      settle_object_array: () => ({ state: "gone" }),
    });

    await runtime.callPy("get_object_stats", { oid: "A" });

    expect(store.delete).toHaveBeenCalledWith("A");
    expect(runtime.spilledOids.has("A")).toBe(false);
  });
});

describe("disk guard — the store is reconciled after objects change", () => {
  it("deletes the on-disk copies of the objects of a deleted group", async () => {
    const { runtime, store, py, attached } = makeDiskRuntime(["A", "B"], {
      delete_group: () => {
        py.spilled.delete("B");
        return null;
      },
    });

    await runtime.deleteGroup("g1", "signal");

    expect(attached()).toEqual([]);
    expect(store.delete).toHaveBeenCalledWith("B");
    expect(store.delete).not.toHaveBeenCalledWith("A");
    expect(runtime.spilledOids).toEqual(new Set(["A"]));
  });

  it("spills the objects added by a call, whatever it returns", async () => {
    const { runtime, store, py } = makeDiskRuntime(["A"], {
      run_plugin_recipe: () => {
        py.resident.add("new-1");
        py.resident.add("new-2");
        return { objects: [{ id: "new-1" }, { id: "new-2" }] };
      },
    });

    await runtime.runPluginRecipe("plugin", "recipe", { signals: ["A"] });

    expect(store.put).toHaveBeenCalledWith("new-1", new Uint8Array([7]));
    expect(store.put).toHaveBeenCalledWith("new-2", new Uint8Array([7]));
    expect(runtime.spilledOids).toEqual(new Set(["A", "new-1", "new-2"]));
  });

  it("replaces the on-disk copy of an object replaced by a macro", async () => {
    const order: string[] = [];
    const { runtime, store, py } = makeDiskRuntime(["A"], {
      set_object_pickled: () => {
        // ``set_object_pickled`` forgets the stale spill record of "A".
        py.spilled.delete("A");
        py.resident.add("A");
        return "A";
      },
    });
    store.delete.mockImplementation(async (oid: string) => {
      order.push(`delete:${oid}`);
    });
    store.put.mockImplementation(async (oid: string) => {
      order.push(`put:${oid}`);
    });

    await runtime.callPy("set_object_pickled", { pickled_b64: "..." });

    expect(order).toEqual(["delete:A", "put:A"]);
    expect(runtime.spilledOids).toEqual(new Set(["A"]));
  });

  it("spills what a failed call produced before raising", async () => {
    const { runtime, store, py } = makeDiskRuntime(["A"], {
      apply_feature: () => {
        py.resident.add("partial");
        throw new Error("second group failed");
      },
    });

    await expect(
      runtime.callPy("apply_feature", { feature_id: "f", source_ids: ["A"] }),
    ).rejects.toThrow("second group failed");

    expect(store.put).toHaveBeenCalledWith("partial", new Uint8Array([7]));
    expect(runtime.spilledOids).toEqual(new Set(["A", "partial"]));
  });

  it("does not reconcile the store after a read-only call", async () => {
    const { runtime, calls } = makeDiskRuntime(["A"], {
      get_panel_tree: () => ({ groups: [] }),
    });

    await runtime.getPanelTree("signal");

    expect(calls.map((c) => c.name)).toEqual(["get_panel_tree"]);
  });
});
