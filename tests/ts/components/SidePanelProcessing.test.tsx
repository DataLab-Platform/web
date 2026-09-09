import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DialogProvider } from "../../../src/components/ConfirmDialog";
import { SidePanel } from "../../../src/components/SidePanel";
import type {
  LastProcessingInfo,
  RuntimeApi,
} from "../../../src/runtime/runtime";

vi.mock("react-plotly.js", () => ({
  default: (props: { data?: Array<{ y?: unknown }> }) => (
    <div
      data-testid="histogram-plot"
      data-histogram={JSON.stringify(props.data?.[0]?.y ?? [])}
    />
  ),
}));

const info: LastProcessingInfo = {
  feature_id: "moving_filter",
  label: "Moving filter",
  menu_path: "Processing/Moving filter",
  source_ids: ["source-1"],
  operand_id: null,
  missing_source_ids: [],
  missing_operand_id: null,
  has_params: true,
  schema: {
    type: "object",
    required: ["method", "window"],
    properties: {
      method: {
        type: "string",
        "x-guidata-kind": "choice",
        "x-guidata-label": "Method",
        "x-guidata-choices-dynamic": true,
        "x-guidata-has-callback": true,
      },
      window: {
        type: "integer",
        minimum: 1,
        maximum: 9,
        "x-guidata-kind": "int",
        "x-guidata-label": "Window",
        "x-guidata-active-dynamic": true,
      },
      ui_state: {
        type: "object",
        "x-guidata-kind": "dict",
        "x-guidata-hide": true,
        "x-guidata-transient": true,
      },
    },
  },
  values: { method: "mean", window: 3, ui_state: { bins: [1, 2, 3] } },
};

describe("SidePanel processing editor", () => {
  it("resolves feature fields and only reapplies on explicit Apply", async () => {
    let finishCallback!: (values: Record<string, unknown>) => void;
    const callbackResult = new Promise<Record<string, unknown>>((resolve) => {
      finishCallback = resolve;
    });
    const resolveFeatureChoices = vi.fn(async () => [
      { value: "mean", label: "Mean" },
      { value: "median", label: "Median" },
    ]);
    const resolveFeatureCallbacks = vi.fn(() => callbackResult);
    const resolveFeatureActive = vi.fn(async () => ({ window: true }));
    const reapplyLastProcessing = vi.fn(async () => "result-1");
    const onObjectChanged = vi.fn();
    const runtime = {
      getLastProcessing: vi.fn(async () => info),
      getPropertiesSnapshot: vi.fn(async () => null),
      resolveFeatureChoices,
      resolveFeatureCallbacks,
      resolveFeatureActive,
      reapplyLastProcessing,
    } as unknown as RuntimeApi;

    render(
      <DialogProvider>
        <SidePanel
          runtime={runtime}
          currentId="result-1"
          panelKind="signal"
          refreshNonce={0}
          onObjectChanged={onObjectChanged}
          preferredTab="processing"
          results={[]}
          onClearResults={() => undefined}
        />
      </DialogProvider>,
    );

    const processingTab = await screen.findByRole("tab", {
      name: "Processing",
    });
    fireEvent.click(processingTab);

    expect(await screen.findByRole("slider")).toBeTruthy();
    await waitFor(() =>
      expect(resolveFeatureChoices).toHaveBeenCalledWith(
        "moving_filter",
        "method",
        info.values,
        "source-1",
      ),
    );
    await waitFor(() =>
      expect(resolveFeatureActive).toHaveBeenCalledWith(
        "moving_filter",
        info.values,
      ),
    );

    const apply = screen.getByRole("button", { name: "Apply" });
    const method = screen.getByRole("combobox");
    fireEvent.change(method, { target: { value: "median" } });

    await waitFor(() =>
      expect(resolveFeatureCallbacks).toHaveBeenCalledWith(
        "moving_filter",
        "method",
        {
          method: "median",
          window: 3,
          ui_state: { bins: [1, 2, 3] },
        },
        "source-1",
      ),
    );
    expect(apply).toBeDisabled();
    expect(reapplyLastProcessing).not.toHaveBeenCalled();

    finishCallback({ method: "median", window: 3 });
    await waitFor(() => expect(apply).toBeEnabled());
    expect(reapplyLastProcessing).not.toHaveBeenCalled();

    fireEvent.click(apply);
    await waitFor(() =>
      expect(reapplyLastProcessing).toHaveBeenCalledWith("result-1", {
        method: "median",
        window: 3,
      }),
    );
    expect(onObjectChanged).toHaveBeenCalledWith("result-1");
  });

  it("keeps saved parameters visible but blocks a missing dependency", async () => {
    const missingInfo: LastProcessingInfo = {
      ...info,
      missing_source_ids: ["source-1"],
    };
    const resolveFeatureChoices = vi.fn(async () => []);
    const resolveFeatureCallbacks = vi.fn(async () => ({}));
    const resolveFeatureActive = vi.fn(async () => ({}));
    const reapplyLastProcessing = vi.fn(async () => "result-1");
    const runtime = {
      getLastProcessing: vi.fn(async () => missingInfo),
      getPropertiesSnapshot: vi.fn(async () => null),
      resolveFeatureChoices,
      resolveFeatureCallbacks,
      resolveFeatureActive,
      reapplyLastProcessing,
    } as unknown as RuntimeApi;

    render(
      <DialogProvider>
        <SidePanel
          runtime={runtime}
          currentId="result-1"
          panelKind="signal"
          refreshNonce={0}
          onObjectChanged={() => undefined}
          preferredTab="processing"
          results={[]}
          onClearResults={() => undefined}
        />
      </DialogProvider>,
    );

    expect(
      await screen.findByText("Source object(s) no longer exist: source-1"),
    ).toBeTruthy();
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(resolveFeatureChoices).not.toHaveBeenCalled();
    expect(resolveFeatureCallbacks).not.toHaveBeenCalled();
    expect(resolveFeatureActive).not.toHaveBeenCalled();
    expect(reapplyLastProcessing).not.toHaveBeenCalled();
  });

  it("reloads missing dependencies when the surrounding model changes", async () => {
    const missingInfo: LastProcessingInfo = {
      ...info,
      missing_source_ids: ["source-1"],
    };
    const getLastProcessing = vi.fn(async () => info);
    const runtime = {
      getLastProcessing,
      getPropertiesSnapshot: vi.fn(async () => null),
      resolveFeatureChoices: vi.fn(async () => []),
      resolveFeatureCallbacks: vi.fn(async () => ({})),
      resolveFeatureActive: vi.fn(async () => ({})),
      reapplyLastProcessing: vi.fn(async () => "result-1"),
    } as unknown as RuntimeApi;

    const { rerender } = render(
      <DialogProvider>
        <SidePanel
          runtime={runtime}
          currentId="result-1"
          panelKind="signal"
          refreshNonce={0}
          onObjectChanged={() => undefined}
          preferredTab="processing"
          results={[]}
          onClearResults={() => undefined}
        />
      </DialogProvider>,
    );

    await screen.findByRole("button", { name: "Apply" });
    getLastProcessing.mockResolvedValue(missingInfo);
    rerender(
      <DialogProvider>
        <SidePanel
          runtime={runtime}
          currentId="result-1"
          panelKind="signal"
          refreshNonce={1}
          onObjectChanged={() => undefined}
          preferredTab="processing"
          results={[]}
          onClearResults={() => undefined}
        />
      </DialogProvider>,
    );

    expect(
      await screen.findByText("Source object(s) no longer exist: source-1"),
    ).toBeTruthy();
    expect(getLastProcessing).toHaveBeenLastCalledWith("result-1");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("refreshes transient context without discarding the processing draft", async () => {
    const histogramInfo: LastProcessingInfo = {
      ...info,
      feature_id: "image:adjust_brightness_contrast",
      label: "Brightness and contrast",
      schema: {
        type: "object",
        properties: {
          minimum: {
            type: "number",
            "x-guidata-kind": "float",
            "x-guidata-hide": true,
          },
          maximum: {
            type: "number",
            "x-guidata-kind": "float",
            "x-guidata-hide": true,
          },
          histogram: {
            type: "object",
            "x-guidata-kind": "histogram_range",
            "x-guidata-transient": true,
            "x-guidata-minimum-field": "minimum",
            "x-guidata-maximum-field": "maximum",
          },
        },
      },
      values: {
        minimum: 64,
        maximum: 192,
        histogram: {
          counts: [1, 2, 3, 4],
          domain: [0, 255],
          y_max: 4,
          minimum_width: 1,
          active: true,
          reset_range: [0, 255],
        },
      },
    };
    const refreshedInfo: LastProcessingInfo = {
      ...histogramInfo,
      values: {
        ...histogramInfo.values,
        histogram: {
          ...(histogramInfo.values?.histogram as Record<string, unknown>),
          counts: [4, 3, 2, 1],
        },
      },
    };
    const getLastProcessing = vi.fn(async () => histogramInfo);
    const runtime = {
      getLastProcessing,
      getPropertiesSnapshot: vi.fn(async () => null),
      resolveFeatureActive: vi.fn(async () => ({})),
      reapplyLastProcessing: vi.fn(async () => "result-1"),
    } as unknown as RuntimeApi;

    const { rerender } = render(
      <DialogProvider>
        <SidePanel
          runtime={runtime}
          currentId="result-1"
          panelKind="image"
          refreshNonce={0}
          onObjectChanged={() => undefined}
          preferredTab="processing"
          results={[]}
          onClearResults={() => undefined}
        />
      </DialogProvider>,
    );

    const minimum = await screen.findByRole("spinbutton", {
      name: "Minimum",
    });
    fireEvent.change(minimum, { target: { value: "80" } });
    minimum.focus();
    expect(screen.getByText("● Unsaved changes")).toBeTruthy();

    getLastProcessing.mockResolvedValue(refreshedInfo);
    rerender(
      <DialogProvider>
        <SidePanel
          runtime={runtime}
          currentId="result-1"
          panelKind="image"
          refreshNonce={1}
          onObjectChanged={() => undefined}
          preferredTab="processing"
          results={[]}
          onClearResults={() => undefined}
        />
      </DialogProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("histogram-plot")).toHaveAttribute(
        "data-histogram",
        "[4,3,2,1]",
      ),
    );
    expect(minimum).toHaveValue(80);
    expect(document.activeElement).toBe(minimum);
    expect(screen.getByText("● Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Discard unapplied changes"));
    expect(minimum).toHaveValue(64);
    expect(screen.getByTestId("histogram-plot")).toHaveAttribute(
      "data-histogram",
      "[4,3,2,1]",
    );
  });
});
