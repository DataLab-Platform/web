/**
 * Unit tests for the non-uniform image coordinate helpers.
 *
 * ``toBins`` must mirror PlotPy's ``to_bins`` bit-for-bit so DataLab-Web and
 * DataLab desktop place cell boundaries identically.  Locating the pixel under
 * a coordinate is covered by ``pixelCenters.test.ts``.
 */
import { describe, it, expect } from "vitest";
import { toBins } from "../../../src/utils/imageCoords";

describe("toBins", () => {
  it("matches the PlotPy reference edges for the X axis", () => {
    // Centers [0, 1.5, 4, 9] → edges [-0.75, 0.75, 2.75, 6.5, 11.5].
    expect(toBins([0, 1.5, 4, 9])).toEqual([-0.75, 0.75, 2.75, 6.5, 11.5]);
  });

  it("matches the PlotPy reference edges for the Y axis", () => {
    // Centers [0, 2, 5] → edges [-1, 1, 3.5, 6.5].
    expect(toBins([0, 2, 5])).toEqual([-1, 1, 3.5, 6.5]);
  });

  it("returns no edges for an empty input", () => {
    expect(toBins([])).toEqual([]);
  });

  it("creates a unit-width cell for a single center", () => {
    expect(toBins([3])).toEqual([2.5, 3.5]);
  });

  it("returns regular edges for an evenly-spaced grid", () => {
    expect(toBins([0, 1, 2, 3])).toEqual([-0.5, 0.5, 1.5, 2.5, 3.5]);
  });

  it("always returns one more edge than centers", () => {
    expect(toBins([0, 1.5, 4, 9]).length).toBe(5);
    expect(toBins([0, 2, 5]).length).toBe(4);
  });
});
