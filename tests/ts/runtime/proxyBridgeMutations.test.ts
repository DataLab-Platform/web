import { describe, expect, it, vi } from "vitest";

import { buildProxyBridge } from "../../../src/runtime/proxyBridge";
import type { RuntimeApi } from "../../../src/runtime/runtime";

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
});
