import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { UserGuidePanel } from "../../../src/components/userguide/UserGuidePanel";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function openGuide() {
  render(<UserGuidePanel onClose={vi.fn()} />);
  return {
    content: screen.getByTestId("userguide-content"),
    navigation: screen.getByRole("navigation", {
      name: "User guide table of contents",
    }),
  };
}

function clickLink(anchor: HTMLAnchorElement): boolean {
  let intercepted = false;
  const stopNavigation = (event: MouseEvent) => {
    intercepted = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", stopNavigation, { once: true });
  fireEvent.click(anchor);
  document.removeEventListener("click", stopNavigation);
  return intercepted;
}

function addLink(content: HTMLElement, href: string): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.setAttribute("href", href);
  anchor.textContent = "Test link";
  content.appendChild(anchor);
  return anchor;
}

describe("UserGuidePanel", () => {
  it("navigates to every bundled page from the table of contents", () => {
    const { content, navigation } = openGuide();
    const pages = [
      ["Welcome", "Welcome to DataLab-Web"],
      ["Differences from desktop", "Differences from desktop DataLab"],
      ["Computation engine (Sigima)", "Computation engine (Sigima)"],
      ["Provenance and capsules", "Provenance and capsules"],
      ["Notebooks", "Notebooks"],
      ["Plugins", "Authoring DataLab-Web plugins"],
    ];

    for (const [title, heading] of pages) {
      const button = within(navigation).getByRole("button", { name: title });
      fireEvent.click(button);
      expect(button).toHaveClass("active");
      expect(content.querySelector("h1")).toHaveTextContent(heading);
    }
  });

  it.each([
    {
      name: "Plugins",
      heading: "Authoring DataLab-Web plugins",
      target: "plugins.md",
    },
    { name: "Notebooks", heading: "Notebooks", target: "notebooks.md" },
  ])("routes source-relative links to $name", ({ name, heading, target }) => {
    const { content, navigation } = openGuide();
    fireEvent.click(
      within(navigation).getByRole("button", {
        name: "Differences from desktop",
      }),
    );
    const link = within(content)
      .getAllByRole("link", { name })
      .find((anchor) => anchor.getAttribute("href")?.endsWith(target));
    expect(link).toBeDefined();
    expect(link).toHaveAttribute("href", `../${target}`);

    const source = resolve(
      root,
      "doc",
      "userguide",
      "differences-from-desktop.md",
    );
    const resolved = resolve(dirname(source), link!.getAttribute("href")!);
    expect(resolved).toBe(resolve(root, "doc", target));
    expect(existsSync(resolved)).toBe(true);

    expect(clickLink(link as HTMLAnchorElement)).toBe(true);
    expect(content.querySelector("h1")).toHaveTextContent(heading);
    expect(within(navigation).getByRole("button", { name })).toHaveClass(
      "active",
    );
  });

  it.each([
    {
      page: "Welcome",
      label: "Provenance and capsules",
      href: "provenance-and-capsules.md",
      heading: "Provenance and capsules",
      source: "welcome.md",
    },
    {
      page: "Computation engine (Sigima)",
      label: "Differences from desktop DataLab",
      href: "differences-from-desktop.md",
      heading: "Differences from desktop DataLab",
      source: "computation-engine.md",
    },
  ])(
    "preserves the $page link to $label",
    ({ page, label, href, heading, source }) => {
      const { content, navigation } = openGuide();
      fireEvent.click(within(navigation).getByRole("button", { name: page }));
      const link = within(content).getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", href);
      const sourcePath = resolve(root, "doc", "userguide", source);
      expect(existsSync(sourcePath)).toBe(true);
      expect(existsSync(resolve(dirname(sourcePath), href))).toBe(true);
      expect(clickLink(link as HTMLAnchorElement)).toBe(true);
      expect(content.querySelector("h1")).toHaveTextContent(heading);
    },
  );

  it("restores each page's scroll position when navigating back", () => {
    const { content, navigation } = openGuide();
    content.scrollTop = 42;
    const link = within(content).getByRole("link", {
      name: "Provenance and capsules",
    });
    expect(clickLink(link as HTMLAnchorElement)).toBe(true);
    expect(content.scrollTop).toBe(0);
    content.scrollTop = 21;
    fireEvent.click(
      within(navigation).getByRole("button", { name: "Welcome" }),
    );
    expect(content.scrollTop).toBe(42);
    fireEvent.click(
      within(navigation).getByRole("button", {
        name: "Provenance and capsules",
      }),
    );
    expect(content.scrollTop).toBe(21);
  });

  it.each([
    {
      page: "Welcome",
      href: "./provenance-and-capsules.md",
      heading: "Provenance and capsules",
    },
    {
      page: "Differences from desktop",
      href: "./../notebooks.md",
      heading: "Notebooks",
    },
    {
      page: "Provenance and capsules",
      href: "./computation-engine.md",
      heading: "Computation engine (Sigima)",
    },
    {
      page: "Notebooks",
      href: "./plugins.md",
      heading: "Authoring DataLab-Web plugins",
    },
    {
      page: "Plugins",
      href: "userguide/welcome.md",
      heading: "Welcome to DataLab-Web",
    },
  ])("resolves $href from $page", ({ page, href, heading }) => {
    const { content, navigation } = openGuide();
    fireEvent.click(within(navigation).getByRole("button", { name: page }));
    expect(clickLink(addLink(content, href))).toBe(true);
    expect(content.querySelector("h1")).toHaveTextContent(heading);
  });

  it("leaves same-page anchors to the browser", () => {
    const { content, navigation } = openGuide();
    fireEvent.click(
      within(navigation).getByRole("button", {
        name: "Differences from desktop",
      }),
    );
    const link = content.querySelector<HTMLAnchorElement>('a[href="#plugins"]');
    expect(link).not.toBeNull();
    expect(clickLink(link!)).toBe(false);
    expect(content.querySelector("h1")).toHaveTextContent(
      "Differences from desktop DataLab",
    );
  });

  it.each([
    "plugins.md",
    "./plugins.md",
    "unrelated/plugins.md",
    "../../plugins.md",
    "/doc/plugins.md",
    "../plugins.md#section",
    "../plugins.md?view=1",
    "//example.com/doc/plugins.md",
    "mailto:plugins@example.com",
  ])("leaves non-page or qualified links to the browser: %s", (href) => {
    const { content, navigation } = openGuide();
    fireEvent.click(
      within(navigation).getByRole("button", {
        name: "Differences from desktop",
      }),
    );
    const link = addLink(content, href);
    expect(clickLink(link)).toBe(false);
    expect(content.querySelector("h1")).toHaveTextContent(
      "Differences from desktop DataLab",
    );
    expect(link.target).toBe("");
  });

  it("opens external HTTP links in a new tab without intercepting them", () => {
    const { content } = openGuide();
    const link = within(content).getByRole("link", {
      name: "DataLab project website",
    }) as HTMLAnchorElement;
    expect(clickLink(link)).toBe(false);
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(content.querySelector("h1")).toHaveTextContent(
      "Welcome to DataLab-Web",
    );
  });

  it("does not route an absolute URL that resembles a bundled source", () => {
    const { content, navigation } = openGuide();
    fireEvent.click(
      within(navigation).getByRole("button", {
        name: "Differences from desktop",
      }),
    );
    const link = addLink(content, "https://userguide.invalid/doc/plugins.md");
    expect(clickLink(link)).toBe(false);
    expect(link.target).toBe("_blank");
    expect(content.querySelector("h1")).toHaveTextContent(
      "Differences from desktop DataLab",
    );
  });

  it("preserves an external link's explicit target and rel", () => {
    const { content } = openGuide();
    const link = addLink(content, "https://example.com/doc/plugins.md");
    link.target = "_self";
    link.rel = "nofollow";
    expect(clickLink(link)).toBe(false);
    expect(link.target).toBe("_self");
    expect(link.rel).toBe("nofollow");
  });
});
