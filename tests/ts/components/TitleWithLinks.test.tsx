/**
 * Tests for :class:`TitleWithLinks` — the renderer that turns 8-char
 * hex short ids embedded in computation titles into clickable buttons.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { TitleWithLinks } from "../../../src/components/TitleWithLinks";
import {
  ObjectNavigationProvider,
  type OidLookupEntry,
} from "../../../src/components/ObjectNavigationContext";
import type { ObjectNode } from "../../../src/runtime/runtime";

function makeNode(id: string, title: string): ObjectNode {
  return {
    id,
    uuid: null,
    title,
    size: 0,
    xlabel: "",
    ylabel: "",
    xunit: "",
    yunit: "",
    kind: "signal",
  };
}

function renderWithProvider(
  title: string,
  entries: Record<string, OidLookupEntry>,
  navigate: (oid: string) => void = () => {},
) {
  const oidIndex = new Map<string, OidLookupEntry>(Object.entries(entries));
  return render(
    <ObjectNavigationProvider
      oidIndex={oidIndex}
      navigateToOid={navigate}
    >
      <TitleWithLinks title={title} />
    </ObjectNavigationProvider>,
  );
}

describe("TitleWithLinks", () => {
  it("renders a plain title with no hex ids as text", () => {
    const { container } = renderWithProvider("plain title", {});
    expect(container.textContent).toBe("plain title");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("turns a known hex id into a focusable button that triggers navigate", () => {
    const navigate = vi.fn();
    renderWithProvider(
      "normalize(a3f5b2c1)",
      { a3f5b2c1: { kind: "signal", node: makeNode("a3f5b2c1", "My signal") } },
      navigate,
    );
    const btn = screen.getByRole("button", { name: "Go to My signal" });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("a3f5b2c1");
    expect(btn).toHaveAttribute("title", "My signal · signal");
    fireEvent.click(btn);
    expect(navigate).toHaveBeenCalledWith("a3f5b2c1");
  });

  it("renders hex ids absent from the index as plain text (no dead buttons)", () => {
    const { container } = renderWithProvider("normalize(deadbeef)", {});
    expect(container.textContent).toBe("normalize(deadbeef)");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders multiple hex ids in their original order", () => {
    renderWithProvider(
      "average(a3f5b2c1, b9e2d104)",
      {
        a3f5b2c1: { kind: "signal", node: makeNode("a3f5b2c1", "First") },
        b9e2d104: { kind: "signal", node: makeNode("b9e2d104", "Second") },
      },
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent("a3f5b2c1");
    expect(buttons[1]).toHaveTextContent("b9e2d104");
  });

  it("does not turn user titles containing a stray hex token into a link", () => {
    // The hex looks like a valid short id but isn't in the index: must
    // remain plain text. Guards against false positives on user-named
    // signals like ``calibration deadbeef run``.
    const { container } = renderWithProvider("calibration deadbeef run", {});
    expect(container.textContent).toBe("calibration deadbeef run");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("stops click propagation so host rows don't toggle selection", () => {
    const navigate = vi.fn();
    const rowClick = vi.fn();
    const oidIndex = new Map<string, OidLookupEntry>([
      ["a3f5b2c1", { kind: "signal", node: makeNode("a3f5b2c1", "Src") }],
    ]);
    render(
      <ObjectNavigationProvider
        oidIndex={oidIndex}
        navigateToOid={navigate}
      >
        <div onClick={rowClick}>
          <TitleWithLinks title="normalize(a3f5b2c1)" />
        </div>
      </ObjectNavigationProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(navigate).toHaveBeenCalledWith("a3f5b2c1");
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("falls back to plain text when no provider is mounted", () => {
    const { container } = render(
      <TitleWithLinks title="normalize(a3f5b2c1)" />,
    );
    expect(container.textContent).toBe("normalize(a3f5b2c1)");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
