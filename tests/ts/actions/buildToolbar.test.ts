import { describe, it, expect } from "vitest";
import { buildToolbarItems } from "../../../src/actions/buildToolbar";
import type { ActionDescriptor, ToolbarItem } from "../../../src/actions/types";

const noop = () => undefined;

function action(
  id: string,
  opts: Partial<ActionDescriptor> = {},
): ActionDescriptor {
  return {
    id,
    label: id,
    menuPath: `Menu/${id}`,
    enabled: () => true,
    run: noop,
    ...opts,
  };
}

/** Extract the action ids from toolbar items, using "|" for separators. */
function ids(items: ToolbarItem[]): string {
  return items
    .map((it) => (it.kind === "separator" ? "|" : it.action.id))
    .join(",");
}

describe("buildToolbarItems", () => {
  it("returns an empty list when no action opts in", () => {
    expect(buildToolbarItems([action("a"), action("b")])).toEqual([]);
  });

  it("keeps only actions flagged with toolbar:true", () => {
    const items = buildToolbarItems([
      action("a", { toolbar: true, toolbarGroup: "file" }),
      action("b"),
      action("c", { toolbar: true, toolbarGroup: "file" }),
    ]);
    expect(ids(items)).toBe("a,c");
  });

  it("orders within a group by toolbarOrder ascending", () => {
    const items = buildToolbarItems([
      action("b", { toolbar: true, toolbarGroup: "file", toolbarOrder: 2 }),
      action("a", { toolbar: true, toolbarGroup: "file", toolbarOrder: 0 }),
      action("c", { toolbar: true, toolbarGroup: "file", toolbarOrder: 1 }),
    ]);
    expect(ids(items)).toBe("a,c,b");
  });

  it("lays out groups following TOOLBAR_GROUP_ORDER", () => {
    const items = buildToolbarItems([
      action("m", { toolbar: true, toolbarGroup: "metadata" }),
      action("f", { toolbar: true, toolbarGroup: "file" }),
      action("e", { toolbar: true, toolbarGroup: "edit" }),
    ]);
    expect(ids(items)).toBe("f,|,e,|,m");
  });

  it("reproduces the full desktop PANEL_TOOLBAR layout", () => {
    // One representative action per group, shuffled; the helper must
    // restore the desktop order with a separator between each group,
    // including the metadata sub-groups (copy/paste | add/import/export |
    // delete) and the trailing ROI group.
    const items = buildToolbarItems([
      action("roi", { toolbar: true, toolbarGroup: "roi" }),
      action("del", { toolbar: true, toolbarGroup: "metadata-del" }),
      action("h5", { toolbar: true, toolbarGroup: "file-h5" }),
      action("meta", { toolbar: true, toolbarGroup: "metadata" }),
      action("edit", { toolbar: true, toolbarGroup: "edit" }),
      action("metaedit", { toolbar: true, toolbarGroup: "metadata-edit" }),
      action("file", { toolbar: true, toolbarGroup: "file" }),
    ]);
    expect(ids(items)).toBe("h5,|,file,|,edit,|,meta,|,metaedit,|,del,|,roi");
  });

  it("inserts a separator only between groups (never leading/trailing)", () => {
    const items = buildToolbarItems([
      action("f1", { toolbar: true, toolbarGroup: "file", toolbarOrder: 0 }),
      action("f2", { toolbar: true, toolbarGroup: "file", toolbarOrder: 1 }),
      action("e1", { toolbar: true, toolbarGroup: "edit", toolbarOrder: 0 }),
    ]);
    expect(ids(items)).toBe("f1,f2,|,e1");
    expect(items[0].kind).toBe("action");
    expect(items[items.length - 1].kind).toBe("action");
  });

  it("keeps registry insertion order for ties", () => {
    const items = buildToolbarItems([
      action("first", { toolbar: true, toolbarGroup: "file" }),
      action("second", { toolbar: true, toolbarGroup: "file" }),
    ]);
    expect(ids(items)).toBe("first,second");
  });

  it("places unknown groups after known ones, alphabetically", () => {
    const items = buildToolbarItems([
      action("z", { toolbar: true, toolbarGroup: "zeta" }),
      action("a", { toolbar: true, toolbarGroup: "alpha" }),
      action("f", { toolbar: true, toolbarGroup: "file" }),
    ]);
    expect(ids(items)).toBe("f,|,a,|,z");
  });
});
