import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MenuBar } from "../../../src/components/MenuBar";
import type { ActionDescriptor, ActionState } from "../../../src/actions/types";
import { ThemeProvider } from "../../../src/utils/theme";

const state: ActionState = {
  status: "ready",
  busy: false,
  selectedIds: [],
  currentId: null,
  hasObjects: false,
  selectedGroupCount: 0,
  hasMacros: false,
  hasNotebooks: false,
  hasMetadataClipboard: false,
  selectionHasRoi: false,
};

function renderMenu(action: ActionDescriptor, actionState = state) {
  render(
    <ThemeProvider>
      <MenuBar
        status="Ready"
        statusKind="ready"
        state={actionState}
        actions={[action]}
      />
    </ThemeProvider>,
  );
}

describe("MenuBar", () => {
  it("executes an enabled top-level leaf action", () => {
    const run = vi.fn();
    renderMenu({
      id: "applications",
      label: "Applications…",
      menuPath: "Applications",
      iconUrl: "data:image/svg+xml,applications",
      enabled: () => true,
      run,
    });

    const action = screen.getByRole("menuitem", { name: "Applications…" });
    expect(action).toHaveAttribute("title", "Applications…");
    expect(action).not.toHaveTextContent("Applications…");
    expect(action.querySelector("img")).toHaveAttribute(
      "src",
      "data:image/svg+xml,applications",
    );
    fireEvent.click(action);
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not execute a disabled top-level leaf action", () => {
    const run = vi.fn();
    renderMenu({
      id: "applications",
      label: "Applications…",
      menuPath: "Applications",
      iconUrl: "data:image/svg+xml,applications",
      enabled: () => false,
      run,
    });

    const action = screen.getByRole("menuitem", { name: "Applications…" });
    expect(action).toBeDisabled();
    fireEvent.click(action);
    expect(run).not.toHaveBeenCalled();
  });
});
