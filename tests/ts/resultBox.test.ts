/**
 * Tests for the result annotation box helper.
 */

import { describe, it, expect } from "vitest";
import {
  buildResultAnnotationBox,
  RESULT_BOX_MAX_ROWS,
} from "../../src/components/resultBox";
import type {
  AnalysisResult,
  TableAnalysisResult,
  GeometryAnalysisResult,
} from "../../src/runtime/runtime";

function makeTable(
  partial: Partial<TableAnalysisResult>,
): TableAnalysisResult {
  return {
    category: "table",
    metadata_key: "k",
    title: "FWHM",
    func_name: "fwhm",
    headers: ["x0", "fwhm"],
    roi_indices: null,
    kind: "table",
    data: [[0, 1]],
    ...partial,
  } as TableAnalysisResult;
}

function makeGeom(): GeometryAnalysisResult {
  return {
    category: "geometry",
    metadata_key: "g",
    title: "Centroid",
    func_name: "centroid",
    headers: ["x", "y"],
    roi_indices: null,
    kind: "point",
    coords: [[1, 2]],
  } as GeometryAnalysisResult;
}

describe("buildResultAnnotationBox", () => {
  it("returns no annotations when results are empty", () => {
    const { annotations } = buildResultAnnotationBox([]);
    expect(annotations).toEqual([]);
  });

  it("ignores geometry results (only TableAnalysisResult is shown)", () => {
    const results: AnalysisResult[] = [makeGeom()];
    const { annotations } = buildResultAnnotationBox(results);
    expect(annotations).toEqual([]);
  });

  it("emits one annotation pinned to the top-right corner", () => {
    const { annotations } = buildResultAnnotationBox([makeTable({})]);
    expect(annotations).toHaveLength(1);
    const a = annotations[0] as Record<string, unknown>;
    expect(a.xref).toBe("paper");
    expect(a.yref).toBe("paper");
    expect(a.xanchor).toBe("right");
    expect(a.yanchor).toBe("top");
    expect(a.showarrow).toBe(false);
  });

  it("formats a row with header=value cells", () => {
    const { annotations } = buildResultAnnotationBox([
      makeTable({ headers: ["x0", "fwhm"], data: [[1.5, 0.25]] }),
    ]);
    const a = annotations[0] as { text: string };
    expect(a.text).toContain("<b>FWHM</b>");
    expect(a.text).toContain("x0=1.5");
    expect(a.text).toContain("fwhm=0.25");
  });

  it("uses ROI labels when roi_indices is provided", () => {
    const { annotations } = buildResultAnnotationBox([
      makeTable({
        headers: ["v"],
        roi_indices: [0, 2],
        data: [[10], [20]],
      }),
    ]);
    const a = annotations[0] as { text: string };
    expect(a.text).toContain("ROI1: v=10");
    expect(a.text).toContain("ROI3: v=20");
  });

  it("falls back to #i numbering when no ROI is attached", () => {
    const { annotations } = buildResultAnnotationBox([
      makeTable({ headers: ["v"], roi_indices: null, data: [[10]] }),
    ]);
    const a = annotations[0] as { text: string };
    expect(a.text).toContain("#1: v=10");
  });

  it("truncates rows beyond RESULT_BOX_MAX_ROWS with a summary line", () => {
    const data = Array.from({ length: RESULT_BOX_MAX_ROWS + 3 }, (_, i) => [i]);
    const { annotations } = buildResultAnnotationBox([
      makeTable({ headers: ["v"], data }),
    ]);
    const a = annotations[0] as { text: string };
    expect(a.text).toContain("…(3 more)");
  });

  it("formats very small / very large numbers in scientific notation", () => {
    const { annotations } = buildResultAnnotationBox([
      makeTable({ headers: ["v"], data: [[1.234e-6]] }),
    ]);
    const a = annotations[0] as { text: string };
    expect(a.text).toMatch(/v=1\.234e-6/);
  });

  it("escapes HTML special characters in titles and headers", () => {
    const { annotations } = buildResultAnnotationBox([
      makeTable({
        title: "<script>",
        headers: ["a&b"],
        data: [["<x>"]],
      }),
    ]);
    const a = annotations[0] as { text: string };
    expect(a.text).toContain("&lt;script&gt;");
    expect(a.text).toContain("a&amp;b");
    expect(a.text).toContain("&lt;x&gt;");
  });

  it("uses dark colours when options.dark is true", () => {
    const { annotations } = buildResultAnnotationBox(
      [makeTable({})],
      { dark: true },
    );
    const a = annotations[0] as { font: { color: string }; bgcolor: string };
    expect(a.font.color).toBe("#f0f0f0");
    expect(a.bgcolor).toContain("30,30,30");
  });
});
