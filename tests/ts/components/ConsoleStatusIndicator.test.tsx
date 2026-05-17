/**
 * Tests for :class:`ConsoleStatusIndicator` — the persistent menu-bar
 * button that signals unseen browser-console warnings/errors.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { ConsoleStatusIndicator } from "../../../src/components/ConsoleStatusIndicator";
import {
  __resetConsoleLogForTests,
  installConsoleCapture,
} from "../../../src/utils/consoleLog";

describe("ConsoleStatusIndicator", () => {
  beforeEach(() => {
    installConsoleCapture();
    __resetConsoleLogForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders in idle state by default — no badge, no alert class", () => {
    render(<ConsoleStatusIndicator onOpen={() => {}} />);
    const button = screen.getByRole("button");
    expect(button).not.toHaveClass("alert");
    expect(button.querySelector(".console-status-indicator-badge")).toBeNull();
    expect(button).toHaveAccessibleName(/No error or warning logged/);
  });

  it("transitions to alert state with badge after console.error", () => {
    render(<ConsoleStatusIndicator onOpen={() => {}} />);
    act(() => {
      console.error("boom");
    });
    const button = screen.getByRole("button");
    expect(button).toHaveClass("alert");
    expect(
      button.querySelector(".console-status-indicator-badge")?.textContent,
    ).toBe("1");
    expect(button).toHaveAccessibleName(/1 error/);
  });

  it("tooltip distinguishes errors from warnings", () => {
    render(<ConsoleStatusIndicator onOpen={() => {}} />);
    act(() => {
      console.error("e");
      console.warn("w");
      console.warn("w2");
    });
    expect(screen.getByRole("button")).toHaveAccessibleName(
      /1 error, 2 warnings/,
    );
  });

  it("clicking invokes onOpen and clears the indicator", () => {
    const onOpen = vi.fn();
    render(<ConsoleStatusIndicator onOpen={onOpen} />);
    act(() => {
      console.error("boom");
    });
    const button = screen.getByRole("button");
    expect(button).toHaveClass("alert");

    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(button).not.toHaveClass("alert");
    expect(button.querySelector(".console-status-indicator-badge")).toBeNull();
  });

  it("caps badge display at 99+", () => {
    render(<ConsoleStatusIndicator onOpen={() => {}} />);
    act(() => {
      for (let i = 0; i < 150; i++) console.error(`e${i}`);
    });
    expect(
      screen
        .getByRole("button")
        .querySelector(".console-status-indicator-badge")?.textContent,
    ).toBe("99+");
  });
});
