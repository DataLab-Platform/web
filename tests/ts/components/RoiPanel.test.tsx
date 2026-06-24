/**
 * Tests for :class:`RoiPanel` — the non-modal ROI editor that replaced
 * the old full-screen modal dialogs.  Focuses on the ergonomic
 * invariants we care about:
 *
 *  - a single compact list with one row per ROI;
 *  - numeric "Add" appends a segment and selects it;
 *  - selecting a row reveals a form editing *only* that ROI;
 *  - editing a field emits the full updated array (controlled component);
 *  - the draw buttons arm the matching plot geometry;
 *  - removing a row filters it out and fixes the selection.
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";

import { RoiPanel } from "../../../src/components/RoiPanel";
import type {
  SignalRoiSegment,
  ImageRoiSegment,
} from "../../../src/runtime/runtime";

const BOUNDS = { xMin: 0, xMax: 10, yMin: 0, yMax: 20 };

function noop() {}

function renderSignal(
  roi: SignalRoiSegment[],
  overrides: Partial<Parameters<typeof RoiPanel>[0]> = {},
) {
  const props = {
    kind: "signal" as const,
    signalRoi: roi,
    imageRoi: [] as ImageRoiSegment[],
    bounds: BOUNDS,
    selectedIndex: null as number | null,
    onSelect: vi.fn(),
    onSignalChange: vi.fn(),
    onImageChange: vi.fn(),
    onRequestDraw: vi.fn(),
    activeDraw: null,
    onRemoveAll: noop,
    onClose: noop,
    ...overrides,
  };
  return { props, ...render(<RoiPanel {...props} />) };
}

function renderImage(
  roi: ImageRoiSegment[],
  overrides: Partial<Parameters<typeof RoiPanel>[0]> = {},
) {
  const props = {
    kind: "image" as const,
    signalRoi: [] as SignalRoiSegment[],
    imageRoi: roi,
    bounds: BOUNDS,
    selectedIndex: null as number | null,
    onSelect: vi.fn(),
    onSignalChange: vi.fn(),
    onImageChange: vi.fn(),
    onRequestDraw: vi.fn(),
    activeDraw: null,
    onRemoveAll: noop,
    onClose: noop,
    ...overrides,
  };
  return { props, ...render(<RoiPanel {...props} />) };
}

describe("RoiPanel — signal", () => {
  it("shows the empty hint when no ROI exists", () => {
    const { container } = renderSignal([]);
    expect(container.querySelector(".roi-list")).toBeNull();
    expect(container.querySelector(".roi-panel-empty")).not.toBeNull();
  });

  it("renders one list row per ROI with a default label", () => {
    const { container } = renderSignal([
      { xmin: 1, xmax: 2 },
      { xmin: 3, xmax: 4, title: "peak" },
    ]);
    const items = container.querySelectorAll(".roi-list-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("ROI1");
    expect(items[1].textContent).toContain("peak");
  });

  it("numeric Add appends a segment and selects the new index", () => {
    const { props, getByText } = renderSignal([{ xmin: 1, xmax: 2 }]);
    fireEvent.click(getByText("+ Add"));
    expect(props.onSignalChange).toHaveBeenCalledTimes(1);
    const next = props.onSignalChange.mock.calls[0][0] as SignalRoiSegment[];
    expect(next).toHaveLength(2);
    expect(props.onSelect).toHaveBeenCalledWith(1);
  });

  it("clicking a row selects it", () => {
    const { props, container } = renderSignal([
      { xmin: 1, xmax: 2 },
      { xmin: 3, xmax: 4 },
    ]);
    const items = container.querySelectorAll(".roi-list-item");
    fireEvent.click(items[1]);
    expect(props.onSelect).toHaveBeenCalledWith(1);
  });

  it("renders a form for the selected ROI and edits emit the full array", () => {
    const roi: SignalRoiSegment[] = [
      { xmin: 1, xmax: 2 },
      { xmin: 3, xmax: 4 },
    ];
    const { props, container } = renderSignal(roi, { selectedIndex: 1 });
    const form = container.querySelector(".roi-form") as HTMLElement;
    expect(form).not.toBeNull();
    const xmin = within(form).getByDisplayValue("3") as HTMLInputElement;
    fireEvent.change(xmin, { target: { value: "3.5" } });
    expect(props.onSignalChange).toHaveBeenCalledTimes(1);
    const next = props.onSignalChange.mock.calls[0][0] as SignalRoiSegment[];
    expect(next[1].xmin).toBe(3.5);
    expect(next[0].xmin).toBe(1); // untouched ROI preserved
  });

  it("the Draw range button arms the segment geometry", () => {
    const { props, getByTitle } = renderSignal([]);
    fireEvent.click(getByTitle("Draw a range on the plot"));
    expect(props.onRequestDraw).toHaveBeenCalledWith("segment");
  });

  it("removing a row filters it and clears the selection when it was active", () => {
    const roi: SignalRoiSegment[] = [
      { xmin: 1, xmax: 2 },
      { xmin: 3, xmax: 4 },
    ];
    const { props, container } = renderSignal(roi, { selectedIndex: 1 });
    const items = container.querySelectorAll(".roi-list-item");
    const removeBtn = within(items[1] as HTMLElement).getByLabelText("Remove");
    fireEvent.click(removeBtn);
    const next = props.onSignalChange.mock.calls[0][0] as SignalRoiSegment[];
    expect(next).toHaveLength(1);
    expect(next[0].xmax).toBe(2);
    expect(props.onSelect).toHaveBeenCalledWith(null);
  });
});

describe("RoiPanel — image", () => {
  it("labels list rows by geometry", () => {
    const { container } = renderImage([
      { geometry: "rectangle", x0: 0, y0: 0, dx: 1, dy: 1 },
      { geometry: "circle", xc: 2, yc: 2, r: 1 },
    ]);
    const items = container.querySelectorAll(".roi-list-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Rectangle");
    expect(items[1].textContent).toContain("Circle");
  });

  it("draw buttons arm rectangle / circle / polygon geometries", () => {
    const { props, getByTitle } = renderImage([]);
    fireEvent.click(getByTitle("Draw a rectangle on the plot"));
    fireEvent.click(getByTitle("Draw a circle on the plot"));
    fireEvent.click(getByTitle("Draw a polygon on the plot"));
    expect(props.onRequestDraw).toHaveBeenNthCalledWith(1, "rectangle");
    expect(props.onRequestDraw).toHaveBeenNthCalledWith(2, "circle");
    expect(props.onRequestDraw).toHaveBeenNthCalledWith(3, "polygon");
  });

  it("editing a circle radius emits the updated segment", () => {
    const roi: ImageRoiSegment[] = [{ geometry: "circle", xc: 2, yc: 2, r: 1 }];
    const { props, container } = renderImage(roi, { selectedIndex: 0 });
    const form = container.querySelector(".roi-form") as HTMLElement;
    const radius = within(form).getByDisplayValue("1") as HTMLInputElement;
    fireEvent.change(radius, { target: { value: "3" } });
    const next = props.onImageChange.mock.calls[0][0] as ImageRoiSegment[];
    expect(next[0]).toMatchObject({ geometry: "circle", r: 3 });
  });

  it("toggling the Inverse checkbox emits the updated segment", () => {
    const roi: ImageRoiSegment[] = [
      { geometry: "rectangle", x0: 0, y0: 0, dx: 1, dy: 1 },
    ];
    const { props, getByLabelText } = renderImage(roi, { selectedIndex: 0 });
    fireEvent.click(getByLabelText("Inverse"));
    const next = props.onImageChange.mock.calls[0][0] as ImageRoiSegment[];
    expect(next[0].inverse).toBe(true);
  });
});

describe("RoiPanel — polygon vertex table", () => {
  const poly: ImageRoiSegment[] = [
    {
      geometry: "polygon",
      points: [
        [0, 0],
        [10, 0],
        [5, 8],
      ],
    },
  ];

  it("renders one editable row per vertex (no textarea)", () => {
    const { container } = renderImage(poly, { selectedIndex: 0 });
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelectorAll(".roi-poly-row").length).toBe(4); // header + 3
  });

  it("editing a vertex cell emits the full updated point array", () => {
    const { props, getByLabelText } = renderImage(poly, { selectedIndex: 0 });
    fireEvent.change(getByLabelText("Vertex 2 X"), { target: { value: "12" } });
    const next = props.onImageChange.mock.calls.at(-1)![0] as ImageRoiSegment[];
    expect(next[0]).toMatchObject({
      geometry: "polygon",
      points: [
        [0, 0],
        [12, 0],
        [5, 8],
      ],
    });
  });

  it("a transiently invalid cell keeps the vertex count stable", () => {
    const { props, getByLabelText } = renderImage(poly, { selectedIndex: 0 });
    fireEvent.change(getByLabelText("Vertex 3 Y"), { target: { value: "-" } });
    const next = props.onImageChange.mock.calls.at(-1)![0] as ImageRoiSegment[];
    // Still 3 vertices; the unparseable Y falls back to its previous value.
    if (next[0].geometry !== "polygon") throw new Error("expected polygon");
    expect(next[0].points).toHaveLength(3);
    expect(next[0].points[2]).toEqual([5, 8]);
  });

  it("Add vertex appends a row", () => {
    const { props, getByTitle } = renderImage(poly, { selectedIndex: 0 });
    fireEvent.click(getByTitle("Add a vertex"));
    const next = props.onImageChange.mock.calls.at(-1)![0] as ImageRoiSegment[];
    if (next[0].geometry !== "polygon") throw new Error("expected polygon");
    expect(next[0].points).toHaveLength(4);
  });

  it("Add vertex with no cell focused appends on the closing edge", () => {
    const { props, getByTitle } = renderImage(poly, { selectedIndex: 0 });
    fireEvent.click(getByTitle("Add a vertex"));
    const next = props.onImageChange.mock.calls.at(-1)![0] as ImageRoiSegment[];
    if (next[0].geometry !== "polygon") throw new Error("expected polygon");
    // Appended at the end, midpoint of last (5,8) → first (0,0) = (2.5,4).
    expect(next[0].points).toEqual([
      [0, 0],
      [10, 0],
      [5, 8],
      [2.5, 4],
    ]);
  });

  it("Add vertex while editing a cell inserts before that vertex", () => {
    const { props, getByLabelText, getByTitle } = renderImage(poly, {
      selectedIndex: 0,
    });
    // Focus vertex 2 (index 1), then add → new vertex inserted before it,
    // on the edge from vertex 1 (0,0) to vertex 2 (10,0) → midpoint (5,0).
    fireEvent.focus(getByLabelText("Vertex 2 X"));
    fireEvent.click(getByTitle("Add a vertex"));
    const next = props.onImageChange.mock.calls.at(-1)![0] as ImageRoiSegment[];
    if (next[0].geometry !== "polygon") throw new Error("expected polygon");
    expect(next[0].points).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
      [5, 8],
    ]);
  });

  it("reports the focused vertex index, then null on blur", () => {
    const onActiveVertexChange = vi.fn();
    const { getByLabelText } = renderImage(poly, {
      selectedIndex: 0,
      onActiveVertexChange,
    });
    fireEvent.focus(getByLabelText("Vertex 3 Y"));
    expect(onActiveVertexChange).toHaveBeenLastCalledWith(2);
    fireEvent.blur(getByLabelText("Vertex 3 Y"));
    expect(onActiveVertexChange).toHaveBeenLastCalledWith(null);
  });

  it("remove buttons are disabled at the 3-vertex minimum", () => {
    const { container } = renderImage(poly, { selectedIndex: 0 });
    const removes = container.querySelectorAll(
      ".roi-poly-remove",
    ) as NodeListOf<HTMLButtonElement>;
    expect(removes).toHaveLength(3);
    expect([...removes].every((b) => b.disabled)).toBe(true);
  });

  it("a 4th vertex enables removal back down to 3", () => {
    const poly4: ImageRoiSegment[] = [
      {
        geometry: "polygon",
        points: [
          [0, 0],
          [10, 0],
          [10, 8],
          [0, 8],
        ],
      },
    ];
    const { props, container } = renderImage(poly4, { selectedIndex: 0 });
    const removes = container.querySelectorAll(
      ".roi-poly-remove",
    ) as NodeListOf<HTMLButtonElement>;
    expect([...removes].every((b) => !b.disabled)).toBe(true);
    fireEvent.click(removes[1]);
    const next = props.onImageChange.mock.calls.at(-1)![0] as ImageRoiSegment[];
    if (next[0].geometry !== "polygon") throw new Error("expected polygon");
    expect(next[0].points).toEqual([
      [0, 0],
      [10, 8],
      [0, 8],
    ]);
  });
});

describe("RoiPanel — title & primary action (erase session)", () => {
  it("renders a custom title and a primary action button", () => {
    const onClick = vi.fn();
    const { getByText } = renderImage(
      [{ geometry: "rectangle", x0: 0, y0: 0, dx: 1, dy: 1 }],
      {
        selectedIndex: 0,
        title: "Erase area",
        primaryAction: { label: "Erase", onClick },
      },
    );
    expect(getByText("Erase area")).toBeTruthy();
    fireEvent.click(getByText("Erase"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows the primary action even when no region exists yet", () => {
    const { getByText } = renderImage([], {
      primaryAction: { label: "Erase", onClick: () => {} },
    });
    expect(getByText("Erase")).toBeTruthy();
  });
});
