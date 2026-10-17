import { describe, expect, it, vi } from "vitest";

import { DataLabRuntime } from "../../../src/runtime/runtime";

interface RuntimeInternals {
  callPy: (name: string, kwargs?: Record<string, unknown>) => Promise<unknown>;
  openWorkspaceCapsule: DataLabRuntime["openWorkspaceCapsule"];
}

/** Runtime whose Python side reports a 1 KiB capsule limit. */
function makeRuntime(limit: number | null = 1024) {
  const runtime = Object.create(DataLabRuntime.prototype) as RuntimeInternals;
  const callPy = vi.fn(async (name: string) => {
    if (name === "get_capsule_size_limit") return limit;
    return { signals: 1, images: 0 };
  });
  runtime.callPy = callPy;
  return { runtime, callPy };
}

describe("DataLabRuntime.openWorkspaceCapsule size check", () => {
  it("refuses a file over the limit before reading or transferring it", async () => {
    const { runtime, callPy } = makeRuntime();
    const file = new Blob([new Uint8Array(1025)]);
    const arrayBuffer = vi.spyOn(file, "arrayBuffer");

    await expect(
      runtime.openWorkspaceCapsule("big.dlcapsule", file),
    ).rejects.toThrow(/too large/);

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(callPy).not.toHaveBeenCalledWith(
      "open_workspace_capsule",
      expect.anything(),
    );
  });

  it("refuses oversized bytes without transferring them", async () => {
    const { runtime, callPy } = makeRuntime();

    await expect(
      runtime.openWorkspaceCapsule("big.dlcapsule", new Uint8Array(1025)),
    ).rejects.toThrow(/too large/);

    expect(callPy).toHaveBeenCalledTimes(1);
  });

  it("reads and opens a file within the limit", async () => {
    const { runtime, callPy } = makeRuntime();
    const file = new Blob([new Uint8Array([1, 2, 3])]);

    await runtime.openWorkspaceCapsule("small.dlcapsule", file, false);

    expect(callPy).toHaveBeenLastCalledWith("open_workspace_capsule", {
      filename: "small.dlcapsule",
      data: new Uint8Array([1, 2, 3]),
      replace: false,
      workspace: null,
    });
  });

  it("refuses a referenced workspace over the limit before reading either file", async () => {
    const { runtime, callPy } = makeRuntime();
    const capsule = new Blob([new Uint8Array(10)]);
    const workspace = new Blob([new Uint8Array(1025)]);
    const capsuleRead = vi.spyOn(capsule, "arrayBuffer");
    const workspaceRead = vi.spyOn(workspace, "arrayBuffer");

    await expect(
      runtime.openWorkspaceCapsule("ref.dlcapsule", capsule, true, workspace),
    ).rejects.toThrow(
      /Referenced workspace too large: 0\.1 MiB \(limit: 0\.0 MiB\)/,
    );

    expect(capsuleRead).not.toHaveBeenCalled();
    expect(workspaceRead).not.toHaveBeenCalled();
    expect(callPy).toHaveBeenCalledTimes(1);
  });

  it("accepts a referenced workspace at the limit", async () => {
    const { runtime, callPy } = makeRuntime();
    const workspace = new Uint8Array(1024);

    await runtime.openWorkspaceCapsule(
      "ref.dlcapsule",
      new Uint8Array([1]),
      true,
      workspace,
    );

    expect(callPy).toHaveBeenLastCalledWith("open_workspace_capsule", {
      filename: "ref.dlcapsule",
      data: new Uint8Array([1]),
      replace: true,
      workspace,
    });
  });
});

describe("DataLabRuntime.inspectWorkspaceCapsule size check", () => {
  it("refuses a referenced workspace over the limit before transferring it", async () => {
    const { runtime, callPy } = makeRuntime();
    const inspect = (
      runtime as unknown as {
        inspectWorkspaceCapsule: DataLabRuntime["inspectWorkspaceCapsule"];
      }
    ).inspectWorkspaceCapsule.bind(runtime);

    await expect(
      inspect(new Uint8Array(10), { workspace: new Uint8Array(1025) }),
    ).rejects.toThrow(/Referenced workspace too large/);
    await expect(inspect(new Uint8Array(1025))).rejects.toThrow(
      /Capsule too large/,
    );

    expect(callPy).not.toHaveBeenCalledWith(
      "inspect_workspace_capsule",
      expect.anything(),
    );
  });
});
