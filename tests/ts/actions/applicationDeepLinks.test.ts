import { describe, expect, it, vi } from "vitest";

import { openBundledApplicationDeepLink } from "../../../src/actions/applicationDeepLinks";
import type {
  PluginExampleOpenResult,
  PluginRecord,
  RuntimeApi,
} from "../../../src/runtime/runtime";
import type { ApplicationDeepLinkRequest } from "../../../src/utils/applicationDeepLink";

const CAMERA_REQUEST: ApplicationDeepLinkRequest = {
  pluginId: "org.datalab.camera-characterization",
  pluginVersion: "0.1.0",
  recipeId: "org.datalab.camera-characterization:relative-dn-characterization",
  recipeVersion: "1.1.0",
  exampleId: "quickstart",
};

const PULSE_REQUEST: ApplicationDeepLinkRequest = {
  pluginId: "org.datalab.pulse-characterization",
  pluginVersion: "0.1.0",
  recipeId: "org.datalab.pulse-characterization:single-channel-campaign",
  recipeVersion: "1.1.0",
  exampleId: "demo",
};

const CAMERA_EXAMPLE: PluginExampleOpenResult = {
  plugin_id: CAMERA_REQUEST.pluginId,
  example_id: CAMERA_REQUEST.exampleId,
  recipe_id: CAMERA_REQUEST.recipeId,
  filename: "camera_quickstart.h5",
  panel: "image",
  selected_ids: ["camera-image"],
  current_id: "camera-image",
  dirty: false,
  parameter_values: {},
};

const PULSE_EXAMPLE: PluginExampleOpenResult = {
  plugin_id: PULSE_REQUEST.pluginId,
  example_id: PULSE_REQUEST.exampleId,
  recipe_id: PULSE_REQUEST.recipeId,
  filename: null,
  panel: "signal",
  selected_ids: ["pulse-1", "pulse-2"],
  current_id: "pulse-2",
  dirty: true,
  parameter_values: { minimum_snr_db: 12 },
};

function bundledRecord(
  request: ApplicationDeepLinkRequest,
  overrides: Partial<PluginRecord> = {},
): PluginRecord {
  return {
    name: request.pluginId,
    record_id: request.pluginId,
    filename: `${request.pluginId}.whl`,
    module: `${request.pluginId}.web`,
    source: "bundled-wheel",
    artifact_id: "sha256:test",
    artifact_filename: `${request.pluginId}.whl`,
    plugin_id: request.pluginId,
    distribution: request.pluginId,
    version: request.pluginVersion,
    sha256: "test",
    trust: "verified",
    entry_point: `${request.pluginId}.web:Plugin`,
    enabled: true,
    loaded: true,
    error: null,
    info: {
      id: request.pluginId,
      name: request.pluginId,
      version: request.pluginVersion,
      description: "Test application",
      icon: null,
      capabilities: ["application"],
      documentation_url: null,
    },
    recipes: [
      {
        id: request.recipeId,
        version: request.recipeVersion,
        title: "Test recipe",
        description: "",
        inputs: [],
        has_params: true,
      },
    ],
    examples: [
      {
        id: request.exampleId,
        title: "Test example",
        description: "",
        recipe_id: request.recipeId,
        expected_checks: [],
      },
    ],
    operations: {
      can_enable: true,
      can_disable: true,
      can_remove: false,
      can_reload: true,
    },
    ...overrides,
  };
}

function runtimeMock() {
  return {
    listPlugins: vi.fn(async () => [
      bundledRecord(CAMERA_REQUEST),
      bundledRecord(PULSE_REQUEST),
    ]),
    openPluginExample: vi.fn(
      async (pluginId: string): Promise<PluginExampleOpenResult> =>
        pluginId === CAMERA_REQUEST.pluginId ? CAMERA_EXAMPLE : PULSE_EXAMPLE,
    ),
    runPluginRecipe: vi.fn(),
  };
}

describe("openBundledApplicationDeepLink", () => {
  it("rejects an unknown plugin without consulting or mutating the runtime", async () => {
    const runtime = runtimeMock();
    const result = await openBundledApplicationDeepLink(
      runtime as unknown as RuntimeApi,
      { ...CAMERA_REQUEST, pluginId: "org.example.external" },
    );
    expect(result).toEqual({
      kind: "unsupported",
      pluginId: "org.example.external",
    });
    expect(runtime.openPluginExample).not.toHaveBeenCalled();
  });

  it("rejects a version mismatch before opening Camera's workspace", async () => {
    const runtime = runtimeMock();
    const result = await openBundledApplicationDeepLink(
      runtime as unknown as RuntimeApi,
      { ...CAMERA_REQUEST, pluginVersion: "9.0.0" },
    );
    expect(result).toEqual({
      kind: "mismatch",
      mismatch: {
        field: "pluginVersion",
        requested: "9.0.0",
        bundled: "0.1.0",
      },
    });
    expect(runtime.openPluginExample).not.toHaveBeenCalled();
  });

  it("opens the validated Camera quickstart through the generic host", async () => {
    const runtime = runtimeMock();
    const result = await openBundledApplicationDeepLink(
      runtime as unknown as RuntimeApi,
      CAMERA_REQUEST,
    );
    expect(result).toEqual({
      kind: "opened",
      pluginId: CAMERA_REQUEST.pluginId,
      recipeId: CAMERA_REQUEST.recipeId,
      example: CAMERA_EXAMPLE,
    });
    expect(runtime.openPluginExample).toHaveBeenCalledWith(
      CAMERA_REQUEST.pluginId,
      CAMERA_REQUEST.exampleId,
      true,
    );
    expect(runtime.runPluginRecipe).not.toHaveBeenCalled();
  });

  it("opens the generated Pulse demo without executing its recipe", async () => {
    const runtime = runtimeMock();
    const result = await openBundledApplicationDeepLink(
      runtime as unknown as RuntimeApi,
      PULSE_REQUEST,
    );
    expect(result).toEqual({
      kind: "opened",
      pluginId: PULSE_REQUEST.pluginId,
      recipeId: PULSE_REQUEST.recipeId,
      example: PULSE_EXAMPLE,
    });
    expect(runtime.runPluginRecipe).not.toHaveBeenCalled();
  });

  it("rejects a bundled application that is not verified", async () => {
    const runtime = runtimeMock();
    runtime.listPlugins.mockResolvedValue([
      bundledRecord(CAMERA_REQUEST, { trust: "unverified" }),
    ]);
    const result = await openBundledApplicationDeepLink(
      runtime as unknown as RuntimeApi,
      CAMERA_REQUEST,
    );
    expect(result).toEqual({
      kind: "unverified",
      pluginId: CAMERA_REQUEST.pluginId,
      status: "unverified",
    });
    expect(runtime.openPluginExample).not.toHaveBeenCalled();
  });

  it("never targets an identically named user wheel implicitly", async () => {
    const runtime = runtimeMock();
    runtime.listPlugins.mockResolvedValue([
      bundledRecord(CAMERA_REQUEST, { source: "user-wheel" }),
    ]);

    const result = await openBundledApplicationDeepLink(
      runtime as unknown as RuntimeApi,
      CAMERA_REQUEST,
    );

    expect(result).toEqual({
      kind: "unsupported",
      pluginId: CAMERA_REQUEST.pluginId,
    });
    expect(runtime.openPluginExample).not.toHaveBeenCalled();
  });
});
