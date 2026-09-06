import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProfileDefinitionDialog } from "../../../src/components/ProfileDefinitionDialog";
import type {
  FeatureDescriptor,
  ImageData,
  ProcessingPreviewResult,
  RuntimeApi,
} from "../../../src/runtime/runtime";
import { ThemeProvider } from "../../../src/utils/theme";

vi.mock("react-plotly.js", () => ({
  default: () => <div data-testid="profile-plot" />,
}));

const feature: FeatureDescriptor = {
  id: "image:line_profile",
  label: "Line profile…",
  menu_path: "Operations/Profiles/Line profile",
  pattern: "1_to_1",
  icon: null,
  has_params: true,
  operand_label: "Operand",
  object_kind: "image",
  output_kind: "signal",
  preview_enabled: true,
};

const imageData: ImageData = {
  id: "image-1",
  title: "Image",
  width: 2,
  height: 2,
  data: [
    [0, 1],
    [2, 3],
  ],
  dtype: "float64",
  x0: 0,
  y0: 0,
  dx: 1,
  dy: 1,
  data_min: 0,
  data_max: 3,
  xlabel: "x",
  ylabel: "y",
  zlabel: "z",
  xunit: "",
  yunit: "",
  zunit: "",
};

const profileResult: ProcessingPreviewResult = {
  kind: "signal",
  data: {
    id: "preview",
    uuid: null,
    title: "profile",
    size: 2,
    xlabel: "x",
    ylabel: "y",
    xunit: "px",
    yunit: "",
    x: new Float64Array([0, 1]),
    y: new Float64Array([2, 3]),
  },
};

function makeRuntime() {
  const previewFeature = vi.fn(async () => profileResult);
  return {
    runtime: {
      previewFeature,
      getImagesData: vi.fn(async () => [imageData]),
      onWorkspaceMutation: vi.fn(() => () => undefined),
      getObject: vi.fn(async () => ({
        id: "image-1",
        kind: "image",
        title: "Image",
      })),
    } as unknown as RuntimeApi,
    previewFeature,
  };
}

function renderDialog(
  runtime: RuntimeApi,
  onCancel: () => void,
  previewAvailable = true,
) {
  return render(
    <ThemeProvider>
      <ProfileDefinitionDialog
        title="Line profile"
        featureId="line_profile"
        feature={feature}
        runtime={runtime}
        previewAvailable={previewAvailable}
        sourceIds={["image-1"]}
        payload={{
          schema: {
            type: "object",
            required: ["row"],
            properties: {
              row: {
                type: "integer",
                minimum: 0,
                maximum: 1,
                "x-guidata-kind": "int",
                "x-guidata-label": "Row",
              },
            },
          },
          values: { row: 0, direction: "horizontal" },
        }}
        imageData={imageData}
        onSubmit={() => undefined}
        onCancel={onCancel}
      />
    </ThemeProvider>,
  );
}

describe("ProfileDefinitionDialog", () => {
  it("keeps geometry editing while previewing on the shared runtime", async () => {
    const { runtime, previewFeature } = makeRuntime();
    const onCancel = vi.fn();
    renderDialog(runtime, onCancel);

    expect(
      screen.getByRole("heading", { name: "Profile definition" }),
    ).toBeTruthy();
    expect(screen.getByRole("slider")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getAllByTestId("profile-plot")).toHaveLength(2),
    );
    expect(screen.getByText("Preview disabled")).toBeTruthy();

    const checkbox = screen.getByRole("checkbox", { name: "Preview" });
    expect(checkbox).not.toBeChecked();
    expect(previewFeature).not.toHaveBeenCalled();

    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(previewFeature).toHaveBeenCalledWith(
        "image:line_profile",
        "image-1",
        { row: 0, direction: "horizontal" },
      ),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("profile-plot")).toHaveLength(2),
    );
    expect(screen.queryByText("Preview disabled")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("retains profile geometry and parameters in main-thread mode", () => {
    const { runtime, previewFeature } = makeRuntime();
    renderDialog(runtime, () => undefined, false);

    expect(screen.getAllByTestId("profile-plot")).toHaveLength(1);
    expect(screen.getByRole("slider")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Preview" })).toBeNull();
    expect(previewFeature).not.toHaveBeenCalled();
  });
});
