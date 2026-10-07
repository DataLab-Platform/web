import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationsDialog } from "../../../src/components/ApplicationsDialog";
import type {
  PluginExampleOpenResult,
  PluginRecord,
  PluginRecipeCommit,
  PluginRecipePreparation,
  PluginRecipeReadiness,
} from "../../../src/runtime/runtime";
import type { RuntimeApi } from "../../../src/runtime/RuntimeApi";

const runtimeMock = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  assessPluginRecipes: vi.fn(),
  checkPluginRecipeBindings: vi.fn(),
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
const SECOND_RECIPE_ID = `${PLUGIN_ID}:dark-current`;

const FRAMES_SLOT = {
  id: "frames",
  title: "Frames",
  description: "Frames of the exposure ladder.",
  object_type: "image" as const,
  cardinality: "many" as const,
  required: true,
  min_count: 2,
  metadata: [
    {
      key: "exposure_time",
      description: "Exposure time in seconds",
      required: true,
    },
  ],
};

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
      inputs: [FRAMES_SLOT],
      has_params: false,
    },
  ],
  examples: [
    {
      id: "quickstart",
      title: "Camera quickstart",
      description: "Open a prepared campaign.",
      recipe_ids: [RECIPE_ID],
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

const READY: PluginRecipeReadiness = {
  status: "ready",
  bindings: { frames: ["image-1", "image-2"] },
  issues: [],
  diagnostics: [],
};

const PREPARATION: PluginRecipePreparation = {
  plugin_id: PLUGIN_ID,
  recipe_id: RECIPE_ID,
  title: "Camera analysis",
  description: "Analyze selected images.",
  slots: [FRAMES_SLOT],
  candidates: [
    {
      id: "image-1",
      kind: "image",
      title: "Frame 1",
      compatible_slots: ["frames"],
      missing_metadata: { frames: [] },
    },
    {
      id: "image-2",
      kind: "image",
      title: "Frame 2",
      compatible_slots: ["frames"],
      missing_metadata: { frames: [] },
    },
  ],
  bindings: { frames: ["image-1", "image-2"] },
  ambiguous_slots: [],
  missing_slots: [],
  readiness: READY,
  parameters: null,
};

const GAIN_PARAMETERS: NonNullable<PluginRecipePreparation["parameters"]> = {
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
};

const OPENED: PluginExampleOpenResult = {
  signals: 0,
  images: 2,
  groups: 1,
  plugin_id: PLUGIN_ID,
  example_id: "quickstart",
  recipe_id: RECIPE_ID,
  recipe_ids: [RECIPE_ID],
  filename: "quickstart.h5",
  panel: "image",
  selected_ids: ["image-1", "image-2"],
  current_id: "image-1",
  dirty: false,
  parameter_values: {},
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

function renderDialog(
  props: Partial<Parameters<typeof ApplicationsDialog>[0]> = {},
) {
  return render(
    <ApplicationsDialog
      candidateIds={["image-1", "image-2"]}
      confirmOpenExample={() => true}
      onCommitted={() => {}}
      onExampleOpened={() => {}}
      onClose={() => {}}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  runtimeMock.listPlugins.mockResolvedValue([APPLICATION]);
  runtimeMock.assessPluginRecipes.mockResolvedValue({ [RECIPE_ID]: READY });
  runtimeMock.preparePluginRecipe.mockResolvedValue(PREPARATION);
  runtimeMock.runPluginRecipe.mockResolvedValue(COMMIT);
  runtimeMock.openPluginExample.mockResolvedValue(OPENED);
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

  it("describes the expected inputs and the live readiness of each method", async () => {
    const { container } = renderDialog();

    expect(await screen.findByText("Expected inputs")).toBeInTheDocument();
    expect(screen.getByText("Frames")).toBeInTheDocument();
    expect(screen.getByText("At least 2 images")).toBeInTheDocument();
    expect(
      screen.getByText("Frames of the exposure ladder."),
    ).toBeInTheDocument();
    expect(screen.getByText("exposure_time")).toBeInTheDocument();
    expect(
      await screen.findByText("Ready to run on the current selection"),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        `[data-recipe-id="${RECIPE_ID}"] [data-readiness]`,
      ),
    ).toHaveAttribute("data-readiness", "ready");
    expect(runtimeMock.assessPluginRecipes).toHaveBeenCalledWith(
      PLUGIN_ID,
      ["image-1", "image-2"],
      { [RECIPE_ID]: {} },
    );
  });

  it("re-assesses the methods when the selection changes", async () => {
    const { rerender } = renderDialog();
    await screen.findByText("Ready to run on the current selection");

    runtimeMock.assessPluginRecipes.mockResolvedValueOnce({
      [RECIPE_ID]: {
        status: "not_ready",
        bindings: { frames: ["image-3"] },
        issues: [
          {
            code: "too_few",
            slot_id: "frames",
            details: { count: 1, min_count: 2 },
          },
        ],
        diagnostics: [],
      },
    });
    rerender(
      <ApplicationsDialog
        candidateIds={["image-3"]}
        confirmOpenExample={() => true}
        onCommitted={() => {}}
        onExampleOpened={() => {}}
        onClose={() => {}}
      />,
    );

    expect(
      await screen.findByText("The current selection cannot be analyzed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Frames: 1 object(s) assigned, at least 2 required"),
    ).toBeInTheDocument();
    expect(runtimeMock.assessPluginRecipes).toHaveBeenLastCalledWith(
      PLUGIN_ID,
      ["image-3"],
      { [RECIPE_ID]: {} },
    );
  });

  it("runs a ready method directly on the current selection", async () => {
    const onCommitted = vi.fn();
    renderDialog({ onCommitted });

    fireEvent.click(
      await screen.findByRole("button", { name: "Run on selection…" }),
    );

    await waitFor(() => {
      expect(runtimeMock.preparePluginRecipe).toHaveBeenCalledWith(
        PLUGIN_ID,
        RECIPE_ID,
        ["image-1", "image-2"],
        {},
      );
      expect(runtimeMock.runPluginRecipe).toHaveBeenCalledWith(
        PLUGIN_ID,
        RECIPE_ID,
        { frames: ["image-1", "image-2"] },
        {},
      );
      expect(onCommitted).toHaveBeenCalledWith(COMMIT);
    });
    expect(screen.getByText("Created 1 objects")).toBeInTheDocument();
    expect(screen.getAllByText(/has low SNR/)).toHaveLength(2);
  });

  it("asks for the inputs when the selection is not ready", async () => {
    runtimeMock.preparePluginRecipe.mockResolvedValueOnce({
      ...PREPARATION,
      readiness: {
        status: "not_ready",
        bindings: { frames: ["image-1"] },
        issues: [
          {
            code: "missing_metadata",
            slot_id: "frames",
            details: { key: "exposure_time", count: 1, titles: ["Frame 1"] },
          },
        ],
        diagnostics: [],
      },
    });
    renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: "Run on selection…" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Inputs of 'Camera analysis'",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Frames: metadata 'exposure_time' missing on 1 object(s) (Frame 1)",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(runtimeMock.runPluginRecipe).not.toHaveBeenCalled();
  });

  it("tries an example: opens it, prefills the parameters and runs", async () => {
    const confirmOpenExample = vi.fn().mockResolvedValue(true);
    const onExampleOpened = vi.fn();
    runtimeMock.openPluginExample.mockResolvedValueOnce({
      ...OPENED,
      parameter_values: { [RECIPE_ID]: { gain: 4 } },
    });
    runtimeMock.preparePluginRecipe.mockResolvedValueOnce({
      ...PREPARATION,
      parameters: GAIN_PARAMETERS,
    });
    renderDialog({ candidateIds: [], confirmOpenExample, onExampleOpened });

    fireEvent.click(
      await screen.findByRole("button", { name: "Try with this example" }),
    );

    expect(await screen.findByDisplayValue("4")).toBeInTheDocument();
    expect(confirmOpenExample).toHaveBeenCalledOnce();
    expect(runtimeMock.openPluginExample).toHaveBeenCalledWith(
      PLUGIN_ID,
      "quickstart",
      true,
      RECIPE_ID,
    );
    expect(onExampleOpened).toHaveBeenCalledOnce();
    expect(runtimeMock.preparePluginRecipe).toHaveBeenCalledWith(
      PLUGIN_ID,
      RECIPE_ID,
      ["image-1", "image-2"],
      { gain: 4 },
    );
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => {
      expect(runtimeMock.runPluginRecipe).toHaveBeenCalledWith(
        PLUGIN_ID,
        RECIPE_ID,
        { frames: ["image-1", "image-2"] },
        { gain: 4 },
      );
    });
  });

  it("does not open an example the user declined to load", async () => {
    renderDialog({ confirmOpenExample: () => false });

    fireEvent.click(
      await screen.findByRole("button", { name: "Try with this example" }),
    );

    await waitFor(() => {
      expect(runtimeMock.openPluginExample).not.toHaveBeenCalled();
      expect(runtimeMock.preparePluginRecipe).not.toHaveBeenCalled();
    });
  });

  it("offers a shared example under each method it is designed for", async () => {
    runtimeMock.listPlugins.mockResolvedValueOnce([
      {
        ...APPLICATION,
        recipes: [
          ...APPLICATION.recipes,
          {
            ...APPLICATION.recipes[0],
            id: SECOND_RECIPE_ID,
            title: "Dark current",
          },
        ],
        examples: [
          {
            ...APPLICATION.examples[0],
            recipe_ids: [RECIPE_ID, SECOND_RECIPE_ID],
          },
        ],
      },
    ]);
    const { container } = renderDialog();

    expect(await screen.findByText("Dark current")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Run on selection…" }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Try with this example" }),
    ).toHaveLength(2);

    const darkRecipe = container.querySelector(
      `[data-recipe-id="${SECOND_RECIPE_ID}"]`,
    );
    fireEvent.click(
      darkRecipe!.querySelector('[data-example-id="quickstart"] button')!,
    );
    await waitFor(() => {
      expect(runtimeMock.openPluginExample).toHaveBeenCalledWith(
        PLUGIN_ID,
        "quickstart",
        true,
        SECOND_RECIPE_ID,
      );
      expect(runtimeMock.preparePluginRecipe).toHaveBeenCalledWith(
        PLUGIN_ID,
        SECOND_RECIPE_ID,
        ["image-1", "image-2"],
        {},
      );
    });
  });

  it("lists examples without a method as datasets", async () => {
    runtimeMock.listPlugins.mockResolvedValueOnce([
      {
        ...APPLICATION,
        examples: [
          ...APPLICATION.examples,
          {
            id: "raw",
            title: "Raw frames",
            description: "Frames without exposure metadata.",
            recipe_ids: [],
            expected_checks: [],
          },
        ],
      },
    ]);
    const { container } = renderDialog();

    expect(await screen.findByText("Datasets")).toBeInTheDocument();
    const dataset = container.querySelector('[data-example-id="raw"]');
    expect(dataset?.closest("[data-recipe-id]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open dataset" }));

    await waitFor(() => {
      expect(runtimeMock.openPluginExample).toHaveBeenCalledWith(
        PLUGIN_ID,
        "raw",
        true,
        null,
      );
    });
    expect(await screen.findByText("Example opened")).toBeInTheDocument();
    expect(runtimeMock.preparePluginRecipe).not.toHaveBeenCalled();
  });

  it("applies example values only while the candidates come from the example", async () => {
    const exampleContext = {
      pluginId: PLUGIN_ID,
      objectIds: ["signal-1", "signal-2", "signal-3"],
      visibleIds: ["signal-1"],
      parameterValues: { [RECIPE_ID]: { gain: 4 } },
    };
    const { unmount } = renderDialog({
      candidateIds: ["signal-1", "signal-2", "signal-3"],
      exampleContext,
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Run on selection…" }),
    );
    await waitFor(() => {
      expect(runtimeMock.preparePluginRecipe).toHaveBeenCalledWith(
        PLUGIN_ID,
        RECIPE_ID,
        ["signal-1", "signal-2", "signal-3"],
        { gain: 4 },
      );
    });
    unmount();

    renderDialog({ candidateIds: ["signal-1", "other"], exampleContext });
    fireEvent.click(
      await screen.findByRole("button", { name: "Run on selection…" }),
    );
    await waitFor(() => {
      expect(runtimeMock.preparePluginRecipe).toHaveBeenLastCalledWith(
        PLUGIN_ID,
        RECIPE_ID,
        ["signal-1", "other"],
        {},
      );
    });
  });

  it("focuses a deep-linked method without running it", async () => {
    const { container } = renderDialog({
      initialTarget: { pluginId: PLUGIN_ID, recipeId: RECIPE_ID },
    });

    expect(
      await screen.findByRole("heading", { name: "Camera Application" }),
    ).toBeInTheDocument();
    expect(
      container.querySelector(`[data-recipe-id="${RECIPE_ID}"]`),
    ).toHaveClass("focused");
    expect(runtimeMock.preparePluginRecipe).not.toHaveBeenCalled();
    expect(runtimeMock.runPluginRecipe).not.toHaveBeenCalled();
  });
});
