import type { ActionDescriptor, ToolbarItem } from "./types";
import { TOOLBAR_GROUP_ORDER } from "./types";

/** Build the ordered list of general-toolbar items from a flat list of
 *  action descriptors.
 *
 * Only actions flagged with ``toolbar: true`` are kept. They are laid out
 * by group (following {@link TOOLBAR_GROUP_ORDER}; unknown groups come
 * last, alphabetically) and, within a group, by ``toolbarOrder`` ascending
 * (ties keep registry insertion order). A ``separator`` item is inserted
 * between two consecutive groups — never leading or trailing.
 *
 * The toolbar is an additional view of the same action registry that feeds
 * the menu bar, mirroring DataLab desktop's ``PANEL_TOOLBAR``.
 */
export function buildToolbarItems(actions: ActionDescriptor[]): ToolbarItem[] {
  const candidates = actions.filter((a) => a.toolbar);

  const groupRank = (group: string | undefined): number => {
    const idx = TOOLBAR_GROUP_ORDER.indexOf(group ?? "");
    return idx === -1 ? TOOLBAR_GROUP_ORDER.length : idx;
  };

  // Stable decorate-sort-undecorate: preserve registry insertion order for
  // ties on (group rank, toolbarOrder).
  const decorated = candidates.map((action, index) => ({ action, index }));
  const unknownRank = TOOLBAR_GROUP_ORDER.length;
  decorated.sort((a, b) => {
    const ga = groupRank(a.action.toolbarGroup);
    const gb = groupRank(b.action.toolbarGroup);
    if (ga !== gb) return ga - gb;
    // Same rank: for unknown groups, order them alphabetically by key so
    // distinct unknown groups stay contiguous and deterministically placed.
    if (ga === unknownRank) {
      const cmp = (a.action.toolbarGroup ?? "").localeCompare(
        b.action.toolbarGroup ?? "",
      );
      if (cmp !== 0) return cmp;
    }
    const oa = a.action.toolbarOrder ?? 0;
    const ob = b.action.toolbarOrder ?? 0;
    if (oa !== ob) return oa - ob;
    return a.index - b.index;
  });

  const items: ToolbarItem[] = [];
  let prevGroup: string | undefined;
  let first = true;
  for (const { action } of decorated) {
    if (!first && action.toolbarGroup !== prevGroup) {
      items.push({ kind: "separator" });
    }
    items.push({ kind: "action", action });
    prevGroup = action.toolbarGroup;
    first = false;
  }
  return items;
}
