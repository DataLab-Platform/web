import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignalAxisGroupsDialog } from "../../../src/components/SignalAxisGroupsDialog";
import type { SignalData } from "../../../src/runtime/runtime";

afterEach(cleanup);

function makeSignal(id: string, xunit = "s"): SignalData {
  return {
    id,
    uuid: `uuid-${id}`,
    title: `Signal ${id}`,
    size: 2,
    xlabel: xunit === "s" ? "Time" : "Frequency",
    ylabel: "Amplitude",
    xunit,
    yunit: "V",
    x: [0, 1],
    y: [0, 1],
  };
}

const signals = [makeSignal("a"), makeSignal("b"), makeSignal("c", "Hz")];
const groups = [
  { id: "ab", signalIds: ["a", "b"] },
  { id: "c", signalIds: ["c"] },
];

describe("SignalAxisGroupsDialog", () => {
  it("moves a signal with the accessible axis selector and applies once", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <SignalAxisGroupsDialog
        signals={signals}
        groups={groups}
        layoutMode="overlay"
        onApply={onApply}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("button", { name: "Vertical" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Horizontal" }));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Axis for Signal b" }),
      {
        target: { value: "c" },
      },
    );
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith(
      [
        { id: "ab", signalIds: ["a"] },
        { id: "c", signalIds: ["c", "b"] },
      ],
      "horizontal",
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("keeps edits transactional when cancelled", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <SignalAxisGroupsDialog
        signals={signals}
        groups={groups}
        layoutMode="overlay"
        onApply={onApply}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Horizontal" }));
    fireEvent.click(screen.getByRole("button", { name: "All on one axis" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("offers presets, axis ordering and incompatibility warnings", () => {
    const onApply = vi.fn();
    render(
      <SignalAxisGroupsDialog
        signals={signals}
        groups={groups}
        layoutMode="vertical"
        onApply={onApply}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "All on one axis" }));
    expect(screen.getByText(/different X labels or units/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "One axis per signal" }),
    );
    expect(screen.getByRole("heading", { name: "Axis 3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move axis 3 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith(
      [
        { id: "axis:a", signalIds: ["a"] },
        { id: "axis:c", signalIds: ["c"] },
        { id: "axis:b", signalIds: ["b"] },
      ],
      "vertical",
    );
  });

  it("preserves an existing horizontal layout by default", () => {
    const onApply = vi.fn();
    render(
      <SignalAxisGroupsDialog
        signals={signals}
        groups={groups}
        layoutMode="horizontal"
        onApply={onApply}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Horizontal" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith(groups, "horizontal");
  });

  it("closes on Escape", () => {
    const onCancel = vi.fn();
    render(
      <SignalAxisGroupsDialog
        signals={signals}
        groups={groups}
        layoutMode="overlay"
        onApply={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
