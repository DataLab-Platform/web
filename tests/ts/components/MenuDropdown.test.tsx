import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MenuDropdown } from "../../../src/components/MenuDropdown";
import type { ActionState, MenuNode } from "../../../src/actions/types";

const state: ActionState = {
  status: "ready",
  busy: false,
  selectedIds: ["a", "b"],
  currentId: "a",
  hasObjects: true,
  selectedGroupCount: 0,
  hasMacros: false,
  hasNotebooks: false,
  hasMetadataClipboard: false,
  selectionHasRoi: false,
};

afterEach(cleanup);

describe("MenuDropdown", () => {
  it("renders checked actions with semantic radio state", () => {
    const run = vi.fn();
    const onClose = vi.fn();
    const nodes: MenuNode[] = [
      {
        label: "Vertical",
        displayLabel: "Vertical",
        path: "View/Signal plot layout/Vertical",
        action: {
          id: "view.signal_layout.vertical",
          label: "Vertical",
          menuPath: "View/Signal plot layout/Vertical",
          checkable: "radio",
          checked: true,
          enabled: () => true,
          run,
        },
      },
    ];
    render(<MenuDropdown nodes={nodes} state={state} onClose={onClose} />);

    const item = screen.getByRole("menuitemradio", { name: "Vertical" });
    expect(item.getAttribute("aria-checked")).toBe("true");
    expect(item.textContent).toContain("●");
    fireEvent.click(item);
    expect(onClose).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });
});
