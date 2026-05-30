/**
 * Unit tests for the non-uniform image coordinate helpers.
 *
 * ``toBins`` must mirror PlotPy's ``to_bins`` bit-for-bit so DataLab-Web and
 * DataLab desktop place cell boundaries identically; ``binSearchCell`` must
 * locate the cell containing a hovered data coordinate (used for the exact
 * ``z`` tooltip readout).
 */
import { describe, it, expect } from "vitest";
import { toBins, binSearchCell } from "../../../src/utils/imageCoords";

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

describe("binSearchCell", () => {
  const xEdges = [-0.75, 0.75, 2.75, 6.5, 11.5];

  it("locates interior cells", () => {
    expect(binSearchCell(xEdges, 0)).toBe(0);
    expect(binSearchCell(xEdges, 1.5)).toBe(1);
    expect(binSearchCell(xEdges, 4)).toBe(2);
    expect(binSearchCell(xEdges, 9)).toBe(3);
  });

  it("treats cells as half-open on the left boundary", () => {
    // Each interior edge belongs to the cell on its right.
    expect(binSearchCell(xEdges, 0.75)).toBe(1);
    expect(binSearchCell(xEdges, 2.75)).toBe(2);
    expect(binSearchCell(xEdges, 6.5)).toBe(3);
  });

  it("includes both outer boundaries", () => {
    expect(binSearchCell(xEdges, -0.75)).toBe(0);
    expect(binSearchCell(xEdges, 11.5)).toBe(3);
  });

  it("returns -1 outside the extent", () => {
    expect(binSearchCell(xEdges, -1)).toBe(-1);
    expect(binSearchCell(xEdges, 12)).toBe(-1);
  });

  it("returns -1 for degenerate edge arrays", () => {
    expect(binSearchCell([], 0)).toBe(-1);
    expect(binSearchCell([1], 1)).toBe(-1);
  });
});
