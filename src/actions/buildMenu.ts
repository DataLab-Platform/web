import { resolveSubmenuIcon } from "./submenuIcons";
import type { ActionDescriptor, CommandEntry, MenuNode } from "./types";
import { TOP_LEVEL_ORDER } from "./types";
import { t } from "../i18n/translate";

/** Separator used to render a feature's localised menu path in the
 *  command palette, e.g. "Processing › Fourier analysis › FFT". */
export const COMMAND_PATH_SEPARATOR = " › ";

/** Build a hierarchical menu tree from a flat list of action descriptors.
 *
 * Each action's `menuPath` is split on `/`; intermediate segments become
 * submenu folders, the last segment becomes a leaf bound to the action.
 *
 * Menu structure (folder matching, ordering, node keys) stays in the
 * canonical English `menuPath`; the user-visible text is carried by
 * `displayLabel` — folder segments are translated here, while leaves
 * reuse the (already translated) `action.label`.
 *
 * Top-level entries are sorted following `TOP_LEVEL_ORDER`; everything else
 * keeps insertion order.
 */
export function buildMenuTree(actions: ActionDescriptor[]): MenuNode[] {
  const root: MenuNode = {
    label: "",
    displayLabel: "",
    path: "",
    children: [],
  };

  const findOrCreateFolder = (
    parent: MenuNode,
    label: string,
    beginGroup?: boolean,
  ): MenuNode => {
    parent.children = parent.children ?? [];
    let node = parent.children.find(
      (c) => c.label === label && c.children !== undefined,
    );
    if (!node) {
      const path = parent.path ? `${parent.path}/${label}` : label;
      node = {
        label,
        displayLabel: t(label),
        path,
        children: [],
        iconUrl: resolveSubmenuIcon(path),
        // Propagate the separator request from the first child leaf that
        // creates this folder, so a folder can open a new group just like
        // a leaf does (mirrors DataLab desktop sub-menu separators).
        beginGroup,
      };
      parent.children.push(node);
    }
    return node;
  };

  for (const action of actions) {
    const parts = action.menuPath.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let parent = root;
    for (let i = 0; i < parts.length - 1; i++) {
      // The folder directly containing the leaf inherits the leaf's
      // ``beginGroup`` (only when it is first created).
      const isLeafParent = i === parts.length - 2;
      parent = findOrCreateFolder(
        parent,
        parts[i],
        isLeafParent ? action.beginGroup : undefined,
      );
    }
    parent.children = parent.children ?? [];
    parent.children.push({
      label: parts[parts.length - 1],
      displayLabel: action.label,
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

/** Flatten a localised menu tree into a flat list of executable commands.
 *
 * Walks every leaf of the tree built by {@link buildMenuTree}, recording
 * each action together with the localised path of the menu folders that
 * contain it. This is the data source for the command palette, where a
 * feature is identified by its readable menu path (mirroring how users
 * navigate the menus) rather than by a stable internal id.
 *
 * @param nodes Top-level menu nodes (the result of {@link buildMenuTree}).
 * @returns One {@link CommandEntry} per leaf, in depth-first menu order.
 */
export function flattenMenuLeaves(nodes: MenuNode[]): CommandEntry[] {
  const out: CommandEntry[] = [];
  const walk = (node: MenuNode, ancestors: string[]): void => {
    if (node.action) {
      const parentLabel = ancestors.join(COMMAND_PATH_SEPARATOR);
      const pathLabel = parentLabel
        ? `${parentLabel}${COMMAND_PATH_SEPARATOR}${node.displayLabel}`
        : node.displayLabel;
      out.push({
        action: node.action,
        label: node.displayLabel,
        parentLabel,
        pathLabel,
        searchText: `${pathLabel} ${node.action.id}`.toLowerCase(),
      });
      return;
    }
    if (node.children) {
      const next = node.label ? [...ancestors, node.displayLabel] : ancestors;
      for (const child of node.children) walk(child, next);
    }
  };
  for (const node of nodes) walk(node, []);
  return out;
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
      displayLabel: action.label,
      path: action.menuPath,
      action: pendingSeparator ? { ...action, beginGroup: true } : action,
      iconUrl: action.iconUrl,
    };
    nodes.push(node);
    pendingSeparator = false;
  }
  return nodes;
}
