import { resolveSubmenuIcon } from "./submenuIcons";
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
      node = { label, path, children: [], iconUrl: resolveSubmenuIcon(path) };
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

/**
 * Build the curated context menu for an object in the signal/image
 * tree.
 *
 * The list mirrors DataLab Qt's right-click menu (see desktop
 * screenshots): the most common per-object operations grouped with
 * separators. Action ids referenced here that are not registered are
 * silently skipped, so this helper stays robust as the registry
 * evolves.
 *
 * @param actions Full registry of action descriptors.
 * @param panel Active panel kind, used to expose panel-specific entries
 *  (e.g. image profiles).
 */
export function buildObjectContextMenu(
  actions: ActionDescriptor[],
  panel: "signal" | "image",
): MenuNode[] {
  const byId = new Map(actions.map((a) => [a.id, a] as const));

  // Per-section ids — order is preserved; ``null`` introduces a separator
  // between sections. Items absent from the registry are skipped.
  const sections: (string | null)[] = [
    "view.open_separate_view",
    null,
    "file.save",
    "file.save_to_directory",
    null,
    "edit.rename",
    "edit.new_group",
    "edit.move_up",
    "edit.move_down",
    null,
    "edit.duplicate",
    "edit.delete",
    null,
    "roi.edit_graphical",
    null,
    "edit.properties",
  ];

  // Panel-specific entries appended at the end. Each id is silently
  // skipped if not registered (typically because the underlying Sigima
  // catalogue entry is missing).
  if (panel === "signal") {
    sections.push(
      null,
      "analysis.signal.stats",
      "feature.histogram",
      "analysis.signal.dynamic_parameters",
      "analysis.signal.bandwidth_3db",
    );
  } else {
    sections.push(
      null,
      "feature.image:fliph",
      "feature.image:transpose",
      "feature.image:flipv",
      "feature.image:rotate90",
      "feature.image:rotate270",
      null,
      "analysis.image.stats",
      "feature.image:histogram",
      null,
      "feature.image:line_profile",
      "feature.image:segment_profile",
      "feature.image:average_profile",
    );
  }

  const nodes: MenuNode[] = [];
  let pendingSeparator = false;
  for (const id of sections) {
    if (id === null) {
      // Defer separator emission to the next leaf to avoid trailing/
      // leading separators when a whole section is missing.
      pendingSeparator = nodes.length > 0;
      continue;
    }
    const action = byId.get(id);
    if (!action) continue;
    const node: MenuNode = {
      label: action.label,
      path: action.menuPath,
      action: pendingSeparator ? { ...action, beginGroup: true } : action,
      iconUrl: action.iconUrl,
    };
    nodes.push(node);
    pendingSeparator = false;
  }
  return nodes;
}
