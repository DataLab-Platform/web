import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PluginManagerDialog } from "../../../src/components/PluginManagerDialog";
import type {
  PluginRecord,
  PluginWheelInspection,
} from "../../../src/runtime/runtime";
import type { RuntimeApi } from "../../../src/runtime/RuntimeApi";
import {
  isPluginHashTrusted,
  trustPluginHash,
} from "../../../src/plugins/trustStore";

const runtimeMock = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  inspectPluginWheel: vi.fn(),
  installPluginWheel: vi.fn(),
  setPluginEnabled: vi.fn(),
  removeUserPluginWheel: vi.fn(),
  unloadPlugin: vi.fn(),
  reloadPlugins: vi.fn(),
  loadPluginSource: vi.fn(),
}));

vi.mock("../../../src/runtime/RuntimeContext", () => ({
  useRuntime: () => ({ runtime: runtimeMock as unknown as RuntimeApi }),
}));

vi.mock("../../../src/storage/pluginWheelStore", () => ({
  PluginWheelStore: { isSupported: () => true },
}));

const BUNDLED_RECORD: PluginRecord = {
  name: "org.example.camera",
  record_id: "org.example.camera",
  filename: "/home/pyodide/plugin-wheels/abc.whl",
  module: "example.web",
  source: "bundled-wheel",
  artifact_id: `sha256:${"a".repeat(64)}`,
  artifact_filename: "example_camera-1.0.0-py3-none-any.whl",
  plugin_id: "org.example.camera",
  distribution: "example-camera",
  version: "1.0.0",
  sha256: "a".repeat(64),
  trust: "verified",
  entry_point: "example.web:CameraPlugin",
  enabled: true,
  loaded: true,
  error: null,
  info: {
    id: "org.example.camera",
    name: "Camera Application",
    version: "1.0.0",
    description: "Camera workflow",
    icon: null,
    capabilities: ["application"],
    documentation_url: "https://example.org/camera",
  },
  recipes: [],
  examples: [],
  operations: {
    can_enable: true,
    can_disable: true,
    can_remove: false,
    can_reload: true,
  },
};

const USER_RECORD: PluginRecord = {
  ...BUNDLED_RECORD,
  name: "org.example.local",
  record_id: "org.example.local",
  filename: "/home/pyodide/plugin-wheels/user-b.whl",
  source: "user-wheel",
  artifact_id: `sha256:${"b".repeat(64)}`,
  artifact_filename: "local_plugin-1.0.0-py3-none-any.whl",
  plugin_id: "org.example.local",
  distribution: "local-plugin",
  sha256: "b".repeat(64),
  trust: "unverified",
  info: {
    ...BUNDLED_RECORD.info!,
    id: "org.example.local",
    name: "Local Plugin",
  },
  operations: {
    ...BUNDLED_RECORD.operations,
    can_remove: true,
  },
};

const INSPECTION: PluginWheelInspection = {
  filename: "local_plugin-1.0.0-py3-none-any.whl",
  distribution: "local-plugin",
  version: "1.0.0",
  sha256: "b".repeat(64),
  size_bytes: 4,
  requires_python: ">=3.11",
  tags: ["py3-none-any"],
  entry_points: [
    {
      name: "local",
      module: "local_plugin.web",
      attribute: "LocalPlugin",
    },
  ],
  top_level_packages: ["local_plugin"],
  dependencies: [
    {
      requirement: "sigima>=1.1",
      applies: true,
      installed_version: "1.2.0",
      compatible: true,
    },
  ],
};

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  runtimeMock.listPlugins.mockResolvedValue([BUNDLED_RECORD]);
  runtimeMock.inspectPluginWheel.mockResolvedValue(INSPECTION);
  runtimeMock.installPluginWheel.mockResolvedValue([]);
  runtimeMock.setPluginEnabled.mockResolvedValue({
    ...BUNDLED_RECORD,
    enabled: false,
    loaded: false,
  });
});

describe("PluginManagerDialog", () => {
  it("shows bundled provenance and disables without offering removal", async () => {
    render(<PluginManagerDialog onClose={() => {}} />);

    expect(await screen.findByText("Camera Application")).toBeInTheDocument();
    expect(screen.getByText("Bundled wheel")).toBeInTheDocument();
    expect(screen.getByText("verified")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() => {
      expect(runtimeMock.setPluginEnabled).toHaveBeenCalledWith(
        "org.example.camera",
        false,
      );
    });
  });

  it("inspects a local wheel and waits for consent before installing", async () => {
    runtimeMock.inspectPluginWheel.mockImplementationOnce(
      async (_filename: string, bytes: Uint8Array) => {
        bytes[0] = 0;
        return INSPECTION;
      },
    );
    render(<PluginManagerDialog onClose={() => {}} />);
    await screen.findByText("Camera Application");
    const file = new File(
      [new Uint8Array([80, 75, 3, 4])],
      INSPECTION.filename,
    );
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([80, 75, 3, 4]).buffer,
    });
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".whl"]',
    );
    expect(input).not.toBeNull();

    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    expect(
      await screen.findByText("Install plugin wheel?"),
    ).toBeInTheDocument();
    expect(screen.getByText("local-plugin 1.0.0")).toBeInTheDocument();
    expect(
      screen.getByText(/local_plugin\.web:LocalPlugin/),
    ).toBeInTheDocument();
    expect(screen.getByText("sigima>=1.1")).toBeInTheDocument();
    expect(runtimeMock.installPluginWheel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Trust & install" }));

    await waitFor(() => {
      expect(runtimeMock.installPluginWheel).toHaveBeenCalledTimes(1);
    });
    const [filename, bytes] = runtimeMock.installPluginWheel.mock.calls[0];
    expect(filename).toBe(INSPECTION.filename);
    expect(Array.from(bytes as Uint8Array)).toEqual([80, 75, 3, 4]);
  });

  it("revokes binary trust only after removing a user wheel", async () => {
    runtimeMock.listPlugins
      .mockResolvedValueOnce([USER_RECORD])
      .mockResolvedValueOnce([]);
    runtimeMock.removeUserPluginWheel.mockResolvedValue(undefined);
    trustPluginHash(USER_RECORD.artifact_filename!, USER_RECORD.sha256!);
    render(<PluginManagerDialog onClose={() => {}} />);

    const row = (await screen.findByText("Local Plugin")).closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(
      row!.querySelector<HTMLButtonElement>("button:nth-of-type(2)")!,
    );

    await waitFor(() => {
      expect(runtimeMock.removeUserPluginWheel).toHaveBeenCalledWith(
        USER_RECORD.artifact_id,
      );
      expect(
        isPluginHashTrusted(
          USER_RECORD.artifact_filename!,
          USER_RECORD.sha256!,
        ),
      ).toBe(false);
    });
  });
});
