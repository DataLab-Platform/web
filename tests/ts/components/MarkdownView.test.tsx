/**
 * Tests for :class:`MarkdownView` — focuses on the inline-image
 * stripping defence (small local LLMs sometimes hallucinate
 * ``![](data:image/png;base64,…)`` after image-returning tools).
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { MarkdownView } from "../../../src/components/AIAssistant/MarkdownView";

function renderMarkdown(text: string): HTMLElement {
  const { container } = render(<MarkdownView text={text} />);
  return container;
}

describe("MarkdownView", () => {
  it("renders plain Markdown unchanged", () => {
    const c = renderMarkdown("**bold** and `code`");
    expect(c.querySelector("strong")?.textContent).toBe("bold");
    expect(c.querySelector("code")?.textContent).toBe("code");
  });

  it("strips Markdown images with data: URIs from the source", () => {
    const c = renderMarkdown(
      "Here is the image:\n\n![alt](data:image/png;base64,iVBORw0KGgo)\n",
    );
    expect(c.querySelector("img")).toBeNull();
    expect(c.textContent).not.toContain("base64");
    expect(c.textContent).toContain("image omitted");
  });

  it("strips Markdown images with remote URLs too", () => {
    const c = renderMarkdown("![chart](https://example.com/foo.png)");
    expect(c.querySelector("img")).toBeNull();
    expect(c.textContent).toContain("image omitted");
    expect(c.textContent).toContain("chart");
  });

  it("strips bare base64 data URIs left in prose", () => {
    const blob = "A".repeat(80);
    const c = renderMarkdown(`Here it is: data:image/png;base64,${blob} done.`);
    expect(c.textContent).not.toContain(blob);
    expect(c.textContent).toContain("base64 image omitted");
  });

  it("does not strip data URIs that are not images (e.g. data:text/plain)", () => {
    const c = renderMarkdown("data:text/plain;base64,SGVsbG8=");
    expect(c.textContent).toContain("data:text/plain");
  });

  it("forbids <img> tags even if they survive parsing", () => {
    const c = renderMarkdown(
      '<img src="data:image/png;base64,iVBORw0KGgo" alt="x" />',
    );
    expect(c.querySelector("img")).toBeNull();
  });
});
