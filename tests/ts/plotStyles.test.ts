import { describe, expect, it } from "vitest";
import {
  PLOTLY_COLORS,
  PLOTLY_DASHES,
  buildCurveTrace,
  getCurveStyle,
  hexToRgba,
  normalizeCurveStyle,
  plotlyDash,
  roiFillColor,
  roiLineColor,
} from "../../src/runtime/plotStyles";

describe("plotStyles", () => {
  it("cycles colors before dashes", () => {
    const s0 = getCurveStyle(0);
    const s9 = getCurveStyle(9);
    const s10 = getCurveStyle(10);
    expect(s0.color).toBe(PLOTLY_COLORS[0]);
    expect(s0.dash).toBe(PLOTLY_DASHES[0]);
    expect(s9.color).toBe(PLOTLY_COLORS[9]);
    expect(s9.dash).toBe(PLOTLY_DASHES[0]);
    // After a full color round, the dash advances and color resets.
    expect(s10.color).toBe(PLOTLY_COLORS[0]);
    expect(s10.dash).toBe(PLOTLY_DASHES[1]);
  });

  it("uses a stable default linewidth", () => {
    expect(getCurveStyle(0).width).toBe(1.5);
    expect(getCurveStyle(0, 3).width).toBe(3);
  });

  it("converts hex to rgba", () => {
    expect(hexToRgba("#1f77b4", 0.5)).toBe("rgba(31, 119, 180, 0.5)");
    expect(hexToRgba("1f77b4", 1)).toBe("rgba(31, 119, 180, 1)");
    // Non-hex input passes through unchanged so the caller can supply
    // pre-rendered ``rgb(...)`` strings.
    expect(hexToRgba("red", 0.5)).toBe("red");
  });

  it("normalises PlotPy linestyle names", () => {
    expect(plotlyDash(null)).toBe("solid");
    expect(plotlyDash("SolidLine")).toBe("solid");
    expect(plotlyDash("DashLine")).toBe("dash");
    expect(plotlyDash("DashDotLine")).toBe("dashdot");
    expect(plotlyDash("DashDotDotLine")).toBe("longdashdot");
    // Unknown values fall through.
    expect(plotlyDash("solid")).toBe("solid");
    expect(plotlyDash("custom-dash")).toBe("custom-dash");
  });

  it("returns ROI fill / line colors that cycle by index", () => {
    expect(roiLineColor(0)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(roiFillColor(0)).toMatch(/^rgba\(/);
    // Cycling: index N+10 reuses index N's color.
    expect(roiLineColor(10)).toBe(roiLineColor(0));
  });

  it("normalises PlotPy curvestyle names to the four supported modes", () => {
    expect(normalizeCurveStyle(null)).toBe("lines");
    expect(normalizeCurveStyle("")).toBe("lines");
    expect(normalizeCurveStyle("Lines")).toBe("lines");
    expect(normalizeCurveStyle("Sticks")).toBe("sticks");
    expect(normalizeCurveStyle("Steps")).toBe("steps");
    expect(normalizeCurveStyle("Dots")).toBe("dots");
    expect(normalizeCurveStyle("NoCurve")).toBe("dots");
    // Unknown values fall back to ``lines``.
    expect(normalizeCurveStyle("WhateverElse")).toBe("lines");
  });

  it("buildCurveTrace renders ``lines`` mode with the requested style", () => {
    const t = buildCurveTrace([0, 1], [0, 1], "#abc123", 2, "dash", "lines");
    expect(t.mode).toBe("lines");
    expect(t.line).toEqual({ color: "#abc123", width: 2, dash: "dash" });
    expect(t.x).toBeUndefined();
    expect(t.y).toBeUndefined();
  });

  it("buildCurveTrace renders ``steps`` with line.shape=hv", () => {
    const t = buildCurveTrace([0, 1], [0, 1], "#000", 1, "solid", "steps");
    expect(t.mode).toBe("lines");
    expect(t.line?.shape).toBe("hv");
  });

  it("buildCurveTrace renders ``dots`` with markers and no line", () => {
    const t = buildCurveTrace([0, 1], [0, 1], "#000", 2, "solid", "dots");
    expect(t.mode).toBe("markers");
    expect(t.line).toBeUndefined();
    expect(t.marker?.color).toBe("#000");
    // Marker size scales with width but never goes below 3.
    expect(t.marker?.size).toBeGreaterThanOrEqual(3);
  });

  it("buildCurveTrace renders ``sticks`` as a stem (NaN-separated bars)", () => {
    const t = buildCurveTrace(
      [0, 1, 2],
      [3, 4, 5],
      "#000",
      1,
      "solid",
      "sticks",
    );
    expect(t.mode).toBe("lines");
    expect(t.x).toEqual([0, 0, NaN, 1, 1, NaN, 2, 2, NaN]);
    expect(t.y).toEqual([0, 3, NaN, 0, 4, NaN, 0, 5, NaN]);
  });
});
