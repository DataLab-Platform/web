import { describe, expect, it } from "vitest";
import { nextFiniteFloat64 } from "../../../src/utils/float64";

describe("nextFiniteFloat64", () => {
  it.each([
    [0, 1, Number.MIN_VALUE],
    [-0, -1, -Number.MIN_VALUE],
    [Number.MIN_VALUE, -1, 0],
    [-Number.MIN_VALUE, 1, -0],
    [1, 1, 1.0000000000000002],
    [1, -1, 0.9999999999999999],
    [2, 1, 2.0000000000000004],
    [2, -1, 1.9999999999999998],
    [-2, -1, -2.0000000000000004],
    [-2, 1, -1.9999999999999998],
    [Number.MAX_VALUE, 1, null],
    [-Number.MAX_VALUE, -1, null],
    [Number.MAX_VALUE, -1, 1.7976931348623155e308],
    [-Number.MAX_VALUE, 1, -1.7976931348623155e308],
    [Infinity, 1, null],
    [NaN, -1, null],
  ])(
    "finds the exact finite neighbor of %s toward %s",
    (value, direction, expected) => {
      expect(nextFiniteFloat64(value as number, direction as -1 | 1)).toBe(
        expected,
      );
    },
  );
});
