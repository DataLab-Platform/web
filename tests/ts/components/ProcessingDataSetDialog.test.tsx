import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProcessingDataSetDialog } from "../../../src/components/ProcessingDataSetDialog";
import type {
  FeatureDescriptor,
  ProcessingPreviewResult,
  RuntimeApi,
} from "../../../src/runtime/runtime";
import { ThemeProvider } from "../../../src/utils/theme";

vi.mock("react-plotly.js", () => ({
  default: () => <div data-testid="preview-plot" />,
}));

const feature: FeatureDescriptor = {
  id: "moving_average",
  label: "Moving average…",
  menu_path: "Processing/Moving average",
  pattern: "1_to_1",
  icon: null,
  has_params: true,
  operand_label: "Operand",
  object_kind: "signal",
  output_kind: "signal",
  preview_enabled: true,
};

const previewResult: ProcessingPreviewResult = {
  kind: "signal",
  data: {
    id: "preview",
    uuid: null,
    title: "filtered",
    size: 2,
    xlabel: "x",
    ylabel: "y",
    xunit: "s",
    yunit: "V",
    x: new Float64Array([0, 1]),
    y: new Float64Array([2, 3]),
  },
};

function makeRuntime() {
  const previewFeature = vi.fn(async () => previewResult);
  const getSignalData = vi.fn(async () => ({
    ...previewResult.data,
    id: "s1",
    title: "Signal s1",
  }));
  return {
    runtime: {
      previewFeature,
      getSignalData,
      onWorkspaceMutation: vi.fn(() => () => undefined),
      getObject: vi.fn(async (id: string) => ({
        id,
        kind: "signal",
        title: `Signal ${id}`,
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
      <ProcessingDataSetDialog
        title="Moving average"
        payload={{
          schema: {
            type: "object",
            required: ["n"],
            properties: {
              n: {
                type: "integer",
                minimum: 1,
                maximum: 99,
                "x-guidata-kind": "int",
                "x-guidata-label": "Window",
              },
            },
          },
          values: { n: 3 },
        }}
        runtime={runtime}
        previewAvailable={previewAvailable}
        feature={feature}
        sourceIds={["s1", "s2"]}
        onSubmit={() => undefined}
        onCancel={onCancel}
      />
    </ThemeProvider>,
  );
}

describe("ProcessingDataSetDialog", () => {
  it("starts disabled, previews on the shared runtime, and cancels", async () => {
    const { runtime, previewFeature } = makeRuntime();
    const onCancel = vi.fn();
    const { container } = renderDialog(runtime, onCancel);

    const checkbox = screen.getByRole("checkbox", { name: "Preview" });
    expect(checkbox).not.toBeChecked();
    expect(previewFeature).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("preview-plot")).toBeTruthy(),
    );
    expect(
      container.querySelector(".processing-preview-stage"),
    ).toHaveAttribute("aria-disabled", "true");
    expect(checkbox).toBeEnabled();
    expect(screen.getByText("Preview disabled")).toBeTruthy();
    expect(
      container.querySelector(".processing-preview-disabled-icon img"),
    ).not.toBeNull();

    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(previewFeature).toHaveBeenCalledWith("moving_average", "s1", {
        n: 3,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("preview-plot")).toBeTruthy(),
    );
    expect(screen.queryByText("Preview disabled")).toBeNull();
    expect(screen.getByText("Preview up to date")).toBeTruthy();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(screen.getByTestId("preview-plot")).toBeTruthy();
    expect(screen.getByText("Preview disabled")).toBeTruthy();
    expect(previewFeature).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("logically cancels the shared preview when Escape closes the dialog", async () => {
    const { runtime, previewFeature } = makeRuntime();
    const onCancel = vi.fn();
    renderDialog(runtime, onCancel);

    fireEvent.click(screen.getByRole("checkbox", { name: "Preview" }));
    await waitFor(() => expect(previewFeature).toHaveBeenCalledOnce());
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("hides live preview in the main-thread fallback", () => {
    const { runtime, previewFeature } = makeRuntime();
    renderDialog(runtime, () => undefined, false);

    expect(screen.queryByRole("checkbox", { name: "Preview" })).toBeNull();
    expect(previewFeature).not.toHaveBeenCalled();
    expect(screen.getByRole("slider")).toBeTruthy();
  });
});
