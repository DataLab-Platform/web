/**
 * Tests for :func:`UserGuidePanel` — the bundled pages are listed and the
 * internal links of the Welcome page open them inside the drawer.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { UserGuidePanel } from "../../../src/components/userguide/UserGuidePanel";

describe("UserGuidePanel", () => {
  it("lists the provenance page and opens it from the Welcome page", () => {
    render(<UserGuidePanel onClose={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Provenance and capsules" }),
    ).toBeTruthy();
    const content = screen.getByTestId("userguide-content");
    fireEvent.click(
      screen.getByRole("link", { name: "Provenance and capsules" }),
    );
    expect(content.querySelector("h1")?.textContent).toBe(
      "Provenance and capsules",
    );
    expect(content.textContent).toContain("What provenance does not do");
  });
});
