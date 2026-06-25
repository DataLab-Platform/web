import { describe, expect, it } from "vitest";
import {
  buildRoiOverlays,
  computeDraggedSegment,
  parsePolygonPath,
  pointInPolygon,
  resizeCursor,
  roiHitTest,
} from "../../src/components/imageRoi";
import { ROI_FILL_COLORS } from "../../src/runtime/plotStyles";
import type { ImageRoiSegment } from "../../src/runtime/runtime";

type Shape = {
  type: string;
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
  path?: string;
  line: { color: string; width: number; dash: string };
  fillcolor?: string;
  editable: boolean;
};
type Annotation = {
  text: string;
  font: { color: string };
  x: number;
  y: number;
};

describe("buildRoiOverlays", () => {
  const rect: ImageRoiSegment = {
    geometry: "rectangle",
    title: "",
    x0: 10,
    y0: 20,
    dx: 30,
    dy: 40,
  };
  const circle: ImageRoiSegment = {
    geometry: "circle",
    title: "Spot",
    xc: 50,
    yc: 60,
    r: 5,
  };
  const poly: ImageRoiSegment = {
    geometry: "polygon",
    title: "",
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
  };

  it("renders rectangle shape and label with the cycling palette color", () => {
    const { roiShapes, roiAnnotations } = buildRoiOverlays([rect]);
    expect(roiShapes).toHaveLength(1);
    const s = roiShapes[0] as Shape;
    expect(s.type).toBe("rect");
    expect(s.x0).toBe(10);
    expect(s.x1).toBe(40);
    expect(s.y0).toBe(20);
    expect(s.y1).toBe(60);
    expect(s.line.color).toBe(ROI_FILL_COLORS[0]);
    const a = roiAnnotations[0] as Annotation;
    expect(a.text).toBe("ROI1");
    expect(a.font.color).toBe(ROI_FILL_COLORS[0]);
  });

  it("renders circle shape with bounding box and honours an explicit title", () => {
    const { roiShapes, roiAnnotations } = buildRoiOverlays([circle]);
    const s = roiShapes[0] as Shape;
    expect(s.type).toBe("circle");
    expect(s.x0).toBe(45);
    expect(s.x1).toBe(55);
    expect(s.y0).toBe(55);
    expect(s.y1).toBe(65);
    expect((roiAnnotations[0] as Annotation).text).toBe("Spot");
  });

  it("renders polygon as a Plotly path and labels with ROI{i+1} fallback", () => {
    const { roiShapes, roiAnnotations } = buildRoiOverlays([poly]);
    const s = roiShapes[0] as Shape;
    expect(s.type).toBe("path");
    expect(s.path).toBe("M 0,0 L 10,0 L 10,10 Z");
    expect((roiAnnotations[0] as Annotation).text).toBe("ROI1");
  });

  it("skips polygons with fewer than 3 points", () => {
    const tiny: ImageRoiSegment = {
      geometry: "polygon",
      title: "",
      points: [
        [0, 0],
        [1, 1],
      ],
    };
    const { roiShapes, roiAnnotations } = buildRoiOverlays([tiny]);
    expect(roiShapes).toHaveLength(0);
    expect(roiAnnotations).toHaveLength(0);
  });

  it("cycles through ROI_FILL_COLORS by index (wraps at 10)", () => {
    const segments: ImageRoiSegment[] = Array.from({ length: 11 }, (_, i) => ({
      geometry: "rectangle",
      title: "",
      x0: i,
      y0: 0,
      dx: 1,
      dy: 1,
    }));
    const { roiShapes } = buildRoiOverlays(segments);
    expect((roiShapes[0] as Shape).line.color).toBe(ROI_FILL_COLORS[0]);
    expect((roiShapes[1] as Shape).line.color).toBe(ROI_FILL_COLORS[1]);
    expect((roiShapes[10] as Shape).line.color).toBe(ROI_FILL_COLORS[0]);
  });

  it("adds editable shapes and translucent fill in edit mode", () => {
    const { roiShapes } = buildRoiOverlays([rect], true);
    const s = roiShapes[0] as Shape;
    expect(s.editable).toBe(true);
    expect(s.line.width).toBe(2);
    expect(s.fillcolor).toBeDefined();
    expect(s.fillcolor).toContain("rgba(");
  });

  it("leaves shapes non-editable and unfilled in view mode", () => {
    const { roiShapes } = buildRoiOverlays([rect]);
    const s = roiShapes[0] as Shape;
    expect(s.editable).toBe(false);
    expect(s.line.width).toBe(1.5);
    expect(s.fillcolor).toBeUndefined();
  });
});

describe("parsePolygonPath", () => {
  it("parses the spaced form we emit for existing ROIs", () => {
    expect(parsePolygonPath("M 1,2 L 3,4 L 5,6 Z")).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it("parses the space-less form Plotly's drawclosedpath emits (regression)", () => {
    // Freshly drawn polygons come back with no whitespace between the
    // M/L/Z commands and the coordinates; the old whitespace-split parser
    // dropped every point, so the polygon ROI silently vanished on release.
    expect(parsePolygonPath("M100,200L150,250L120,300Z")).toEqual([
      [100, 200],
      [150, 250],
      [120, 300],
    ]);
  });

  it("handles negative and decimal coordinates", () => {
    expect(parsePolygonPath("M-1.5,2L3,-4.25L0.5,6Z")).toEqual([
      [-1.5, 2],
      [3, -4.25],
      [0.5, 6],
    ]);
  });

  it("returns an empty list for a path with no coordinate pairs", () => {
    expect(parsePolygonPath("MZ")).toEqual([]);
  });
});

describe("computeDraggedSegment", () => {
  const rect: ImageRoiSegment = {
    geometry: "rectangle",
    title: "R",
    inverse: false,
    x0: 10,
    y0: 20,
    dx: 30,
    dy: 40,
  };
  const circle: ImageRoiSegment = {
    geometry: "circle",
    title: "C",
    inverse: false,
    xc: 50,
    yc: 60,
    r: 5,
  };
  const poly: ImageRoiSegment = {
    geometry: "polygon",
    title: "P",
    inverse: false,
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
  };

  it("translates a rectangle by the pointer delta on a move", () => {
    // Anchor at (15,25); pointer moved to (25,45) → delta (10,20).
    const out = computeDraggedSegment(rect, "move", 25, 45, 15, 25);
    expect(out).toMatchObject({ x0: 20, y0: 40, dx: 30, dy: 40 });
  });

  it("resizes a rectangle by a corner, keeping the opposite corner fixed", () => {
    // Grab the bottom-right corner (x1=40, y1=60) and drag it to (50, 75).
    // The top-left corner (10,20) stays put.
    const out = computeDraggedSegment(rect, "x1y1", 50, 75, 40, 60);
    expect(out).toMatchObject({ x0: 10, y0: 20, dx: 40, dy: 55 });
  });

  it("normalises a rectangle when a corner is dragged past the opposite one", () => {
    // Drag the bottom-right corner to the left/above the fixed top-left
    // (10,20): x0/y0 follow the pointer and dx/dy stay positive.
    const out = computeDraggedSegment(rect, "x1y1", 4, 8, 40, 60);
    expect(out.geometry).toBe("rectangle");
    if (out.geometry === "rectangle") {
      expect(out.x0).toBe(4);
      expect(out.y0).toBe(8);
      expect(out.dx).toBe(6);
      expect(out.dy).toBe(12);
    }
  });

  it("translates a circle centre on a move", () => {
    const out = computeDraggedSegment(circle, "move", 53, 64, 50, 60);
    expect(out).toMatchObject({ xc: 53, yc: 64, r: 5 });
  });

  it("resizes a circle radius to the pointer distance from the centre", () => {
    // Pointer at (50+8, 60+6) → distance 10 from the centre.
    const out = computeDraggedSegment(circle, "radius", 58, 66, 0, 0);
    expect(out.geometry).toBe("circle");
    if (out.geometry === "circle") expect(out.r).toBeCloseTo(10, 6);
  });

  it("translates every polygon vertex on a move", () => {
    const out = computeDraggedSegment(poly, "move", 13, 27, 10, 20);
    expect(out.geometry).toBe("polygon");
    if (out.geometry === "polygon") {
      expect(out.points).toEqual([
        [3, 7],
        [13, 7],
        [13, 17],
      ]);
    }
  });

  it("leaves a polygon unchanged for a non-move handle", () => {
    expect(computeDraggedSegment(poly, "x1y1", 1, 2, 0, 0)).toBe(poly);
  });
});

describe("pointInPolygon", () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it("returns true for an interior point", () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
  });

  it("returns false for an exterior point", () => {
    expect(pointInPolygon([15, 5], square)).toBe(false);
    expect(pointInPolygon([-1, 5], square)).toBe(false);
  });

  it("handles a concave polygon's notch", () => {
    // L-shaped polygon; the top-right quadrant (x>4, y>4) is the notch
    // cut out of the square. Test points avoid vertex y-values so the
    // even-odd ray cast is unambiguous.
    const lshape: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ];
    expect(pointInPolygon([2, 2], lshape)).toBe(true);
    expect(pointInPolygon([2, 8], lshape)).toBe(true);
    expect(pointInPolygon([8, 8], lshape)).toBe(false);
  });
});

describe("computeDraggedSegment edge resize", () => {
  const rect: ImageRoiSegment = {
    geometry: "rectangle",
    title: "R",
    inverse: false,
    x0: 10,
    y0: 20,
    dx: 30,
    dy: 40,
  };

  it("moves only the left edge for the x0 handle", () => {
    // Left edge from x=10 dragged to x=4; right edge (40) fixed.
    const out = computeDraggedSegment(rect, "x0", 4, 0, 10, 20);
    expect(out).toMatchObject({ x0: 4, dx: 36, y0: 20, dy: 40 });
  });

  it("moves only the right edge for the x1 handle", () => {
    const out = computeDraggedSegment(rect, "x1", 50, 0, 40, 20);
    expect(out).toMatchObject({ x0: 10, dx: 40, y0: 20, dy: 40 });
  });

  it("moves only the bottom edge for the y0 handle", () => {
    const out = computeDraggedSegment(rect, "y0", 0, 15, 10, 20);
    expect(out).toMatchObject({ x0: 10, dx: 30, y0: 15, dy: 45 });
  });

  it("moves only the top edge for the y1 handle", () => {
    const out = computeDraggedSegment(rect, "y1", 0, 70, 10, 60);
    expect(out).toMatchObject({ x0: 10, dx: 30, y0: 20, dy: 50 });
  });
});

describe("roiHitTest", () => {
  const rect: ImageRoiSegment = {
    geometry: "rectangle",
    title: "",
    inverse: false,
    x0: 10,
    y0: 20,
    dx: 30,
    dy: 40,
  };
  const circle: ImageRoiSegment = {
    geometry: "circle",
    title: "",
    inverse: false,
    xc: 50,
    yc: 60,
    r: 5,
  };

  it("returns null on a miss", () => {
    expect(roiHitTest([rect], 100, 100, 0.5, 0.5)).toBeNull();
  });

  it("hits the interior as a move", () => {
    expect(roiHitTest([rect], 25, 40, 0.5, 0.5)).toEqual({
      index: 0,
      handle: "move",
    });
  });

  it("hits a corner as a corner resize", () => {
    expect(roiHitTest([rect], 10, 20, 0.5, 0.5)).toEqual({
      index: 0,
      handle: "x0y0",
    });
  });

  it("hits an edge (not a corner) as an edge resize", () => {
    // On the left edge, mid-height → x0 (not a corner).
    expect(roiHitTest([rect], 10, 40, 0.5, 0.5)).toEqual({
      index: 0,
      handle: "x0",
    });
  });

  it("hits the circle ring as a radius resize and the centre as a move", () => {
    expect(roiHitTest([circle], 55, 60, 0.5, 0.5)).toEqual({
      index: 0,
      handle: "radius",
    });
    expect(roiHitTest([circle], 50, 60, 0.5, 0.5)).toEqual({
      index: 0,
      handle: "move",
    });
  });

  it("returns the topmost (last-drawn) ROI when shapes overlap", () => {
    const a = { ...rect };
    const b = { ...rect, x0: 20 };
    // Point (30,40) is inside both; the second (index 1) is on top.
    expect(roiHitTest([a, b], 30, 40, 0.5, 0.5)?.index).toBe(1);
  });
});

describe("resizeCursor", () => {
  it("maps move and edge handles", () => {
    expect(resizeCursor("move", true, true)).toBe("move");
    expect(resizeCursor("x0", true, true)).toBe("ew-resize");
    expect(resizeCursor("x1", true, false)).toBe("ew-resize");
    expect(resizeCursor("y0", true, true)).toBe("ns-resize");
    expect(resizeCursor("y1", true, false)).toBe("ns-resize");
    expect(resizeCursor("radius", true, true)).toBe("nwse-resize");
  });

  it("gives screen-correct diagonal cursors for an inverted Y image", () => {
    // Image axes: x increases rightward, y increases downward on screen.
    // Data corner x0y0 (left, smaller y) sits at screen top-left → nwse.
    expect(resizeCursor("x0y0", true, true)).toBe("nwse-resize");
    expect(resizeCursor("x1y1", true, true)).toBe("nwse-resize");
    expect(resizeCursor("x1y0", true, true)).toBe("nesw-resize");
    expect(resizeCursor("x0y1", true, true)).toBe("nesw-resize");
  });

  it("flips the diagonal when the Y axis is not inverted", () => {
    expect(resizeCursor("x0y0", true, false)).toBe("nesw-resize");
    expect(resizeCursor("x1y0", true, false)).toBe("nwse-resize");
  });
});
