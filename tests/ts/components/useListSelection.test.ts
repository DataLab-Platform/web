import { describe, it, expect } from "vitest";
import { computeListSelection } from "../../../src/components/useListSelection";

const FLAT = ["a", "b", "c", "d", "e"];

describe("computeListSelection", () => {
  it("plain click selects the item alone", () => {
    expect(
      computeListSelection(FLAT, ["b", "c"], "b", "d", {
        shift: false,
        ctrlOrMeta: false,
      }),
    ).toEqual({ ids: ["d"], current: "d" });
  });

  it("shift-click extends a forward range from current", () => {
    expect(
      computeListSelection(FLAT, ["b"], "b", "d", {
        shift: true,
        ctrlOrMeta: false,
      }),
    ).toEqual({ ids: ["b", "c", "d"], current: "d" });
  });

  it("shift-click extends a backward range from current", () => {
    expect(
      computeListSelection(FLAT, ["d"], "d", "b", {
        shift: true,
        ctrlOrMeta: false,
      }),
    ).toEqual({ ids: ["b", "c", "d"], current: "b" });
  });

  it("shift without a current id falls back to single select", () => {
    expect(
      computeListSelection(FLAT, [], null, "c", {
        shift: true,
        ctrlOrMeta: false,
      }),
    ).toEqual({ ids: ["c"], current: "c" });
  });

  it("ctrl-click adds an item and makes it current", () => {
    expect(
      computeListSelection(FLAT, ["a"], "a", "c", {
        shift: false,
        ctrlOrMeta: true,
      }),
    ).toEqual({ ids: ["a", "c"], current: "c" });
  });

  it("ctrl-click toggles an already-selected item off, keeping current", () => {
    expect(
      computeListSelection(FLAT, ["a", "c"], "c", "c", {
        shift: false,
        ctrlOrMeta: true,
      }),
    ).toEqual({ ids: ["a"], current: "c" });
  });
});
