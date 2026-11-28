import { describe, expect, it, vi } from "vitest";

import { openRemoteFiles } from "../../../src/runtime/remoteFiles";
import type { RuntimeApi } from "../../../src/runtime/runtime";

function setup() {
  const runtime = {
    listSignalIoFormats: vi.fn(async () => ({
      all_read_extensions: ["csv", "npy"],
    })),
    listImageIoFormats: vi.fn(async () => ({
      all_read_extensions: ["png", "npy"],
    })),
    openSignalFromBytes: vi.fn(async (_name: string, _data: Uint8Array) => [
      "signal-id",
    ]),
    openImageFromBytes: vi.fn(async () => ["image-id"]),
  };
  const callbacks = {
    getCurrentPanel: () => "image",
    selectObjects: vi.fn(async () => {}),
    onModelChanged: vi.fn(),
  };
  return { runtime, callbacks };
}

describe("remote data files", () => {
  it("imports each supported file, reports failures and selects the last result", async () => {
    const { runtime, callbacks } = setup();
    runtime.openSignalFromBytes.mockRejectedValueOnce(new Error("bad CSV"));
    const bytes = new Uint8Array([0, 1, 2]);
    const result = await openRemoteFiles(
      runtime as unknown as RuntimeApi,
      {
        files: [
          { name: "broken.csv", bytes },
          { name: "image.PNG", bytes: bytes.buffer },
          { name: "array.npy", bytes },
        ],
      },
      callbacks,
    );
    expect(result.files).toEqual([
      { name: "broken.csv", panel: "signal", ids: [], error: "bad CSV" },
      { name: "image.PNG", panel: "image", ids: ["image-id"] },
      { name: "array.npy", panel: "image", ids: ["image-id"] },
    ]);
    expect(runtime.openImageFromBytes).toHaveBeenCalledTimes(2);
    expect(callbacks.selectObjects).toHaveBeenCalledWith(["image-id"], "image");
    expect(callbacks.onModelChanged).toHaveBeenCalledTimes(2);
  });

  it("validates the whole request before importing any file", async () => {
    const { runtime, callbacks } = setup();
    await expect(
      openRemoteFiles(
        runtime as unknown as RuntimeApi,
        {
          files: [
            { name: "ok.csv", bytes: new Uint8Array() },
            { name: "../escape.csv", bytes: [] },
          ],
        },
        callbacks,
      ),
    ).rejects.toThrow("basename and binary");
    expect(runtime.openSignalFromBytes).not.toHaveBeenCalled();
  });

  it("reports notification and selection failures without hiding imported IDs", async () => {
    const { runtime, callbacks } = setup();
    callbacks.onModelChanged.mockImplementation(() => {
      throw new Error("notification failed");
    });
    callbacks.selectObjects.mockRejectedValue(new Error("selection failed"));
    const result = await openRemoteFiles(
      runtime as unknown as RuntimeApi,
      { files: [{ name: "data.csv", bytes: new Uint8Array([1]) }] },
      callbacks,
    );
    expect(result).toEqual({
      files: [
        {
          name: "data.csv",
          ids: ["signal-id"],
          panel: "signal",
          warning:
            "Imported, but could not notify the host: notification failed",
        },
      ],
      selectionError: "selection failed",
    });
  });

  it("uses the requested kind for ambiguous extensions and rejects invalid kinds", async () => {
    const { runtime, callbacks } = setup();
    await openRemoteFiles(
      runtime as unknown as RuntimeApi,
      {
        files: [{ name: "data.npy", bytes: new Uint8Array() }],
        kind: "signal",
      },
      callbacks,
    );
    expect(runtime.openSignalFromBytes).toHaveBeenCalledOnce();
    await expect(
      openRemoteFiles(
        runtime as unknown as RuntimeApi,
        {
          files: [{ name: "data.npy", bytes: new Uint8Array() }],
          kind: "macro",
        },
        callbacks,
      ),
    ).rejects.toThrow("File kind");
  });

  it("keeps shared input buffers intact when a runtime consumes a file", async () => {
    const { runtime, callbacks } = setup();
    const bytes = new Uint8Array([17, 25]);
    runtime.openSignalFromBytes.mockImplementation(async (_name, data) => {
      expect(data[0]).toBe(17);
      data[0] = 0;
      return ["signal-id"];
    });
    const result = await openRemoteFiles(
      runtime as unknown as RuntimeApi,
      {
        files: [
          { name: "first.csv", bytes },
          { name: "second.csv", bytes },
        ],
      },
      callbacks,
    );
    expect(result.files).toHaveLength(2);
    expect(result.files.every((file) => !file.error)).toBe(true);
    expect(bytes[0]).toBe(17);
  });

  it("opens one workspace before data files while preserving result order", async () => {
    const { runtime, callbacks } = setup();
    const order: string[] = [];
    runtime.openSignalFromBytes.mockImplementation(async () => {
      order.push("data");
      return ["signal-id"];
    });

    const openWorkspace = vi.fn(async () => {
      order.push("workspace");
      return ["loaded-id"];
    });
    const bytes = new Uint8Array([42]);
    const result = await openRemoteFiles(
      runtime as unknown as RuntimeApi,
      {
        files: [
          { name: "data.csv", bytes },
          { name: "workspace.h5", bytes },
        ],
      },
      { ...callbacks, openWorkspace },
    );
    expect(order).toEqual(["workspace", "data"]);
    expect(result.files).toEqual([
      { name: "data.csv", ids: ["signal-id"], panel: "signal" },
      { name: "workspace.h5", ids: ["loaded-id"], workspace: true },
    ]);
  });

  it("uses the original panel for ambiguous files when a workspace changes it", async () => {
    const { runtime, callbacks } = setup();
    let panel = "signal";
    const result = await openRemoteFiles(
      runtime as unknown as RuntimeApi,
      {
        files: [
          { name: "data.npy", bytes: new Uint8Array() },
          { name: "workspace.h5", bytes: new Uint8Array() },
        ],
      },
      {
        ...callbacks,
        getCurrentPanel: () => panel,
        openWorkspace: async () => {
          panel = "image";
          return ["loaded-id"];
        },
      },
    );
    expect(result.files[0]).toMatchObject({
      panel: "signal",
      ids: ["signal-id"],
    });
    expect(runtime.openImageFromBytes).not.toHaveBeenCalled();
  });

  it("does not import accompanying files when the workspace is cancelled", async () => {
    const { runtime, callbacks } = setup();
    const result = await openRemoteFiles(
      runtime as unknown as RuntimeApi,
      {
        files: [
          { name: "data.csv", bytes: new Uint8Array() },
          { name: "workspace.dlcapsule", bytes: new Uint8Array() },
        ],
      },
      {
        ...callbacks,
        openWorkspace: async () => {
          throw new Error("Workspace opening was cancelled.");
        },
      },
    );
    expect(result.files[0].error).toContain("Not imported");
    expect(result.files[1].error).toContain("cancelled");
    expect(runtime.openSignalFromBytes).not.toHaveBeenCalled();
  });

  it("rejects multiple workspace files before changing anything", async () => {
    const { runtime, callbacks } = setup();
    const openWorkspace = vi.fn();
    await expect(
      openRemoteFiles(
        runtime as unknown as RuntimeApi,
        {
          files: [
            { name: "one.h5", bytes: new Uint8Array() },
            { name: "two.dlcapsule", bytes: new Uint8Array() },
          ],
        },
        { ...callbacks, openWorkspace },
      ),
    ).rejects.toThrow("one workspace");
    expect(openWorkspace).not.toHaveBeenCalled();
    expect(runtime.openSignalFromBytes).not.toHaveBeenCalled();
  });
});
