import { describe, expect, it } from "vitest";
import {
  PLOTLY_COLORS,
  PLOTLY_DASHES,
  getCurveStyle,
  hexToRgba,
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
});
