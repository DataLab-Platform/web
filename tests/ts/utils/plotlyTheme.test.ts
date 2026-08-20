import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  getPlotlyThemeLayout,
  mergeAxis,
  usePlotlyTheme,
} from "../../../src/utils/plotlyTheme";
import { ThemeProvider } from "../../../src/utils/theme";

describe("usePlotlyTheme", () => {
  it("preserves layout identity when the theme is unchanged", () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(ThemeProvider, null, children);
    const { result, rerender } = renderHook(() => usePlotlyTheme(), {
      wrapper,
    });
    const initial = result.current;

    rerender();

    expect(result.current).toBe(initial);
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
