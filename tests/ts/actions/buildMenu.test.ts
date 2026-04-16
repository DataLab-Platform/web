import { describe, it, expect } from "vitest";
import { buildMenuTree } from "../../../src/actions/buildMenu";
import type { ActionDescriptor } from "../../../src/actions/types";

const noop = () => undefined;

function action(id: string, menuPath: string): ActionDescriptor {
  return { id, label: id, menuPath, enabled: () => true, run: noop };
}

describe("buildMenuTree", () => {
  it("returns an empty list for no actions", () => {
    expect(buildMenuTree([])).toEqual([]);
  });

  it("creates a single leaf for a top-level action", () => {
    const tree = buildMenuTree([action("a", "Help/About")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].label).toBe("Help");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children?.[0].action?.id).toBe("a");
  });

  it("groups siblings under the same folder", () => {
    const tree = buildMenuTree([
      action("a", "Edit/Delete"),
      action("b", "Edit/Properties"),
    ]);
    const editNode = tree.find((n) => n.label === "Edit");
    expect(editNode?.children).toHaveLength(2);
  });

  it("nests folders for multi-segment paths", () => {
    const tree = buildMenuTree([
      action("x", "Processing/Fitting/Polynomial"),
    ]);
    const processing = tree.find((n) => n.label === "Processing");
    const fitting = processing?.children?.find((c) => c.label === "Fitting");
    expect(fitting?.children?.[0].action?.id).toBe("x");
  });

  it("orders top-level entries according to TOP_LEVEL_ORDER", () => {
    const tree = buildMenuTree([
      action("h", "Help/About"),
      action("f", "File/Open"),
      action("e", "Edit/Delete"),
    ]);
    expect(tree.map((n) => n.label)).toEqual(["File", "Edit", "Help"]);
  });

  it("falls back to alphabetical ordering for unknown top-level entries", () => {
    const tree = buildMenuTree([
      action("z", "Zoo/Item"),
      action("a", "Aardvark/Item"),
    ]);
    expect(tree.map((n) => n.label)).toEqual(["Aardvark", "Zoo"]);
  });

  it("ignores empty path segments", () => {
    const tree = buildMenuTree([action("nope", "")]);
    expect(tree).toEqual([]);
  });
});
