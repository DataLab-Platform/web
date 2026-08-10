import type {
  CameraWebManifest,
  PanelKind,
  RuntimeApi,
} from "../runtime/runtime";
import {
  validateApplicationDeepLink,
  type ApplicationDeepLinkMismatch,
  type ApplicationDeepLinkRequest,
  type BundledApplicationManifest,
} from "../utils/applicationDeepLink";

export type ApplicationDeepLinkOpenResult =
  | { kind: "unsupported"; pluginId: string }
  | { kind: "unverified"; pluginId: string; status: string }
  | { kind: "mismatch"; mismatch: ApplicationDeepLinkMismatch }
  | {
      kind: "opened";
      panel: PanelKind;
      preferredObjectId: string | null;
      filename: string | null;
      clean: boolean;
    };

type BundledWebManifest = BundledApplicationManifest & {
  web_status: string;
};

interface BundledApplicationEntry {
  exampleId: string;
  getManifest: (runtime: RuntimeApi) => Promise<BundledWebManifest>;
  openExample: (runtime: RuntimeApi) => Promise<{
    panel: PanelKind;
    preferredObjectId: string | null;
    clean: boolean;
  }>;
  workspaceFilename: (manifest: BundledWebManifest) => string | null;
}

const CAMERA_PLUGIN_ID = "org.datalab.camera-characterization";
const PULSE_PLUGIN_ID = "org.datalab.pulse-characterization";

const CAMERA_APPLICATION: BundledApplicationEntry = {
  exampleId: "quickstart",
  getManifest: (runtime) => runtime.getBundledCameraManifest(),
  openExample: async (runtime) => {
    await runtime.openBundledCameraQuickstart(true);
    const images = await runtime.listImages();
    return {
      panel: "image",
      preferredObjectId: images[0]?.id ?? null,
      clean: true,
    };
  },
  workspaceFilename: (manifest) =>
    (manifest as CameraWebManifest).quickstart_filename,
};

const PULSE_APPLICATION: BundledApplicationEntry = {
  exampleId: "demo",
  getManifest: (runtime) => runtime.getBundledPulseManifest(),
  openExample: async (runtime) => {
    await runtime.resetAll();
    const demo = await runtime.createBundledPulseDemo();
    return {
      panel: "signal",
      preferredObjectId: demo.signal_ids[0] ?? null,
      clean: false,
    };
  },
  workspaceFilename: () => null,
};

const BUNDLED_APPLICATIONS: Record<string, BundledApplicationEntry> = {
  [CAMERA_PLUGIN_ID]: CAMERA_APPLICATION,
  [PULSE_PLUGIN_ID]: PULSE_APPLICATION,
};

/** Validate and open one application example already bundled in DataLab-Web. */
export async function openBundledApplicationDeepLink(
  runtime: RuntimeApi,
  request: ApplicationDeepLinkRequest,
): Promise<ApplicationDeepLinkOpenResult> {
  const application = BUNDLED_APPLICATIONS[request.pluginId];
  if (!application) return { kind: "unsupported", pluginId: request.pluginId };

  const manifest = await application.getManifest(runtime);
  const mismatch = validateApplicationDeepLink(
    request,
    manifest,
    application.exampleId,
  );
  if (mismatch) return { kind: "mismatch", mismatch };
  if (manifest.web_status !== "verified") {
    return {
      kind: "unverified",
      pluginId: request.pluginId,
      status: manifest.web_status,
    };
  }
  const opened = await application.openExample(runtime);
  return {
    kind: "opened",
    ...opened,
    filename: application.workspaceFilename(manifest),
  };
}
