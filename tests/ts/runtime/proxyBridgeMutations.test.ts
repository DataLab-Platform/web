import { describe, expect, it, vi } from "vitest";

import { buildProxyBridge } from "../../../src/runtime/proxyBridge";
import type { RuntimeApi } from "../../../src/runtime/runtime";
import { workspaceBridgeGate } from "../../../src/runtime/workspaceBridgeGate";

/** Runtime whose ``runPython`` fails: the macro bridge must change the
 *  workspace through the queued runtime methods only, so that in on-disk
 *  storage mode the disk guard sees every object added, replaced or
 *  deleted by a macro. */
function makeRuntime() {
  const runtime = {
    runPython: vi.fn(async () => {
      throw new Error("runPython bypasses the runtime queue and disk guard");
    }),
    addObjectPickled: vi.fn(async () => "new-oid"),
    setObjectPickled: vi.fn(async () => "replaced-oid"),
    deleteObject: vi.fn(async () => {}),
    resetAll: vi.fn(async () => {}),
    createGroup: vi.fn(async () => "gid"),
  };
  return runtime;
}

describe("macro bridge mutations", () => {
  it("adds, replaces and deletes objects through the runtime", async () => {
    const runtime = makeRuntime();
    const onModelChanged = vi.fn();
    const selectObjects = vi.fn();
    const bridge = buildProxyBridge(runtime as unknown as RuntimeApi, {
      onModelChanged,
      selectObjects,
    });

    await expect(
      bridge.add_object({ pickled_b64: "AAA", kind: "image", group_id: "g1" }),
    ).resolves.toBe("new-oid");
    await expect(bridge.set_object({ pickled_b64: "BBB" })).resolves.toBe(
      "replaced-oid",
    );
    await bridge.delete_object({ oid: "old" });
    await bridge.reset_all({});

    expect(runtime.addObjectPickled).toHaveBeenCalledWith("AAA", "image", "g1");
    expect(runtime.setObjectPickled).toHaveBeenCalledWith("BBB");
    expect(runtime.deleteObject).toHaveBeenCalledWith("old");
    expect(runtime.resetAll).toHaveBeenCalledOnce();
    expect(runtime.runPython).not.toHaveBeenCalled();
    expect(selectObjects).toHaveBeenCalledWith(["new-oid"], "image");
  });

  it("creates groups in the requested or current panel", async () => {
    const runtime = makeRuntime();
    const bridge = buildProxyBridge(runtime as unknown as RuntimeApi, {
      getCurrentPanel: () => "image",
    });

    await expect(bridge.add_group({ title: "Results" })).resolves.toBe("gid");
    await bridge.add_group({ title: "Signals", panel: "signal" });

    expect(runtime.createGroup).toHaveBeenNthCalledWith(1, "image", "Results");
    expect(runtime.createGroup).toHaveBeenNthCalledWith(2, "signal", "Signals");
    expect(runtime.runPython).not.toHaveBeenCalled();
  });

  it("drains accepted bridge calls and rejects new ones while resetting", async () => {
    const runtime = makeRuntime();
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    runtime.addObjectPickled.mockImplementation(async () => {
      await held;
      return "new-oid";
    });
    const callbacks = { onModelChanged: vi.fn(), selectObjects: vi.fn() };
    const bridge = buildProxyBridge(
      runtime as unknown as RuntimeApi,
      callbacks,
    );
    const operation = bridge.add_object({ pickled_b64: "AAA", kind: "signal" });
    await Promise.resolve();

    const gate = workspaceBridgeGate(runtime);
    let drained = false;
    const paused = gate.pause().then(() => {
      drained = true;
    });
    await expect(bridge.delete_object({ oid: "old" })).rejects.toThrow(
      "workspace is being reset",
    );
    expect(drained).toBe(false);
    finish();
    await operation;
    await paused;
    expect(callbacks.selectObjects).toHaveBeenCalledWith(["new-oid"], "signal");
    gate.resume();
    await expect(bridge.delete_object({ oid: "old" })).resolves.toBeNull();
  });

  it("keeps the bridge paused until every nested reset releases it", async () => {
    const runtime = makeRuntime();
    const bridge = buildProxyBridge(runtime as unknown as RuntimeApi, {});
    const gate = workspaceBridgeGate(runtime);
    await gate.pause();
    await gate.pause();
    gate.resume();
    await expect(bridge.reset_all({})).rejects.toThrow(
      "workspace is being reset",
    );
    gate.resume();
    await expect(bridge.reset_all({})).resolves.toBeNull();
  });
});
