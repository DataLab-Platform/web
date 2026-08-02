import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { DialogProvider } from "../../../src/components/ConfirmDialog";
import { ObjectTree } from "../../../src/components/ObjectTree";
import type {
  ObjectNode,
  PanelKind,
  PanelTree,
} from "../../../src/runtime/runtime";

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
const scrollIntoView = vi.fn();

function makeObject(id: string, kind: PanelKind = "signal"): ObjectNode {
  return {
    id,
    uuid: null,
    title: `Object ${id}`,
    size: 10,
    xlabel: "",
    ylabel: "",
    xunit: "",
    yunit: "",
    kind,
  };
}

function makeTree(ids: string[], kind: PanelKind = "signal"): PanelTree {
  return {
    kind,
    groups: [
      {
        gid: "group-1",
        name: "Group 1",
        objects: ids.map((id) => makeObject(id, kind)),
      },
    ],
  };
}

const handlers = {
  onSelectionChange: vi.fn(),
  onRenameObject: vi.fn(),
  onRenameGroup: vi.fn(),
  onDeleteGroup: vi.fn(),
  onDeleteObjects: vi.fn(),
  onMoveObjects: vi.fn(),
};

function objectTree(tree: PanelTree, currentId: string | null) {
  return (
    <DialogProvider>
      <ObjectTree
        tree={tree}
        selectedIds={currentId ? [currentId] : []}
        currentId={currentId}
        {...handlers}
      />
    </DialogProvider>
  );
}

describe("ObjectTree new-object reveal", () => {
  beforeEach(() => {
    scrollIntoView.mockReset();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterAll(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        originalScrollIntoView,
      );
    } else {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown })
        .scrollIntoView;
    }
  });

  it("scrolls a newly added current object into view", () => {
    const { container, rerender } = render(objectTree(makeTree(["1"]), "1"));

    rerender(objectTree(makeTree(["1", "2"]), "2"));

    const newItem = container.querySelectorAll(".object-tree-item")[1];
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
    expect(scrollIntoView.mock.contexts[0]).toBe(newItem);
  });

  it("does not scroll on the initial render or an existing-object selection", () => {
    const tree = makeTree(["1", "2"]);
    const { rerender } = render(objectTree(tree, "1"));

    expect(scrollIntoView).not.toHaveBeenCalled();

    rerender(objectTree(tree, "2"));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("resets its reference tree when switching panels", () => {
    const { rerender } = render(objectTree(makeTree(["1"]), "1"));

    rerender(objectTree(makeTree(["10"], "image"), "10"));

    expect(scrollIntoView).not.toHaveBeenCalled();

    rerender(objectTree(makeTree(["10", "11"], "image"), "11"));

    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it("prefers the newly added current object when several are added", () => {
    const { container, rerender } = render(objectTree(makeTree(["1"]), "1"));

    rerender(objectTree(makeTree(["1", "2", "3"]), "2"));

    const currentItem = container.querySelectorAll(".object-tree-item")[1];
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(currentItem);
  });

  it("reveals the last added object when the current object is unchanged", () => {
    const { container, rerender } = render(objectTree(makeTree(["1"]), "1"));

    rerender(objectTree(makeTree(["1", "2", "3"]), "1"));

    const lastItem = container.querySelectorAll(".object-tree-item")[2];
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(lastItem);
  });

  it("expands a collapsed target group before scrolling", () => {
    const { container, getByTitle, rerender } = render(
      objectTree(makeTree(["1"]), "1"),
    );
    fireEvent.click(getByTitle("Collapse"));
    expect(container.querySelectorAll(".object-tree-item")).toHaveLength(0);

    rerender(objectTree(makeTree(["1", "2"]), "2"));

    const items = container.querySelectorAll(".object-tree-item");
    expect(items).toHaveLength(2);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(items[1]);
  });
});
