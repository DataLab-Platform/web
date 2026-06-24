import { describe, expect, it } from "vitest";
import {
  buildRoiOverlays,
  parsePolygonPath,
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
