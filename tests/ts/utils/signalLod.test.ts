import { describe, expect, it } from "vitest";

import { reduceSignalForPlot } from "../../../src/utils/signalLod";

describe("reduceSignalForPlot", () => {
  it("returns exact samples when visible density is at most four per pixel", () => {
    const x = Float64Array.from([0, 1, 2, 3, 4, 5]);
    const y = Float64Array.from([0, 1, 2, 3, 4, 5]);

    const result = reduceSignalForPlot(x, y, { width: 2 });

    expect(result.exact).toBe(true);
    expect(result.x).toBe(x);
    expect(result.y).toBe(y);
  });

  it("preserves narrow extrema and source order for irregular X", () => {
    const x = Array.from({ length: 100 }, (_, index) => index * index * 0.01);
    const y = Array.from({ length: 100 }, () => 0);
    y[37] = 123;
    y[38] = -87;

    const result = reduceSignalForPlot(x, y, { width: 8 });
    const outputY = Array.from(result.y);

    expect(result.exact).toBe(false);
    expect(outputY).toContain(123);
    expect(outputY).toContain(-87);
    expect(outputY.indexOf(123)).toBeLessThan(outputY.indexOf(-87));
    expect(outputY.length).toBeLessThanOrEqual(18);
    expect(outputY[0]).toBe(y[0]);
    expect(outputY.at(-1)).toBe(y.at(-1));
  });

  it("uses binary-search windowing and keeps boundary neighbours", () => {
    const x = Array.from({ length: 100 }, (_, index) => index);
    const y = x.map((value) => value * 2);

    const result = reduceSignalForPlot(x, y, {
      width: 10,
      xRange: [40, 45],
    });

    expect(result.exact).toBe(true);
    expect(Array.from(result.x)).toEqual([39, 40, 41, 42, 43, 44, 45, 46]);
  });

  it("keeps NaN separators while reducing finite segments", () => {
    const x = Array.from({ length: 100 }, (_, index) => index);
    const y = x.map((value) => Math.sin(value));
    y[49] = NaN;
    y[50] = NaN;
    y[60] = 50;

    const result = reduceSignalForPlot(x, y, { width: 8 });
    const outputX = Array.from(result.x);
    const outputY = Array.from(result.y);
    const separator = outputY.findIndex(Number.isNaN);

    expect(result.exact).toBe(false);
    expect(separator).toBeGreaterThan(0);
    expect(Number.isFinite(outputX[separator])).toBe(true);
    expect(outputY.slice(separator + 1)).toContain(50);
  });

  it("keeps the finite-point budget with many NaN gaps", () => {
    const x = Array.from({ length: 1_000 }, (_, index) => index);
    const y = x.map((value, index) => (index % 2 === 0 ? value : NaN));

    const result = reduceSignalForPlot(x, y, { width: 8 });
    const outputY = Array.from(result.y);

    expect(outputY.filter(Number.isFinite).length).toBeLessThanOrEqual(18);
    expect(outputY.some(Number.isNaN)).toBe(true);
  });
});
