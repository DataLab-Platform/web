import { describe, expect, it } from "vitest";
import {
  buildRoiAreaTrace,
  buildRoiBoundaryShapes,
  interpY,
} from "../../src/components/signalRoi";

describe("interpY", () => {
  it("returns the nearest edge value when xq is out of range", () => {
    expect(interpY([0, 1, 2], [10, 20, 30], -1)).toBe(10);
    expect(interpY([0, 1, 2], [10, 20, 30], 5)).toBe(30);
  });
  it("interpolates linearly between bracketing samples", () => {
    expect(interpY([0, 2], [0, 10], 1)).toBe(5);
    expect(interpY([0, 1, 2, 3], [0, 1, 4, 9], 2.5)).toBe(6.5);
  });
  it("handles empty input safely", () => {
    expect(interpY([], [], 0)).toBe(0);
  });
});

describe("buildRoiAreaTrace", () => {
  const x = [0, 1, 2, 3, 4];
  const y = [0, 2, 4, 2, 0];

  it("returns a fill-to-zero scatter trace with interpolated edges", () => {
    const t = buildRoiAreaTrace({ xmin: 0.5, xmax: 2.5 }, 0, x, y);
    expect(t).not.toBeNull();
    expect(t!.fill).toBe("tozeroy");
    expect(t!.type).toBe("scatter");
    expect(t!.showlegend).toBe(false);
    // Boundaries are interpolated exactly at xmin/xmax.
    const xs = t!.x as number[];
    const ys = t!.y as number[];
    expect(xs[0]).toBe(0.5);
    expect(xs[xs.length - 1]).toBe(2.5);
    expect(ys[0]).toBe(1); // y(0.5) = 0 + (10-0)*0.25 ... actually: 0 + (2-0)*0.5 = 1
    expect(ys[ys.length - 1]).toBe(3); // y(2.5) = 4 + (2-4)*0.5 = 3
    // Inner samples preserved.
    expect(xs.slice(1, -1)).toEqual([1, 2]);
    expect(ys.slice(1, -1)).toEqual([2, 4]);
  });

  it("cycles colors per ROI index (palette has 10 stable entries)", () => {
    const t0 = buildRoiAreaTrace({ xmin: 0, xmax: 4 }, 0, x, y);
    const t10 = buildRoiAreaTrace({ xmin: 0, xmax: 4 }, 10, x, y);
    expect(t0).not.toBeNull();
    expect(t10).not.toBeNull();
    // Index 10 wraps back to index 0 in the ROI_FILL_COLORS palette.
    expect(t0!.fillcolor as string).toBe(t10!.fillcolor as string);
  });

  it("returns null when the ROI does not overlap the curve", () => {
    expect(buildRoiAreaTrace({ xmin: 10, xmax: 20 }, 0, x, y)).toBeNull();
    expect(buildRoiAreaTrace({ xmin: -5, xmax: -1 }, 0, x, y)).toBeNull();
    expect(buildRoiAreaTrace({ xmin: 1, xmax: 1 }, 0, x, y)).toBeNull();
  });

  it("returns null on empty data", () => {
    expect(buildRoiAreaTrace({ xmin: 0, xmax: 1 }, 0, [], [])).toBeNull();
  });

  it("normalises swapped xmin/xmax", () => {
    const t = buildRoiAreaTrace({ xmin: 2.5, xmax: 0.5 }, 0, x, y);
    expect(t).not.toBeNull();
    const xs = t!.x as number[];
    expect(xs[0]).toBe(0.5);
    expect(xs[xs.length - 1]).toBe(2.5);
  });

  it("uses the segment title as trace name when provided", () => {
    const t = buildRoiAreaTrace({ xmin: 0, xmax: 4, title: "Peak A" }, 0, x, y);
    expect(t!.name).toBe("Peak A");
    const t2 = buildRoiAreaTrace({ xmin: 0, xmax: 4 }, 2, x, y);
    expect(t2!.name).toBe("ROI3");
  });
});

describe("buildRoiBoundaryShapes", () => {
  it("returns two full-height dashed vertical lines at xmin and xmax", () => {
    const shapes = buildRoiBoundaryShapes({ xmin: 1, xmax: 3 }, 0);
    expect(shapes).toHaveLength(2);
    for (const s of shapes) {
      expect(s.type).toBe("line");
      expect(s.xref).toBe("x");
      // Paper-referenced y so the line spans the whole plotting area.
      expect(s.yref).toBe("paper");
      expect(s.y0).toBe(0);
      expect(s.y1).toBe(1);
      expect((s.line as { dash: string }).dash).toBe("dash");
    }
    // First line at xmin, second at xmax (vertical => x0 === x1).
    expect(shapes[0].x0).toBe(1);
    expect(shapes[0].x1).toBe(1);
    expect(shapes[1].x0).toBe(3);
    expect(shapes[1].x1).toBe(3);
  });

  it("colors both boundaries with the same per-ROI palette color", () => {
    const shapes = buildRoiBoundaryShapes({ xmin: 0, xmax: 2 }, 1);
    const c0 = (shapes[0].line as { color: string }).color;
    const c1 = (shapes[1].line as { color: string }).color;
    expect(c0).toBe(c1);
  });
});
