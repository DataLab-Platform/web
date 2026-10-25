import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ProfileDefinitionDialog,
  buildShape,
  shapeToValues,
} from "../../../src/components/ProfileDefinitionDialog";
import { pixelCenters } from "../../../src/utils/pixelCenters";
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
  const releasePreviewResult = vi.fn(async () => undefined);
  return {
    runtime: {
      previewFeature,
      releasePreviewResult,
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
  onSubmit: (
    values: Record<string, unknown>,
    previewToken?: string | null,
  ) => void | Promise<void> = () => undefined,
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
            required: ["y"],
            properties: {
              y: {
                type: "number",
                "x-guidata-kind": "float",
                "x-guidata-label": "Y",
              },
            },
          },
          values: { y: 0, direction: "horizontal" },
        }}
        imageData={imageData}
        onSubmit={onSubmit}
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
    expect(screen.getByRole("spinbutton")).toBeTruthy();
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
        { y: 0, direction: "horizontal" },
        expect.any(String),
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
    expect(screen.getByRole("spinbutton")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Preview" })).toBeNull();
    expect(previewFeature).not.toHaveBeenCalled();
  });

  it("hands a current profile preview to submit", async () => {
    const { runtime } = makeRuntime();
    const onSubmit = vi.fn(async () => undefined);
    renderDialog(runtime, () => undefined, true, onSubmit);

    fireEvent.click(screen.getByRole("checkbox", { name: "Preview" }));
    await screen.findByText("Preview up to date");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        { y: 0, direction: "horizontal" },
        expect.any(String),
      ),
    );
  });
});

describe("profile geometry (physical coordinates)", () => {
  // Calibrated image: pixel centers at x = -10, -9.5, -9 and y = 5, 7
  const calibrated: ImageData = {
    ...imageData,
    width: 3,
    height: 2,
    data: [
      [0, 1, 2],
      [3, 4, 5],
    ],
    x0: -10,
    y0: 5,
    dx: 0.5,
    dy: 2,
  };

  it("uses the pixel centers of Sigima (origin at the first center)", () => {
    expect(pixelCenters(calibrated, "x")).toEqual([-10, -9.5, -9]);
    expect(pixelCenters(calibrated, "y")).toEqual([5, 7]);
    const nonUniform: ImageData = {
      ...calibrated,
      is_uniform_coords: false,
      xcoords: [0, 1, 4],
      ycoords: [10, 30],
    };
    expect(pixelCenters(nonUniform, "x")).toEqual([0, 1, 4]);
  });

  it("draws the shape from the physical parameters", () => {
    const line = buildShape(
      "line_profile",
      { direction: "horizontal", y: 6.5 },
      calibrated,
    );
    expect(line).toMatchObject({ x0: -10.25, x1: -8.75, y0: 6.5, y1: 6.5 });
    // Undefined bounds of the average profile stand for the image edges
    const rect = buildShape(
      "average_profile",
      { direction: "vertical", x1: -9.6, y1: null, x2: null, y2: null },
      calibrated,
    );
    expect(rect).toMatchObject({ x0: -9.6, y0: 4, x1: -8.75, y1: 8 });
  });

  it("commits the drawn shape as physical parameters", () => {
    expect(
      shapeToValues(
        "line_profile",
        { direction: "vertical", x: -10 },
        calibrated,
        { x0: -9.4, x1: -9.4 },
      ),
    ).toEqual({ direction: "vertical", x: -9.4 });
    // Points beyond the image are brought back to the outermost pixel centers
    expect(
      shapeToValues(
        "segment_profile",
        { x1: -10, y1: 5, x2: -9, y2: 7 },
        calibrated,
        { x0: -20, y0: 6, x1: 3, y1: 50 },
      ),
    ).toEqual({ x1: -10, y1: 6, x2: -9, y2: 7 });
    expect(
      shapeToValues(
        "average_profile",
        { direction: "horizontal", x1: null, y1: null, x2: null, y2: null },
        calibrated,
        { x0: -9, y0: 7.5, x1: -9.8, y1: 4.5 },
      ),
    ).toEqual({ direction: "horizontal", x1: -9.8, y1: 4.5, x2: -9, y2: 7.5 });
  });
});
