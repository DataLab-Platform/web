import type {
  FeatureDescriptor,
  ImageCreationType,
  ImageRoiSegment,
  InteractiveFitInfo,
  PluginMenuAction,
  SignalAnalysisDescriptor,
  SignalCreationType,
  SignalRoiSegment,
} from "../sigima/runtime";
import { getAnalysisIconUrl } from "../assets/analysisIcons";
import { getCreateIconUrl } from "../assets/createIcons";
import { getRoiIconUrl } from "../assets/roiIcons";
import type { ActionDescriptor, ActionState } from "./types";

/** Callbacks needed to build the static (non-feature) actions. */
export interface StaticActionCallbacks {
  onNewGroup: () => void;
  onDeleteSelection: () => void;
  onEditProperties: () => void;
  onSaveProject: () => void;
  onLoadProject: () => void;
  onOpenFile: () => void;
  onSaveFile: () => void;
  onSaveToDirectory: () => void;
  onOpenWorkspaceHdf5: () => void;
  onSaveWorkspaceHdf5: () => void;
  onImportHdf5: () => void;
  onImportTextWizard: () => void;
}

/** Wire static actions (File / Edit) ----------------------------------- */
export function buildStaticActions(
  cb: StaticActionCallbacks,
): ActionDescriptor[] {
  const ready = (s: ActionState) => s.status === "ready" && !s.busy;
  return [
    {
      id: "file.open",
      label: "Open signal…",
      menuPath: "File/Open signal…",
      shortcut: "Ctrl+O",
      enabled: ready,
      run: cb.onOpenFile,
    },
    {
      id: "file.save",
      label: "Save signal…",
      menuPath: "File/Save signal…",
      shortcut: "Ctrl+S",
      enabled: (s) => ready(s) && s.currentId !== null,
      run: cb.onSaveFile,
    },
    {
      id: "file.save_to_directory",
      label: "Save to directory…",
      menuPath: "File/Save to directory…",
      enabled: (s) =>
        ready(s) && (s.selectedIds.length > 0 || s.currentId !== null),
      run: cb.onSaveToDirectory,
    },
    {
      id: "file.new_group",
      label: "New group",
      menuPath: "File/New group",
      beginGroup: true,
      enabled: ready,
      run: cb.onNewGroup,
    },
    {
      id: "file.open_project",
      label: "Open project…",
      menuPath: "File/Open project…",
      beginGroup: true,
      enabled: ready,
      run: cb.onLoadProject,
    },
    {
      id: "file.save_project",
      label: "Save project…",
      menuPath: "File/Save project…",
      enabled: (s) => ready(s) && s.hasObjects,
      run: cb.onSaveProject,
    },
    {
      id: "file.open_workspace_h5",
      label: "Open HDF5 workspace…",
      menuPath: "File/Open HDF5 workspace…",
      beginGroup: true,
      enabled: ready,
      run: cb.onOpenWorkspaceHdf5,
    },
    {
      id: "file.save_workspace_h5",
      label: "Save HDF5 workspace…",
      menuPath: "File/Save HDF5 workspace…",
      enabled: (s) => ready(s) && s.hasObjects,
      run: cb.onSaveWorkspaceHdf5,
    },
    {
      id: "file.import_hdf5",
      label: "Import from HDF5…",
      menuPath: "File/Import from HDF5…",
      enabled: ready,
      run: cb.onImportHdf5,
    },
    {
      id: "file.import_text",
      label: "Import text data…",
      menuPath: "File/Import text data…",
      enabled: ready,
      run: cb.onImportTextWizard,
    },
    {
      id: "edit.delete",
      label: "Delete selection",
      menuPath: "Edit/Delete selection",
      enabled: (s) => ready(s) && s.selectedIds.length > 0,
      run: cb.onDeleteSelection,
    },
    {
      id: "edit.properties",
      label: "Properties…",
      menuPath: "Edit/Properties…",
      enabled: (s) => ready(s) && s.currentId !== null,
      run: cb.onEditProperties,
    },
  ];
}

/** Callbacks for the Help (?) menu actions. */
export interface HelpActionCallbacks {
  onShowAbout: () => void;
  onShowShortcuts: () => void;
  onShowConsole: () => void;
}

/** Wire Help / "?" menu actions. */
export function buildHelpActions(
  cb: HelpActionCallbacks,
): ActionDescriptor[] {
  // Help entries are always available (no runtime dependency).
  const always = () => true;
  return [
    {
      id: "help.documentation",
      label: "Online documentation",
      menuPath: "Help/Online documentation",
      enabled: always,
      run: () =>
        window.open(
          "https://datalab-platform.com/",
          "_blank",
          "noopener,noreferrer",
        ),
    },
    {
      id: "help.shortcuts",
      label: "Keyboard shortcuts",
      menuPath: "Help/Keyboard shortcuts",
      enabled: always,
      run: cb.onShowShortcuts,
    },
    {
      id: "help.console",
      label: "Browser console log",
      menuPath: "Help/Browser console log",
      beginGroup: true,
      enabled: always,
      run: cb.onShowConsole,
    },
    {
      id: "help.about",
      label: "About DataLab Web",
      menuPath: "Help/About DataLab Web",
      beginGroup: true,
      enabled: always,
      run: cb.onShowAbout,
    },
  ];
}

/** Wire feature-driven actions (Operations / Processing / …) ---------- */
export function buildFeatureActions(
  features: FeatureDescriptor[],
  onApply: (featureId: string) => void,
): ActionDescriptor[] {
  return features.map((f) => ({
    id: `feature.${f.id}`,
    label: f.label,
    menuPath: f.menu_path,
    enabled: (s) => {
      if (s.status !== "ready" || s.busy) return false;
      if (s.selectedIds.length === 0 && !s.currentId) return false;
      if (f.pattern === "n_to_1") return true;
      if (f.pattern === "2_to_1") return s.hasObjects;
      return true;
    },
    run: () => onApply(f.id),
  }));
}

/** Wire one entry per interactive fit kind under
 *  ``Processing/Fitting/Interactive fitting``.  Mirrors the desktop
 *  app's ``Processing > Fitting > Interactive fitting`` submenu. */
export function buildInteractiveFitActions(
  fits: InteractiveFitInfo[],
  onLaunch: (fit: InteractiveFitInfo) => void,
): ActionDescriptor[] {
  return fits.map((f, idx) => ({
    id: `ifit.${f.id}`,
    label: `${f.label}\u2026`,
    menuPath: `Processing/Fitting/Interactive fitting/${f.label}`,
    beginGroup: idx === 0,
    enabled: (s) =>
      s.status === "ready" && !s.busy && s.currentId !== null,
    run: () => onLaunch(f),
  }));
}

/** Wire one Create-menu entry per Sigima signal generation type.  Mirrors
 *  the desktop app's flat "Create" menu — entry order *and* group
 *  separators come straight from the Python catalogue. */
export function buildSignalCreationActions(
  types: SignalCreationType[],
  onCreate: (stype: string) => void,
): ActionDescriptor[] {
  const ready = (s: ActionState) => s.status === "ready" && !s.busy;
  return types.map((t) => ({
    id: `create.signal.${t.value}`,
    label: t.label,
    menuPath: `Create/${t.label}`,
    iconUrl: getCreateIconUrl(t.icon),
    beginGroup: t.separator_before,
    enabled: ready,
    run: () => onCreate(t.value),
  }));
}

/** Wire one Create-menu entry per Sigima image generation type. */
export function buildImageCreationActions(
  types: ImageCreationType[],
  onCreate: (stype: string) => void,
): ActionDescriptor[] {
  const ready = (s: ActionState) => s.status === "ready" && !s.busy;
  return types.map((t) => ({
    id: `create.image.${t.value}`,
    label: t.label,
    menuPath: `Create/${t.label}`,
    iconUrl: getCreateIconUrl(t.icon),
    beginGroup: t.separator_before,
    enabled: ready,
    run: () => onCreate(t.value),
  }));
}

/** Wire one Analysis-menu entry per Sigima signal-analysis function.
 *  Mirrors the desktop app's flat ``Analysis`` menu — labels, icons and
 *  separators come straight from the Python catalogue. */
export function buildSignalAnalysisActions(
  entries: SignalAnalysisDescriptor[],
  onRun: (funcId: string, hasParams: boolean) => void,
): ActionDescriptor[] {
  return buildAnalysisActions("signal", entries, onRun);
}

/** Image-side counterpart of :func:`buildSignalAnalysisActions`. */
export function buildImageAnalysisActions(
  entries: SignalAnalysisDescriptor[],
  onRun: (funcId: string, hasParams: boolean) => void,
): ActionDescriptor[] {
  return buildAnalysisActions("image", entries, onRun);
}

function buildAnalysisActions(
  kind: "signal" | "image",
  entries: SignalAnalysisDescriptor[],
  onRun: (funcId: string, hasParams: boolean) => void,
): ActionDescriptor[] {
  return entries.map((e) => {
    // Substitute U+2215 (DIVISION SLASH) for ASCII "/" in labels containing
    // a math fraction (e.g. "Full width at 1/e²"); otherwise the menu-path
    // splitter would treat it as a sub-menu separator.  Visually identical.
    const safeLabel = e.label.replace(/\//g, "\u2215");
    return {
      id: `analysis.${kind}.${e.id}`,
      label: e.has_params ? `${safeLabel}…` : safeLabel,
      menuPath: `Analysis/${safeLabel}`,
      iconUrl: getAnalysisIconUrl(e.icon),
      beginGroup: e.separator_before,
      enabled: (s) =>
        s.status === "ready" && !s.busy && s.currentId !== null,
      run: () => onRun(e.id, e.has_params),
    };
  });
}

/** Callbacks for the ``ROI`` top-level menu (mirrors DataLab desktop). */
export interface RoiActionCallbacks {
  /** Toggle the interactive (drag/draw) ROI editor on the plot. */
  onToggleEditMode: () => void;
  /** Open the numerical ROI dialog. */
  onEditNumerically: () => void;
  /** Extract one new signal per ROI (1-to-n). */
  onExtractEach: () => void;
  /** Extract a single new signal containing the concatenation of all ROIs. */
  onExtractMerged: () => void;
  /** Drop a single ROI by index. */
  onRemoveAt: (index: number) => void;
  /** Drop every ROI on the current signal. */
  onRemoveAll: () => void;
}

/** Wire the ``ROI`` menu actions for the currently displayed signal. */
export function buildRoiActions(
  roi: SignalRoiSegment[],
  roiEditMode: boolean,
  cb: RoiActionCallbacks,
): ActionDescriptor[] {
  const ready = (s: ActionState) =>
    s.status === "ready" && !s.busy && s.currentId !== null;
  const readyWithRoi = (s: ActionState) => ready(s) && roi.length > 0;
  const out: ActionDescriptor[] = [
    {
      id: "roi.edit_graphical",
      label: roiEditMode
        ? "Stop graphical edit"
        : "Edit graphically",
      menuPath: roiEditMode
        ? "ROI/Stop graphical edit"
        : "ROI/Edit graphically",
      iconUrl: getRoiIconUrl("roi_graphical"),
      enabled: ready,
      run: cb.onToggleEditMode,
    },
    {
      id: "roi.edit_numerical",
      label: "Edit numerically…",
      menuPath: "ROI/Edit numerically…",
      iconUrl: getRoiIconUrl("roi_coordinate"),
      enabled: ready,
      run: cb.onEditNumerically,
    },
    {
      id: "roi.extract_each",
      label: "Extract (one signal per ROI)",
      menuPath: "ROI/Extract (one signal per ROI)",
      iconUrl: getRoiIconUrl("roi_sig"),
      beginGroup: true,
      enabled: readyWithRoi,
      run: cb.onExtractEach,
    },
    {
      id: "roi.extract_merged",
      label: "Extract (merged into one signal)",
      menuPath: "ROI/Extract (merged into one signal)",
      iconUrl: getRoiIconUrl("roi_sig"),
      enabled: readyWithRoi,
      run: cb.onExtractMerged,
    },
  ];
  // Dynamic submenu "Remove > <ROI title>" — one entry per ROI plus a final
  // "Remove all".  Mirrors the desktop ROI menu.
  roi.forEach((seg, idx) => {
    const safeTitle = (seg.title || `ROI ${idx + 1}`).replace(/\//g, "\u2215");
    out.push({
      id: `roi.remove.${idx}`,
      label: safeTitle,
      menuPath: `ROI/Remove/${safeTitle}`,
      iconUrl: getRoiIconUrl("roi_delete"),
      beginGroup: idx === 0,
      enabled: ready,
      run: () => cb.onRemoveAt(idx),
    });
  });
  out.push({
    id: "roi.remove_all",
    label: "Remove all",
    menuPath: "ROI/Remove/Remove all",
    iconUrl: getRoiIconUrl("roi_delete"),
    beginGroup: roi.length > 0,
    enabled: readyWithRoi,
    run: cb.onRemoveAll,
  });
  return out;
}

/** Callbacks for the image ``ROI`` top-level menu. */
export interface ImageRoiActionCallbacks {
  /** Toggle the interactive (drag/draw) ROI editor on the plot. */
  onToggleEditMode: () => void;
  /** Open the numerical ROI dialog (rectangle/circle/polygon editor). */
  onEditNumerically: () => void;
  /** Append a new default rectangle ROI then open the numerical dialog. */
  onAddRectangle: () => void;
  /** Append a new default circle ROI then open the numerical dialog. */
  onAddCircle: () => void;
  /** Open the "Create ROI grid" dialog and replace the current image's ROI
   *  with a generated grid of rectangles. */
  onCreateGrid: () => void;
  /** Extract one new image per ROI (1-to-n). */
  onExtractEach: () => void;
  /** Extract a single new image containing the union of all ROIs. */
  onExtractMerged: () => void;
  /** Drop a single ROI by index. */
  onRemoveAt: (index: number) => void;
  /** Drop every ROI on the current image. */
  onRemoveAll: () => void;
}

/** Wire the ``ROI`` menu actions for the currently displayed image. */
export function buildImageRoiActions(
  roi: ImageRoiSegment[],
  roiEditMode: boolean,
  cb: ImageRoiActionCallbacks,
): ActionDescriptor[] {
  const ready = (s: ActionState) =>
    s.status === "ready" && !s.busy && s.currentId !== null;
  const readyWithRoi = (s: ActionState) => ready(s) && roi.length > 0;
  const out: ActionDescriptor[] = [
    {
      id: "image_roi.edit_graphical",
      label: roiEditMode ? "Stop graphical edit" : "Edit graphically",
      menuPath: roiEditMode
        ? "ROI/Stop graphical edit"
        : "ROI/Edit graphically",
      iconUrl: getRoiIconUrl("roi_graphical"),
      enabled: ready,
      run: cb.onToggleEditMode,
    },
    {
      id: "image_roi.add_rectangle",
      label: "Add rectangular ROI…",
      menuPath: "ROI/Add rectangular ROI…",
      iconUrl: getRoiIconUrl("roi_new_rectangle"),
      beginGroup: true,
      enabled: ready,
      run: cb.onAddRectangle,
    },
    {
      id: "image_roi.add_circle",
      label: "Add circular ROI…",
      menuPath: "ROI/Add circular ROI…",
      iconUrl: getRoiIconUrl("roi_new_circle"),
      enabled: ready,
      run: cb.onAddCircle,
    },
    {      id: "image_roi.create_grid",
      label: "Create ROI grid\u2026",
      menuPath: "ROI/Create ROI grid\u2026",
      iconUrl: getRoiIconUrl("roi_grid"),
      enabled: ready,
      run: cb.onCreateGrid,
    },
    {      id: "image_roi.edit_numerical",
      label: "Edit numerically…",
      menuPath: "ROI/Edit numerically…",
      iconUrl: getRoiIconUrl("roi_coordinate"),
      beginGroup: true,
      enabled: ready,
      run: cb.onEditNumerically,
    },
    {
      id: "image_roi.extract_each",
      label: "Extract (one image per ROI)",
      menuPath: "ROI/Extract (one image per ROI)",
      iconUrl: getRoiIconUrl("roi_ima"),
      beginGroup: true,
      enabled: readyWithRoi,
      run: cb.onExtractEach,
    },
    {
      id: "image_roi.extract_merged",
      label: "Extract (merged into one image)",
      menuPath: "ROI/Extract (merged into one image)",
      iconUrl: getRoiIconUrl("roi_ima"),
      enabled: readyWithRoi,
      run: cb.onExtractMerged,
    },
  ];
  roi.forEach((seg, idx) => {
    const fallback = `${seg.geometry === "rectangle" ? "Rect" : seg.geometry === "circle" ? "Circle" : "Poly"} ${idx + 1}`;
    const safeTitle = (seg.title || fallback).replace(/\//g, "\u2215");
    out.push({
      id: `image_roi.remove.${idx}`,
      label: safeTitle,
      menuPath: `ROI/Remove/${safeTitle}`,
      iconUrl: getRoiIconUrl("roi_delete"),
      beginGroup: idx === 0,
      enabled: ready,
      run: () => cb.onRemoveAt(idx),
    });
  });
  out.push({
    id: "image_roi.remove_all",
    label: "Remove all",
    menuPath: "ROI/Remove/Remove all",
    iconUrl: getRoiIconUrl("roi_delete"),
    beginGroup: roi.length > 0,
    enabled: readyWithRoi,
    run: cb.onRemoveAll,
  });
  return out;
}


/** Callbacks for the image ``Operations`` panel-level layout actions
 *  (mirrors DataLab desktop's "Distribute on a grid" / "Reset image
 *  positions"). Modify selected images' origins in place. */
export interface ImageGridActionCallbacks {
  /** Open the GridParam dialog then lay images out side-by-side. */
  onDistributeOnGrid: () => void;
  /** Re-anchor every selected image on the first image's origin. */
  onResetPositions: () => void;
}

/** Wire the image-only "Distribute on a grid" / "Reset image positions"
 *  entries under the "Operations" menu. */
export function buildImageGridActions(
  cb: ImageGridActionCallbacks,
): ActionDescriptor[] {
  const enabled = (s: ActionState) =>
    s.status === "ready" && !s.busy && (s.selectedIds.length > 0 || s.currentId !== null);
  return [
    {
      id: "image.distribute_on_grid",
      label: "Distribute on a grid…",
      menuPath: "Processing/Geometry/Distribute on a grid…",
      beginGroup: true,
      enabled,
      run: cb.onDistributeOnGrid,
    },
    {
      id: "image.reset_positions",
      label: "Reset image positions",
      menuPath: "Processing/Geometry/Reset image positions",
      enabled,
      run: cb.onResetPositions,
    },
  ];
}


/** Wire actions contributed by Python plugins. */
export interface PluginActionCallbacks {
  onTrigger: (actionId: string) => void;
  onOpenManager: () => void;
  onReloadAll: () => void;
}

export function buildPluginActions(
  entries: PluginMenuAction[],
  activePanel: "signal" | "image",
  cb: PluginActionCallbacks,
): ActionDescriptor[] {
  const ready = (s: ActionState) => s.status === "ready" && !s.busy;

  // Always-visible "Plugins" entries (manager + reload).
  const fixed: ActionDescriptor[] = [
    {
      id: "plugins.manager",
      label: "Manage plugins…",
      menuPath: "Plugins/Manage plugins…",
      enabled: ready,
      run: cb.onOpenManager,
    },
    {
      id: "plugins.reload_all",
      label: "Reload all plugins",
      menuPath: "Plugins/Reload all plugins",
      beginGroup: true,
      enabled: ready,
      run: cb.onReloadAll,
    },
  ];

  // Filter to entries belonging to the active panel kind.
  const visible = entries.filter((e) => e.object_kind === activePanel);
  const dynamic = visible.map<ActionDescriptor>((entry) => {
    const path = ["Plugins", ...entry.menu_path, entry.title]
      .filter((s) => s && s.length > 0)
      .join("/");
    return {
      id: `plugin.${entry.action_id}`,
      label: entry.title,
      menuPath: path,
      beginGroup: entry.separator_before,
      enabled: (s) => {
        if (!ready(s)) return false;
        switch (entry.select_condition) {
          case "exactly_one":
            return s.selectedIds.length === 1;
          case "at_least_one":
            return s.selectedIds.length >= 1 || s.currentId !== null;
          case "at_least_two":
            return s.selectedIds.length >= 2;
          default:
            return true;
        }
      },
      run: () => cb.onTrigger(entry.action_id),
    };
  });

  return [...fixed, ...dynamic];
}


