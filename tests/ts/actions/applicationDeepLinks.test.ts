import { describe, expect, it, vi } from "vitest";

import { openBundledApplicationDeepLink } from "../../../src/actions/applicationDeepLinks";
import type {
  CameraWebManifest,
  PulseWebManifest,
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

const CAMERA_MANIFEST: CameraWebManifest = {
  plugin_id: CAMERA_REQUEST.pluginId,
  plugin_version: CAMERA_REQUEST.pluginVersion,
  web_status: "verified",
  datalab_web_version: "0.8.0",
  pyodide_version: "0.26.4",
  recipe_id: CAMERA_REQUEST.recipeId,
  recipe_version: CAMERA_REQUEST.recipeVersion,
  quickstart_filename: "camera_quickstart.h5",
};

const PULSE_REQUEST: ApplicationDeepLinkRequest = {
  pluginId: "org.datalab.pulse-characterization",
  pluginVersion: "0.1.0",
  recipeId: "org.datalab.pulse-characterization:single-channel-campaign",
  recipeVersion: "1.1.0",
  exampleId: "demo",
};

const PULSE_MANIFEST: PulseWebManifest = {
  plugin_id: PULSE_REQUEST.pluginId,
  plugin_version: PULSE_REQUEST.pluginVersion,
  web_status: "verified",
  datalab_web_version: "0.8.0",
  pyodide_version: "0.26.4",
  recipe_id: PULSE_REQUEST.recipeId,
  recipe_version: PULSE_REQUEST.recipeVersion,
};

function runtimeMock() {
  return {
    getBundledCameraManifest: vi.fn(async () => CAMERA_MANIFEST),
    openBundledCameraQuickstart: vi.fn(async () => ({
      signals: 0,
      images: 6,
      groups: 1,
    })),
    listImages: vi.fn(async () => [
      { id: "camera-image", title: "Dark frame" },
    ]),
    getBundledPulseManifest: vi.fn(async () => PULSE_MANIFEST),
    resetAll: vi.fn(async () => undefined),
    createBundledPulseDemo: vi.fn(async () => ({
      signal_ids: ["pulse-1", "pulse-2"],
      signal_count: 2,
      parameter_values: {},
    })),
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
    expect(runtime.getBundledCameraManifest).not.toHaveBeenCalled();
    expect(runtime.openBundledCameraQuickstart).not.toHaveBeenCalled();
    expect(runtime.resetAll).not.toHaveBeenCalled();
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
    expect(runtime.openBundledCameraQuickstart).not.toHaveBeenCalled();
  });

  it("opens the validated Camera quickstart", async () => {
    const runtime = runtimeMock();
    const result = await openBundledApplicationDeepLink(
      runtime as unknown as RuntimeApi,
      CAMERA_REQUEST,
    );
    expect(result).toEqual({
      kind: "opened",
      panel: "image",
      preferredObjectId: "camera-image",
      filename: "camera_quickstart.h5",
      clean: true,
    });
    expect(runtime.openBundledCameraQuickstart).toHaveBeenCalledWith(true);
  });

  it("replaces the workspace before creating the validated Pulse demo", async () => {
    const runtime = runtimeMock();
    const result = await openBundledApplicationDeepLink(
      runtime as unknown as RuntimeApi,
      PULSE_REQUEST,
    );
    expect(result).toEqual({
      kind: "opened",
      panel: "signal",
      preferredObjectId: "pulse-1",
      filename: null,
      clean: false,
    });
    expect(runtime.resetAll.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.createBundledPulseDemo.mock.invocationCallOrder[0],
    );
  });

  it("rejects a bundled application that is not verified", async () => {
    const runtime = runtimeMock();
    runtime.getBundledCameraManifest.mockResolvedValue({
      ...CAMERA_MANIFEST,
      web_status: "untested",
    });
    const result = await openBundledApplicationDeepLink(
      runtime as unknown as RuntimeApi,
      CAMERA_REQUEST,
    );
    expect(result).toEqual({
      kind: "unverified",
      pluginId: CAMERA_REQUEST.pluginId,
      status: "untested",
    });
    expect(runtime.openBundledCameraQuickstart).not.toHaveBeenCalled();
  });
});
