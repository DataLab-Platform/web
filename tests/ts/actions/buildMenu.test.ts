import { describe, it, expect } from "vitest";
import {
  buildMenuTree,
  flattenMenuLeaves,
} from "../../../src/actions/buildMenu";
import type { ActionDescriptor } from "../../../src/actions/types";

const noop = () => undefined;

function action(id: string, menuPath: string): ActionDescriptor {
  return { id, label: id, menuPath, enabled: () => true, run: noop };
}

function actionWithGroup(
  id: string,
  menuPath: string,
  beginGroup: boolean,
): ActionDescriptor {
  return {
    id,
    label: id,
    menuPath,
    beginGroup,
    enabled: () => true,
    run: noop,
  };
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
    const tree = buildMenuTree([action("x", "Processing/Fitting/Polynomial")]);
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

  it("propagates the first child leaf's beginGroup to its folder", () => {
    const tree = buildMenuTree([
      action("centroid", "Analysis/Centroid"),
      actionWithGroup("dog", "Analysis/Blob detection/DOG", true),
      actionWithGroup("doh", "Analysis/Blob detection/DOH", false),
    ]);
    const analysis = tree.find((n) => n.label === "Analysis");
    const blob = analysis?.children?.find((c) => c.label === "Blob detection");
    expect(blob?.beginGroup).toBe(true);
    expect(blob?.children).toHaveLength(2);
  });

  it("leaves folder beginGroup unset when the first child has none", () => {
    const tree = buildMenuTree([
      actionWithGroup("dog", "Analysis/Blob detection/DOG", false),
    ]);
    const analysis = tree.find((n) => n.label === "Analysis");
    const blob = analysis?.children?.find((c) => c.label === "Blob detection");
    expect(blob?.beginGroup).toBeFalsy();
  });
});

describe("flattenMenuLeaves", () => {
  it("returns one entry per leaf with its localised path", () => {
    const tree = buildMenuTree([
      {
        id: "fft",
        label: "FFT",
        menuPath: "Processing/Fourier analysis/FFT",
        enabled: () => true,
        run: noop,
      },
    ]);
    const [entry] = flattenMenuLeaves(tree);
    expect(entry.action.id).toBe("fft");
    expect(entry.label).toBe("FFT");
    expect(entry.parentLabel).toBe("Processing › Fourier analysis");
    expect(entry.pathLabel).toBe("Processing › Fourier analysis › FFT");
  });

  it("includes the path and action id in the search haystack", () => {
    const tree = buildMenuTree([
      {
        id: "fft",
        label: "FFT",
        menuPath: "Processing/FFT",
        enabled: () => true,
        run: noop,
      },
    ]);
    const [entry] = flattenMenuLeaves(tree);
    expect(entry.searchText).toBe("processing › fft fft");
  });

  it("emits one entry for every leaf across folders", () => {
    const tree = buildMenuTree([
      action("open", "File/Open"),
      action("fft", "Processing/Fourier analysis/FFT"),
      action("about", "Help/About"),
    ]);
    const entries = flattenMenuLeaves(tree);
    expect(entries.map((e) => e.action.id).sort()).toEqual([
      "about",
      "fft",
      "open",
    ]);
  });

  it("leaves parentLabel empty for a top-level leaf without folder", () => {
    // A menuPath with a single segment yields a top-level leaf.
    const tree = buildMenuTree([
      {
        id: "solo",
        label: "Solo",
        menuPath: "Solo",
        enabled: () => true,
        run: noop,
      },
    ]);
    const entries = flattenMenuLeaves(tree);
    expect(entries).toHaveLength(1);
    expect(entries[0].parentLabel).toBe("");
    expect(entries[0].pathLabel).toBe("Solo");
  });
});
