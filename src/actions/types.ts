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
  /** Number of currently selected groups. Mirrors DataLab desktop's
   *  group selection, which is exclusive with object selection. Used to
   *  reproduce ``SelectCond.exactly_one_group_or_one_object`` (Rename),
   *  where a single selected group counts as one target even though its
   *  child object ids populate ``selectedIds``. */
  selectedGroupCount: number;
  /** ``true`` when at least one macro is loaded in the workspace. */
  hasMacros: boolean;
  /** ``true`` when at least one notebook is loaded in the workspace. */
  hasNotebooks: boolean;
  /** ``true`` when the metadata clipboard holds a payload that
   *  "Paste metadata" can apply. */
  hasMetadataClipboard: boolean;
  /** ``true`` when at least one currently selected object has a region
   *  of interest.  Mirrors DataLab desktop's ``SelectCond.with_roi``,
   *  which enables the ROI "Remove all" action whenever *any* selected
   *  object carries a ROI (not only the displayed one). */
  selectionHasRoi: boolean;
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
  /** When ``true`` the action is also surfaced as an icon button in the
   *  general toolbar (mirrors DataLab desktop's ``PANEL_TOOLBAR``). The
   *  action keeps its menu entry — the toolbar is an additional view of
   *  the same registry. */
  toolbar?: boolean;
  /** Toolbar group key. Buttons of the same group are kept contiguous and
   *  a separator is inserted between consecutive groups. Groups are laid
   *  out following {@link TOOLBAR_GROUP_ORDER}; unknown groups go last. */
  toolbarGroup?: string;
  /** Ordering of the button within its {@link toolbarGroup} (ascending).
   *  Ties keep registry insertion order. */
  toolbarOrder?: number;
  enabled: (state: ActionState) => boolean;
  run: () => void | Promise<void>;
}

/** Toolbar item produced by ``buildToolbarItems``: either an action button
 *  or a separator marker inserted between groups. */
export type ToolbarItem =
  | { kind: "action"; action: ActionDescriptor }
  | { kind: "separator" };

/** Toolbar group ordering, mirroring DataLab desktop's toolbar layout:
 *  the HDF5 workspace actions (main toolbar) come first, then the
 *  per-object file / edit / metadata / ROI actions (panel toolbar). The
 *  metadata block is split into three sub-groups to reproduce desktop's
 *  internal separators (copy/paste | add/import/export | delete). */
export const TOOLBAR_GROUP_ORDER = [
  "file-h5",
  "file",
  "edit",
  "metadata",
  "metadata-edit",
  "metadata-del",
  "roi",
];

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
  /** Insert a separator *before* this node when rendered. For folders
   *  this is propagated from the ``beginGroup`` of the first child leaf
   *  (leaves carry it directly via their {@link ActionDescriptor}). */
  beginGroup?: boolean;
  /** Optional icon URL shown next to the label. */
  iconUrl?: string;
}

/** A single executable command surfaced in the command palette.
 *
 * Each entry corresponds to a leaf of the localised menu tree (one
 * {@link ActionDescriptor}), enriched with its readable, localised menu
 * path so users can find features the same way they navigate the menus. */
export interface CommandEntry {
  /** The underlying action (handler + enablement predicate). */
  action: ActionDescriptor;
  /** Localised leaf label (identical to {@link ActionDescriptor.label}). */
  label: string;
  /** Localised parent path, e.g. "Processing › Fourier analysis". Empty
   *  for a top-level leaf with no parent folder. */
  parentLabel: string;
  /** Full localised path including the leaf, e.g.
   *  "Processing › Fourier analysis › FFT". */
  pathLabel: string;
  /** Lowercased search haystack (full path + action id) used for
   *  matching in the command palette. */
  searchText: string;
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
