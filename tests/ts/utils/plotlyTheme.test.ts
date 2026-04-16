import { describe, it, expect } from "vitest";
import {
  getPlotlyThemeLayout,
  mergeAxis,
} from "../../../src/utils/plotlyTheme";

describe("getPlotlyThemeLayout", () => {
  it("returns dark palette for the dark theme", () => {
    const layout = getPlotlyThemeLayout("dark");
    expect(layout.font.color).toBe("#d4d4d4");
    expect(layout.paper_bgcolor).toMatch(/rgba\(0,0,0,0\)/);
    expect(layout.legend.font.color).toBe("#d4d4d4");
  });

  it("returns light palette for the light theme", () => {
    const layout = getPlotlyThemeLayout("light");
    expect(layout.font.color).toBe("#1f1f1f");
    expect(layout.xaxis.gridcolor).toBe("#e0e0e0");
  });
});

describe("mergeAxis", () => {
  it("preserves caller-supplied axis options over the theme defaults", () => {
    const themed = getPlotlyThemeLayout("light").xaxis;
    const merged = mergeAxis(themed, { gridcolor: "#ff0000", title: "X" });
    expect(merged.gridcolor).toBe("#ff0000");
    // Caller-supplied keys are added, theme defaults remain.
    // ``title`` is not part of PlotlyThemeLayout, so we cast.
    expect((merged as { title: string }).title).toBe("X");
    expect(merged.linecolor).toBe(themed.linecolor);
  });
});
