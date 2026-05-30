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
  /** ``true`` when at least one macro is loaded in the workspace. */
  hasMacros: boolean;
  /** ``true`` when at least one notebook is loaded in the workspace. */
  hasNotebooks: boolean;
}

export interface ActionDescriptor {
  id: string;
  label: string;
  /** Slash-separated path, e.g. "Operations/Constant/Add constant…". */
  menuPath: string;
  /** Insert a separator *before* this item when rendered. */
  beginGroup?: boolean;
  /** Optional URL to an SVG/PNG icon shown next to the label. */
  iconUrl?: string;
  enabled: (state: ActionState) => boolean;
  run: () => void | Promise<void>;
}

export interface MenuNode {
  /** Canonical English structural label (menu-path segment). Used as a
   *  stable key for folder matching, ordering and tests — never shown
   *  to the user directly; render {@link displayLabel} instead. */
  label: string;
  /** Localised label shown in the UI. For folders this is the
   *  translated structural segment; for leaves it is the (already
   *  translated) action label. */
  displayLabel: string;
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
  "Create",
  "Edit",
  "ROI",
  "Operations",
  "Processing",
  "Analysis",
  "View",
  "Plugins",
  "Help",
];
