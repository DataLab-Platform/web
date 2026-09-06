import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DialogProvider } from "../../../src/components/ConfirmDialog";
import { SidePanel } from "../../../src/components/SidePanel";
import type {
  LastProcessingInfo,
  RuntimeApi,
} from "../../../src/runtime/runtime";

const info: LastProcessingInfo = {
  feature_id: "moving_filter",
  label: "Moving filter",
  menu_path: "Processing/Moving filter",
  source_ids: ["source-1"],
  operand_id: null,
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
    },
  },
  values: { method: "mean", window: 3 },
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
        { method: "median", window: 3 },
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
});
