/**
 * Tests for :func:`WelcomeView` — verifying that the kind-aware rows
 * (Create…, Open file…) behave like the other Quick Action rows: the
 * whole row is clickable and opens a Signal/Image picker popover.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { WelcomeView } from "../../../src/components/welcome/WelcomeView";

function renderWelcome(
  overrides: Partial<Parameters<typeof WelcomeView>[0]> = {},
) {
  const props = {
    appVersion: "test",
    workspaceEmpty: true,
    onCreateKind: vi.fn(),
    onOpenFileKind: vi.fn(),
    onBrowseHdf5: vi.fn(),
    onOpenWorkspaceHdf5: vi.fn(),
    onImportTextWizard: vi.fn(),
    onStartTour: vi.fn(),
    onOpenUserGuide: vi.fn(),
    ...overrides,
  };
  const utils = render(<WelcomeView {...props} />);
  return { ...utils, props };
}

describe("WelcomeView kind-aware rows", () => {
  it("renders Create… / Open file… rows as clickable buttons with a caret", () => {
    renderWelcome();
    const createBtn = screen.getByRole("button", { name: /Create…/ });
    const openBtn = screen.getByRole("button", { name: /Open file…/ });
    expect(createBtn.tagName).toBe("BUTTON");
    expect(openBtn.tagName).toBe("BUTTON");
    expect(createBtn).toHaveAttribute("aria-haspopup", "menu");
    expect(createBtn).toHaveAttribute("aria-expanded", "false");
    expect(openBtn).toHaveAttribute("aria-haspopup", "menu");
  });

  it("opens a Signal/Image picker on click and dispatches onCreateKind", () => {
    const { props } = renderWelcome();
    const createBtn = screen.getByRole("button", { name: /Create…/ });
    fireEvent.click(createBtn);
    expect(createBtn).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu");
    const signalItem = screen.getByRole("menuitem", { name: /Signal/ });
    const imageItem = screen.getByRole("menuitem", { name: /Image/ });
    expect(menu).toBeInTheDocument();
    expect(signalItem).toBeInTheDocument();
    expect(imageItem).toBeInTheDocument();
    fireEvent.click(signalItem);
    expect(props.onCreateKind).toHaveBeenCalledWith("signal");
    // Picker closes after selection.
    expect(screen.queryByRole("menu")).toBeNull();
    expect(createBtn).toHaveAttribute("aria-expanded", "false");
  });

  it("dispatches onOpenFileKind('image') from the Open file… popover", () => {
    const { props } = renderWelcome();
    fireEvent.click(screen.getByRole("button", { name: /Open file…/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Image/ }));
    expect(props.onOpenFileKind).toHaveBeenCalledWith("image");
  });

  it("closes the picker on Escape", () => {
    renderWelcome();
    fireEvent.click(screen.getByRole("button", { name: /Create…/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("invokes onBrowseHdf5 directly (no popover) for kind-less rows", () => {
    const { props } = renderWelcome();
    fireEvent.click(screen.getByRole("button", { name: /Browse HDF5 file…/ }));
    expect(props.onBrowseHdf5).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
