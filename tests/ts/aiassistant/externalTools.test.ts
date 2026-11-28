import { describe, expect, it, vi } from "vitest";

import {
  callExternalTool,
  listExternalTools,
} from "../../../src/aiassistant/externalTools";
import type { RuntimeApi } from "../../../src/runtime/runtime";

function setup() {
  let selected = ["image-1"];
  const image = (id: string, uuid: string) => ({
    id,
    uuid,
    title: "Repeated title",
    kind: "image",
    size: 12,
    xlabel: "X",
    ylabel: "Y",
    xunit: "mm",
    yunit: "mm",
  });
  const signal = {
    ...image("signal-1", "persistent-signal"),
    kind: "signal",
    title: "Profile",
  };
  const imageObjects = [
    image("image-1", "persistent-image-1"),
    image("image-2", "persistent-image-2"),
  ];
  const signalObjects = [signal];
  const feature = {
    id: "image:average_profile",
    label: "Average profile",
    menu_path: "Profiles/Average",
    pattern: "1_to_1",
    has_params: true,
    object_kind: "image",
    output_kind: "signal",
    builtin: true,
  };
  const analysis = {
    id: "fwhm",
    label: "FWHM",
    has_params: true,
    builtin: true,
  };
  const schema = {
    schema: {
      properties: {
        direction: {
          type: "string",
          "x-guidata-kind": "choice",
          enum: ["horizontal", "vertical"],
        },
        x1: { type: "number", "x-guidata-kind": "float" },
      },
    },
    values: { direction: "horizontal", x1: null },
  };
  const runtime = {
    getPanelTree: vi.fn(async (kind: string) => ({
      kind,
      groups: [
        {
          gid: "group",
          name: "Group",
          objects: kind === "image" ? imageObjects : signalObjects,
        },
      ],
    })),
    listFeatures: vi.fn(async () => [
      feature,
      { ...feature, id: "unprefixed-plugin", builtin: false },
    ]),
    listSignalAnalysis: vi.fn(async () => [
      analysis,
      { ...analysis, id: "plugin-analysis", builtin: false },
    ]),
    listImageAnalysis: vi.fn(async () => []),
    getFeatureSchema: vi.fn(async () => schema),
    getSignalAnalysisParamSchema: vi.fn(async () => ({
      schema: {
        properties: {
          method: { type: "string", enum: ["gauss", "zero-crossing"] },
        },
      },
      values: { method: "zero-crossing" },
    })),
    resolveFeatureActive: vi.fn(async () => ({})),
    resolveAnalysisActive: vi.fn(async () => ({})),
    checkFeatureInputs: vi.fn(async () => {}),
    applyFeature: vi.fn(async () => ["signal-1"]),
    runSignalAnalysis: vi.fn(async () => ({
      category: "table",
      kind: "fwhm",
      title: "FWHM",
      func_name: "fwhm",
      headers: ["width (mm)"],
      roi_indices: null,
      data: [[1.23]],
    })),
    listSignalResults: vi.fn(async () => []),
    listImageResults: vi.fn(async () => []),
    getObjectStats: vi.fn(async () => ({
      kind: "image",
      shape: [3, 4],
      min: 0,
      max: 1,
    })),
    getImageRoi: vi.fn(async () => []),
    listObjectMetadata: vi.fn(async () => []),
    getLastProcessing: vi.fn(async () => null),
    getSignalDataPreview: vi.fn(async () => ({
      size: 12,
      indices: [0],
      x: [0],
      y: [1],
    })),
  };
  const context = {
    getCurrentPanel: () => "image",
    getSelection: () => selected,
    selectObjects: vi.fn(async () => {}),
    onModelChanged: vi.fn(),
  };
  const call = (name: string, args: unknown) =>
    callExternalTool(runtime as unknown as RuntimeApi, context, name, args);
  return {
    runtime,
    context,
    call,
    setSelection: (ids: string[]) => {
      selected = ids;
    },
  };
}

describe("external DataLab tools", () => {
  it("exports only the intended tools and excludes plugin features even with unprefixed ids", async () => {
    const { call, runtime } = setup();
    expect(listExternalTools().map((tool) => tool.name)).not.toContain(
      "create_and_run_macro",
    );
    const catalog = await call("list_available_operations", { panel: "image" });
    expect(catalog.ok).toBe(true);
    expect(JSON.stringify(catalog)).toContain("image:average_profile");
    expect(JSON.stringify(catalog)).not.toContain("unprefixed-plugin");
    const blocked = await call("apply_operation", {
      name: "unprefixed-plugin",
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("Unknown built-in operation");
    expect(runtime.applyFeature).not.toHaveBeenCalled();
    const analysis = await call("apply_operation", {
      name: "plugin-analysis",
      panel: "signal",
      target_uuid: "persistent-signal",
    });
    expect(analysis.ok).toBe(false);
    expect(runtime.runSignalAnalysis).not.toHaveBeenCalled();
  });

  it("fails closed if a runtime cannot identify plugin contributions", async () => {
    const { call, runtime } = setup();
    runtime.listImageAnalysis.mockResolvedValueOnce([
      { id: "old", label: "Old" },
    ] as never);
    const result = await call("list_available_operations", { panel: "image" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("does not identify plugin");
  });

  it("uses UUIDs rather than duplicate titles and displays a cross-panel result", async () => {
    const { call, runtime, context } = setup();
    const result = await call("apply_operation", {
      name: "image:average_profile",
      target_uuid: "persistent-image-2",
      parameters: { direction: "horizontal", x1: -3 },
    });
    expect(result.ok).toBe(true);
    expect(runtime.checkFeatureInputs).toHaveBeenCalledWith(
      "image:average_profile",
      ["image-2"],
      null,
      { direction: "horizontal", x1: -3 },
    );
    expect(runtime.applyFeature).toHaveBeenCalledWith(
      "image:average_profile",
      ["image-2"],
      null,
      { direction: "horizontal", x1: -3 },
    );
    expect(context.selectObjects).toHaveBeenCalledWith(["signal-1"], "signal");
    expect(result.data).toMatchObject({
      created: [
        { id: "signal-1", uuid: "persistent-signal", title: "Profile" },
      ],
    });
    const title = await call("apply_operation", {
      name: "image:average_profile",
      target_uuid: "Repeated title",
    });
    expect(title.ok).toBe(false);
    expect(title.error).toContain("not found");
  });

  it("freezes the implicit selection before an asynchronous lookup", async () => {
    const { call, runtime, setSelection } = setup();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = runtime.getPanelTree.getMockImplementation()!;
    runtime.getPanelTree.mockImplementation(async (kind) => {
      await wait;
      return original(kind);
    });
    const pending = call("apply_operation", { name: "image:average_profile" });
    setSelection(["image-2"]);
    release();
    expect((await pending).ok).toBe(true);
    expect(runtime.applyFeature).toHaveBeenCalledWith(
      "image:average_profile",
      ["image-1"],
      null,
      expect.any(Object),
    );
  });

  it("rejects unknown, invalid and unavailable parameter values before computing", async () => {
    const { call, runtime } = setup();
    for (const parameters of [
      { misspelled: 1 },
      { direction: "diagonal" },
      { x1: "not a number" },
    ]) {
      const result = await call("apply_operation", {
        name: "image:average_profile",
        parameters,
      });
      expect(result.ok).toBe(false);
    }
    runtime.resolveFeatureActive.mockResolvedValueOnce({ direction: false });
    const inactive = await call("apply_operation", {
      name: "image:average_profile",
      parameters: { direction: "vertical" },
    });
    expect(inactive.error).toContain("not editable");
    expect(runtime.applyFeature).not.toHaveBeenCalled();
  });

  it("runs analysis and reports partial failures without hiding saved results", async () => {
    const { call, runtime, context } = setup();
    const result = await call("apply_operation", {
      name: "fwhm",
      target_uuid: "persistent-signal",
      parameters: { method: "gauss" },
    });
    expect(result.ok).toBe(true);
    expect(runtime.runSignalAnalysis).toHaveBeenCalledWith("signal-1", "fwhm", {
      method: "gauss",
    });
    expect(context.onModelChanged).toHaveBeenCalledWith("signal", ["signal-1"]);
    expect(result.data).toMatchObject({
      results: [{ result: { headers: ["width (mm)"], data: [[1.23]] } }],
    });
    runtime.runSignalAnalysis.mockRejectedValueOnce(
      new Error("calculation failed"),
    );
    const failed = await call("apply_operation", {
      name: "fwhm",
      target_uuid: "signal-1",
    });
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("failed");
    expect(failed.data).toMatchObject({
      results: [{ error: "calculation failed" }],
    });
  });

  it("bounds result rows and rejects oversized responses explicitly", async () => {
    const { call, runtime } = setup();
    runtime.listSignalResults.mockResolvedValueOnce([
      {
        category: "table",
        kind: "statistics",
        title: "Stats",
        func_name: "stats",
        headers: ["value"],
        roi_indices: null,
        data: Array.from({ length: 100 }, (_, i) => [i]),
      },
    ] as never);
    const result = await call("get_results", {
      panel: "signal",
      uuids: ["signal-1"],
    });
    expect(result.data).toMatchObject({
      results: [{ results: [{ row_count: 100, truncated: true }] }],
    });
    expect(JSON.stringify(result).length).toBeLessThan(20_000);
    runtime.getObjectStats.mockResolvedValueOnce({
      huge: "x".repeat(25_000),
    } as never);
    const oversized = await call("get_object_info", {
      panel: "image",
      nb_id_title: "image-1",
    });
    expect(oversized.ok).toBe(false);
    expect(oversized.error).toContain("20 kB");
  });

  it("rejects malformed, oversized and unknown arguments", async () => {
    const { call } = setup();
    expect((await call("get_selection", { typo: true })).error).toContain(
      "Unknown argument",
    );
    expect((await call("select_objects", { uuids: [] })).error).toContain(
      "must not be empty",
    );
    expect(
      (
        await call("create_synthetic_image", {
          kind: "gauss",
          title: "Image",
          width: 4096,
          height: 4096,
        })
      ).error,
    ).toContain("pixels");
    expect(
      (
        await call("apply_operation", {
          name: "image:average_profile",
          parameters: { description: "x".repeat(21_000) },
        })
      ).error,
    ).toContain("20 kB");
  });
});
