/**
 * Tests for the notebook :class:`OutputArea` — rich outputs restored from
 * an opened ``.ipynb`` file are untrusted and must be sanitised before
 * being injected into the page.
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

    const blocks = container.querySelectorAll(".nb-output-html");
    expect(blocks).toHaveLength(2);
    expect(container.querySelector("#kept")?.textContent).toBe("Result");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBeNull();
  });

  it("keeps the style block and table of Sigima HTML results", () => {
    const outputs = outputsFromIpynb({
      "text/html":
        "\n<style>\n .sigima-html-table { border-collapse: collapse; }\n</style>\n" +
        '<div class="sigima-html-container"><table class="sigima-html-table">' +
        "<tr><th>Property</th><th>Value</th></tr>" +
        "<tr><td>Size</td><td>3 values</td></tr></table></div>",
    });
    const { container } = render(<OutputArea outputs={outputs} />);

    const block = container.querySelector(".nb-output-html");
    expect(block?.querySelector("style")?.textContent).toContain(
      ".sigima-html-table",
    );
    expect(block?.querySelector("table.sigima-html-table")).not.toBeNull();
    expect(block?.querySelectorAll("td")[1]?.textContent).toBe("3 values");
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

    const block = container.querySelector(".nb-output-svg");
    expect(block?.querySelector("svg")).not.toBeNull();
    expect(block?.querySelector("#kept-circle")).not.toBeNull();
    expect(block?.querySelector("script")).toBeNull();
    expect(block?.querySelector("foreignObject")).toBeNull();
    expect(block?.querySelector("iframe")).toBeNull();
    expect(block?.querySelector("[onload]")).toBeNull();
  });
});
