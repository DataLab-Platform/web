import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProcessingPreview } from "../../../src/components/ProcessingPreview";
import type {
  FeatureDescriptor,
  RuntimeApi,
} from "../../../src/runtime/runtime";

const controllerSpies = vi.hoisted(() => ({
  request: vi.fn(),
  markDirty: vi.fn(),
  invalidate: vi.fn(),
  invalidateSource: vi.fn(),
  close: vi.fn(),
}));

vi.mock("../../../src/runtime/ProcessingPreviewController", () => ({
  ProcessingPreviewController: class {
    setEnabled() {}
    markDirty = controllerSpies.markDirty;
    invalidate = controllerSpies.invalidate;
    invalidateSource = controllerSpies.invalidateSource;
    close = controllerSpies.close;
    needsSource() {
      return false;
    }
    request = controllerSpies.request;
  },
}));

let mutationListener: (() => void) | null = null;

const feature = {
  id: "moving_average",
  label: "Moving average",
  menu_path: "Processing/Moving average",
  pattern: "1_to_1",
  icon: null,
  has_params: true,
  operand_label: "Operand",
  object_kind: "signal",
  output_kind: "signal",
  preview_enabled: true,
} satisfies FeatureDescriptor;

const runtime = {
  getObject: vi.fn(() => new Promise(() => undefined)),
  onWorkspaceMutation: vi.fn((listener: () => void) => {
    mutationListener = listener;
    return () => {
      mutationListener = null;
    };
  }),
} as unknown as RuntimeApi;

function preview(values: Record<string, unknown>, dragging: boolean) {
  return (
    <ProcessingPreview
      runtime={runtime}
      feature={feature}
      sourceIds={["s1"]}
      values={values}
      valid
      resolving={false}
      dragging={dragging}
    />
  );
}

describe("ProcessingPreview scheduling", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mutationListener = null;
  });

  it("starts immediately, debounces edits, throttles drags, and flushes", () => {
    vi.useFakeTimers();
    const initialValues = { n: 3 };
    const finalValues = { n: 9 };
    const { rerender } = render(preview(initialValues, false));
    fireEvent.click(screen.getByRole("checkbox", { name: "Preview" }));

    expect(controllerSpies.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: { n: 3 } }),
    );
    act(() => vi.advanceTimersByTime(299));
    expect(controllerSpies.request).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(controllerSpies.request).toHaveBeenCalledTimes(1);

    act(() => rerender(preview(initialValues, true)));
    act(() => rerender(preview({ n: 5 }, true)));
    act(() => vi.advanceTimersByTime(100));
    act(() => rerender(preview({ n: 7 }, true)));
    expect(controllerSpies.request).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(100));
    expect(controllerSpies.request).toHaveBeenCalledTimes(3);
    expect(controllerSpies.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: { n: 7 } }),
    );

    act(() => rerender(preview(finalValues, true)));
    act(() => rerender(preview(finalValues, false)));
    expect(controllerSpies.request).toHaveBeenCalledTimes(4);
    expect(controllerSpies.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: { n: 9 } }),
    );
  });

  it("refreshes the cached source after a workspace mutation", () => {
    vi.useFakeTimers();
    render(preview({ n: 3 }, false));
    fireEvent.click(screen.getByRole("checkbox", { name: "Preview" }));
    act(() => vi.advanceTimersByTime(300));
    expect(controllerSpies.request).toHaveBeenCalledTimes(1);

    act(() => mutationListener?.());
    expect(controllerSpies.invalidateSource).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(299));
    expect(controllerSpies.request).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(controllerSpies.request).toHaveBeenCalledTimes(2);
  });
});
