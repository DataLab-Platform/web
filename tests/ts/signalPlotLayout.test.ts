import { describe, expect, it } from "vitest";

import {
  buildSignalPlotLayout,
  bundleSignalResults,
  haveCompatibleSignalXAxes,
  normalizeSignalLayoutMode,
} from "../../src/components/signalPlotLayout";
import type { AnalysisResult, SignalData } from "../../src/runtime/runtime";

function makeSignal(id: string, xunit = "s", xlabel = "Time"): SignalData {
  return {
    id,
    uuid: null,
    title: id,
    size: 3,
    xlabel,
    ylabel: "Amplitude",
    xunit,
    yunit: "V",
    x: [0, 1, 2],
    y: [0, 1, 0],
  };
}

describe("signalPlotLayout", () => {
  it("falls back to overlay for missing or invalid persisted values", () => {
    expect(normalizeSignalLayoutMode(null)).toBe("overlay");
    expect(normalizeSignalLayoutMode("diagonal")).toBe("overlay");
    expect(normalizeSignalLayoutMode("vertical")).toBe("vertical");
  });

  it("keeps every trace on the primary axes in overlay mode", () => {
    const layout = buildSignalPlotLayout(
      [makeSignal("a"), makeSignal("b")],
      "overlay",
    );
    expect(layout.assignments.map(({ xRef, yRef }) => [xRef, yRef])).toEqual([
      ["x", "y"],
      ["x", "y"],
    ]);
    expect(Object.keys(layout.axes)).toEqual(["xaxis", "yaxis"]);
  });

  it("stacks vertical axes with the primary signal at the top", () => {
    const signals = [
      makeSignal("a"),
      makeSignal("b"),
      makeSignal("c", "Hz", "Frequency"),
    ];
    const layout = buildSignalPlotLayout(signals, "vertical");
    expect(layout.assignments.map(({ xRef, yRef }) => [xRef, yRef])).toEqual([
      ["x", "y"],
      ["x2", "y2"],
      ["x3", "y3"],
    ]);
    const top = layout.axes.yaxis.domain as [number, number];
    const middle = layout.axes.yaxis2.domain as [number, number];
    const bottom = layout.axes.yaxis3.domain as [number, number];
    expect(top[0]).toBeGreaterThan(middle[1]);
    expect(middle[0]).toBeGreaterThan(bottom[1]);
    expect(layout.axes.xaxis2.matches).toBe("x");
    expect(layout.axes.xaxis3.matches).toBeUndefined();
    expect(layout.axes.xaxis.showticklabels).toBe(false);
    expect(layout.axes.xaxis2.showticklabels).toBe(true);
    expect(layout.axes.xaxis.title).toEqual({ text: "\u200b" });
    expect(layout.minHeight).toBeGreaterThanOrEqual(660);
  });

  it("lays horizontal axes out from left to right", () => {
    const layout = buildSignalPlotLayout(
      [makeSignal("a"), makeSignal("b"), makeSignal("c")],
      "horizontal",
    );
    const left = layout.axes.xaxis.domain as [number, number];
    const middle = layout.axes.xaxis2.domain as [number, number];
    const right = layout.axes.xaxis3.domain as [number, number];
    expect(left[1]).toBeLessThan(middle[0]);
    expect(middle[1]).toBeLessThan(right[0]);
    expect(layout.axes.xaxis2.matches).toBe("x");
    expect(layout.axes.xaxis3.matches).toBe("x");
    expect(layout.minWidth).toBeGreaterThanOrEqual(1080);
  });

  it("does not synchronize ambiguous or incompatible X axes", () => {
    const unlabeled = makeSignal("a", "", "");
    const seconds = makeSignal("b", "s");
    const milliseconds = makeSignal("c", "ms");
    expect(haveCompatibleSignalXAxes(unlabeled, unlabeled)).toBe(false);
    expect(haveCompatibleSignalXAxes(seconds, milliseconds)).toBe(false);
    expect(haveCompatibleSignalXAxes(seconds, makeSignal("d", " s "))).toBe(
      true,
    );
    expect(haveCompatibleSignalXAxes(seconds, makeSignal("e", "S"))).toBe(
      false,
    );
  });

  it("renders one signal like overlay regardless of the stored mode", () => {
    const layout = buildSignalPlotLayout([makeSignal("a")], "horizontal");
    expect(layout.effectiveMode).toBe("overlay");
    expect(layout.assignments[0]).toMatchObject({ xRef: "x", yRef: "y" });
    expect(layout.minWidth).toBeUndefined();
  });

  it("keeps source ids attached to fetched result lists", () => {
    const result = {
      category: "table",
      metadata_key: "stats",
      title: "Stats",
      func_name: "stats",
      headers: [],
      roi_indices: null,
      kind: "stats",
      data: [],
    } satisfies AnalysisResult;
    expect(bundleSignalResults(["a", "b"], [[result], []])).toEqual([
      { signalId: "a", results: [result] },
      { signalId: "b", results: [] },
    ]);
  });
});
