/**
 * Tests for :class:`MultiImagePlot` — the read-only grid shown when
 * several images are selected on the image panel.
 *
 * Regression: each grid cell is keyed by the image's object id. When the
 * incoming ``images`` list contains a duplicate id (e.g. a group whose
 * ``object_ids`` got a duplicate, surfaced through ``navigateToGroup`` →
 * ``selectedIds`` → ``extraImages``), React logged "Encountered two
 * children with the same key" and the colliding subtree drove a
 * "Maximum update depth exceeded" loop. The grid must render one cell
 * per unique id and emit no duplicate-key warning.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { MultiImagePlot } from "../../../src/components/MultiImagePlot";
import type { ImageData } from "../../../src/runtime/runtime";

function makeImage(id: string, title: string): ImageData {
  return {
    id,
    title,
    width: 2,
    height: 2,
    data: [
      [0, 1],
      [2, 3],
    ],
    dtype: "float64",
    x0: 0,
    y0: 0,
    dx: 1,
    dy: 1,
    data_min: 0,
    data_max: 3,
    xlabel: "x",
    ylabel: "y",
    zlabel: "z",
    xunit: "",
    yunit: "",
    zunit: "",
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MultiImagePlot", () => {
  it("renders one cell per image when all ids are unique", () => {
    const images = [
      makeImage("aaaaaaaa", "A"),
      makeImage("bbbbbbbb", "B"),
      makeImage("cccccccc", "C"),
    ];
    const { container } = render(
      <MultiImagePlot images={images} totalSelected={3} />,
    );
    expect(container.querySelectorAll(".multi-image-cell")).toHaveLength(3);
  });

  it("dedupes a duplicate image id and emits no duplicate-key warning", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // ``cccccccc`` appears twice (the failure mode: a duplicate object id
    // reaching the grid). Without the guard React would key two cells the
    // same and warn.
    const images = [
      makeImage("aaaaaaaa", "A"),
      makeImage("bbbbbbbb", "B"),
      makeImage("cccccccc", "C"),
      makeImage("cccccccc", "C (dup)"),
    ];
    const { container } = render(
      <MultiImagePlot images={images} totalSelected={4} />,
    );
    // Three unique ids → three cells (the duplicate is dropped).
    expect(container.querySelectorAll(".multi-image-cell")).toHaveLength(3);
    const sameKeyWarning = errorSpy.mock.calls.some((args) =>
      args.some((a) => typeof a === "string" && a.includes("same key")),
    );
    expect(sameKeyWarning).toBe(false);
  });
});
