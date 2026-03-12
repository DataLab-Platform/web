/** Generic action descriptor used by the menu bar.
 *
 * Mirrors (in spirit) the desktop DataLab `ActionHandler` model:
 * each user-facing operation is a registered action with a stable id,
 * a hierarchical menu path, and an `enabled(state)` predicate.
 */

export type AppStatus = "loading" | "ready" | "error";

export interface ActionState {
  status: AppStatus;
  busy: boolean;
  selectedIds: string[];
  currentId: string | null;
  hasObjects: boolean;
}

export interface ActionDescriptor {
  id: string;
  label: string;
  /** Slash-separated path, e.g. "Operations/Constant/Add constant…". */
  menuPath: string;
  shortcut?: string;
  /** Insert a separator *before* this item when rendered. */
  beginGroup?: boolean;
  /** Optional URL to an SVG/PNG icon shown next to the label. */
  iconUrl?: string;
  enabled: (state: ActionState) => boolean;
  run: () => void | Promise<void>;
}

export interface MenuNode {
  label: string;
  /** Path of *this* node (parent path joined with label). */
  path: string;
  /** Present when the node is a leaf bound to an action. */
  action?: ActionDescriptor;
  /** Present when the node has child entries (submenu). */
  children?: MenuNode[];
  /** Optional icon URL shown next to the label. */
  iconUrl?: string;
}

/** Top-level menu ordering, matching DataLab desktop conventions. */
export const TOP_LEVEL_ORDER = [
  "File",
  "Edit",
  "Create",
  "Operations",
  "Processing",
  "Analysis",
  "View",
  "Help",
];
