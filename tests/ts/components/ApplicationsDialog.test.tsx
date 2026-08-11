import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationsDialog } from "../../../src/components/ApplicationsDialog";
import type {
  PluginRecord,
  PluginRecipeCommit,
  PluginRecipePreparation,
} from "../../../src/runtime/runtime";
import type { RuntimeApi } from "../../../src/runtime/RuntimeApi";

const runtimeMock = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  preparePluginRecipe: vi.fn(),
  runPluginRecipe: vi.fn(),
  openPluginExample: vi.fn(),
  resolvePluginRecipeChoices: vi.fn(),
  resolvePluginRecipeCallbacks: vi.fn(),
  resolvePluginRecipeActive: vi.fn(),
}));

vi.mock("../../../src/runtime/RuntimeContext", () => ({
  useRuntime: () => ({ runtime: runtimeMock as unknown as RuntimeApi }),
}));

const PLUGIN_ID = "org.example.camera";
const RECIPE_ID = `${PLUGIN_ID}:analyze`;

const APPLICATION: PluginRecord = {
  name: PLUGIN_ID,
  record_id: PLUGIN_ID,
  filename: "/plugins/camera.whl",
  module: "example.web",
  source: "bundled-wheel",
  artifact_id: `sha256:${"a".repeat(64)}`,
  artifact_filename: "camera-1.0.0-py3-none-any.whl",
  plugin_id: PLUGIN_ID,
  distribution: "camera",
  version: "1.0.0",
  sha256: "a".repeat(64),
  trust: "verified",
  entry_point: "example.web:CameraPlugin",
  enabled: true,
  loaded: true,
  error: null,
  info: {
    id: PLUGIN_ID,
    name: "Camera Application",
    version: "1.0.0",
    description: "Characterize a camera campaign.",
    icon: null,
    capabilities: ["application"],
    documentation_url: "https://example.org/camera",
  },
  recipes: [
    {
      id: RECIPE_ID,
      version: "1.0.0",
      title: "Camera analysis",
      description: "Analyze selected images.",
      inputs: [
        {
          id: "images",
          object_type: "image",
          cardinality: "many",
          required: true,
        },
      ],
      has_params: false,
    },
  ],
  examples: [
    {
      id: "quickstart",
      title: "Camera quickstart",
      description: "Open a prepared campaign.",
      recipe_id: RECIPE_ID,
      expected_checks: [],
    },
  ],
  operations: {
    can_enable: true,
    can_disable: true,
    can_remove: false,
    can_reload: true,
  },
};

const PREPARATION: PluginRecipePreparation = {
  plugin_id: PLUGIN_ID,
  recipe_id: RECIPE_ID,
  title: "Camera analysis",
  description: "Analyze selected images.",
  slots: [
    {
      id: "images",
      object_type: "image",
      cardinality: "many",
      required: true,
    },
  ],
  candidates: [
    {
      id: "image-1",
      kind: "image",
      title: "Frame 1",
      compatible_slots: ["images"],
    },
  ],
  bindings: { images: ["image-1"] },
  ambiguous_slots: [],
  missing_slots: [],
  parameters: null,
};

const COMMIT: PluginRecipeCommit = {
  plugin_id: PLUGIN_ID,
  recipe_id: RECIPE_ID,
  run_id: "run-1",
  objects: [
    {
      output_id: "response",
      id: "signal-1",
      kind: "signal",
      title: "Response",
    },
  ],
  results: [],
  diagnostics: [
    {
      level: "warning",
      code: "low_snr",
      message: "Shot 1 has low SNR",
      details: { shot: 1 },
    },
    {
      level: "warning",
      code: "low_snr",
      message: "Shot 2 has low SNR",
      details: { shot: 2 },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  runtimeMock.listPlugins.mockResolvedValue([APPLICATION]);
  runtimeMock.preparePluginRecipe.mockResolvedValue(PREPARATION);
  runtimeMock.runPluginRecipe.mockResolvedValue(COMMIT);
  runtimeMock.openPluginExample.mockResolvedValue({
    signals: 0,
    images: 1,
    groups: 1,
    plugin_id: PLUGIN_ID,
    example_id: "quickstart",
    recipe_id: RECIPE_ID,
    filename: "quickstart.h5",
    panel: "image",
    selected_ids: ["image-1"],
    current_id: "image-1",
    dirty: false,
    parameter_values: {},
  });
});

describe("ApplicationsDialog", () => {
  it("reuses the launcher icon in the window header", async () => {
    render(
      <ApplicationsDialog
        candidateIds={[]}
        confirmOpenExample={() => true}
        onCommitted={() => {}}
        onExampleOpened={() => {}}
        onClose={() => {}}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Applications" });
    const icon = dialog.querySelector(".applications-header-icon");
    expect(icon).toHaveAttribute("src", expect.stringContaining("data:image"));
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByRole("heading", { name: "Applications" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Camera Application" }),
    ).toBeInTheDocument();
  });

  it("prepares and runs an unambiguous recipe from the current selection", async () => {
    const onCommitted = vi.fn();
    render(
      <ApplicationsDialog
        candidateIds={["image-1"]}
        confirmOpenExample={() => true}
        onCommitted={onCommitted}
        onExampleOpened={() => {}}
        onClose={() => {}}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Camera Application" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start analysis…" }));

    await waitFor(() => {
      expect(runtimeMock.preparePluginRecipe).toHaveBeenCalledWith(
        PLUGIN_ID,
        RECIPE_ID,
        ["image-1"],
      );
      expect(runtimeMock.runPluginRecipe).toHaveBeenCalledWith(
        PLUGIN_ID,
        RECIPE_ID,
        { images: ["image-1"] },
        {},
      );
      expect(onCommitted).toHaveBeenCalledWith(COMMIT);
    });
    expect(screen.getByText("Created 1 objects")).toBeInTheDocument();
    expect(screen.getAllByText(/has low SNR/)).toHaveLength(2);
  });

  it("opens a packaged example only after caller confirmation", async () => {
    const confirmOpenExample = vi.fn().mockResolvedValue(true);
    const onExampleOpened = vi.fn();
    render(
      <ApplicationsDialog
        candidateIds={[]}
        confirmOpenExample={confirmOpenExample}
        onCommitted={() => {}}
        onExampleOpened={onExampleOpened}
        onClose={() => {}}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Open example" }),
    );

    await waitFor(() => {
      expect(confirmOpenExample).toHaveBeenCalledOnce();
      expect(runtimeMock.openPluginExample).toHaveBeenCalledWith(
        PLUGIN_ID,
        "quickstart",
        true,
      );
      expect(onExampleOpened).toHaveBeenCalledOnce();
    });
    expect(screen.getByText("Example opened")).toBeInTheDocument();
  });

  it("prefills recipe parameters returned by a generated example", async () => {
    runtimeMock.openPluginExample.mockResolvedValueOnce({
      signals: 0,
      images: 1,
      groups: 1,
      plugin_id: PLUGIN_ID,
      example_id: "quickstart",
      recipe_id: RECIPE_ID,
      filename: null,
      panel: "image",
      selected_ids: ["image-1"],
      current_id: "image-1",
      dirty: true,
      parameter_values: { gain: 4 },
    });
    runtimeMock.preparePluginRecipe.mockResolvedValueOnce({
      ...PREPARATION,
      parameters: {
        schema: {
          type: "object",
          properties: {
            gain: {
              type: "number",
              "x-guidata-kind": "float",
              "x-guidata-label": "Gain",
              "x-guidata-name": "gain",
            },
          },
          "x-guidata-property-order": ["gain"],
        },
        values: { gain: 2 },
      },
    });
    render(
      <ApplicationsDialog
        candidateIds={["image-1"]}
        confirmOpenExample={() => true}
        onCommitted={() => {}}
        onExampleOpened={() => {}}
        onClose={() => {}}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Open example" }),
    );
    await screen.findByText("Example opened");
    fireEvent.click(screen.getByRole("button", { name: "Start analysis…" }));

    expect(await screen.findByDisplayValue("4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => {
      expect(runtimeMock.runPluginRecipe).toHaveBeenCalledWith(
        PLUGIN_ID,
        RECIPE_ID,
        { images: ["image-1"] },
        { gain: 4 },
      );
    });
  });

  it("keeps generated example inputs independent from visual selection", async () => {
    runtimeMock.openPluginExample.mockResolvedValueOnce({
      signals: 3,
      images: 0,
      groups: 1,
      plugin_id: PLUGIN_ID,
      example_id: "quickstart",
      recipe_id: RECIPE_ID,
      filename: null,
      panel: "signal",
      selected_ids: ["signal-1", "signal-2", "signal-3"],
      current_id: "signal-1",
      dirty: true,
      parameter_values: {},
    });
    render(
      <ApplicationsDialog
        candidateIds={["signal-1"]}
        confirmOpenExample={() => true}
        onCommitted={() => {}}
        onExampleOpened={() => {}}
        onClose={() => {}}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Open example" }),
    );
    await screen.findByText("Example opened");
    fireEvent.click(screen.getByRole("button", { name: "Start analysis…" }));

    await waitFor(() => {
      expect(runtimeMock.preparePluginRecipe).toHaveBeenCalledWith(
        PLUGIN_ID,
        RECIPE_ID,
        ["signal-1", "signal-2", "signal-3"],
      );
    });
  });

  it("focuses a deep-linked recipe without running it", async () => {
    runtimeMock.preparePluginRecipe.mockResolvedValueOnce({
      ...PREPARATION,
      parameters: {
        schema: {
          type: "object",
          properties: {
            gain: {
              type: "number",
              "x-guidata-kind": "float",
              "x-guidata-label": "Gain",
              "x-guidata-name": "gain",
            },
          },
          "x-guidata-property-order": ["gain"],
        },
        values: { gain: 2 },
      },
    });
    const { container } = render(
      <ApplicationsDialog
        candidateIds={["image-1"]}
        initialTarget={{
          pluginId: PLUGIN_ID,
          recipeId: RECIPE_ID,
          parameterValues: { gain: 4 },
        }}
        confirmOpenExample={() => true}
        onCommitted={() => {}}
        onExampleOpened={() => {}}
        onClose={() => {}}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Camera Application" }),
    ).toBeInTheDocument();
    expect(
      container.querySelector(`[data-recipe-id="${RECIPE_ID}"]`),
    ).toHaveClass("focused");
    expect(runtimeMock.preparePluginRecipe).not.toHaveBeenCalled();
    expect(runtimeMock.runPluginRecipe).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start analysis…" }));

    expect(await screen.findByDisplayValue("4")).toBeInTheDocument();
    expect(runtimeMock.runPluginRecipe).not.toHaveBeenCalled();
  });
});
