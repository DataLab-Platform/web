import type { ActionDescriptor, MenuNode } from "./types";
import { TOP_LEVEL_ORDER } from "./types";

/** Build a hierarchical menu tree from a flat list of action descriptors.
 *
 * Each action's `menuPath` is split on `/`; intermediate segments become
 * submenu folders, the last segment becomes a leaf bound to the action.
 *
 * Top-level entries are sorted following `TOP_LEVEL_ORDER`; everything else
 * keeps insertion order.
 */
export function buildMenuTree(actions: ActionDescriptor[]): MenuNode[] {
  const root: MenuNode = { label: "", path: "", children: [] };

  const findOrCreateFolder = (parent: MenuNode, label: string): MenuNode => {
    parent.children = parent.children ?? [];
    let node = parent.children.find(
      (c) => c.label === label && c.children !== undefined && !c.action,
    );
    if (!node) {
      const path = parent.path ? `${parent.path}/${label}` : label;
      node = { label, path, children: [] };
      parent.children.push(node);
    }
    return node;
  };

  for (const action of actions) {
    const parts = action.menuPath.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let parent = root;
    for (let i = 0; i < parts.length - 1; i++) {
      parent = findOrCreateFolder(parent, parts[i]);
    }
    parent.children = parent.children ?? [];
    parent.children.push({
      label: parts[parts.length - 1],
      path: action.menuPath,
      action,
    });
  }

  // Sort top-level entries to match DataLab desktop conventions.
  root.children?.sort((a, b) => {
    const ia = TOP_LEVEL_ORDER.indexOf(a.label);
    const ib = TOP_LEVEL_ORDER.indexOf(b.label);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.label.localeCompare(b.label);
  });

  return root.children ?? [];
}
