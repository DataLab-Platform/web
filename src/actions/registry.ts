import type {
  FeatureDescriptor,
  SignalAnalysisDescriptor,
  SignalCreationType,
} from "../sigima/runtime";
import { getAnalysisIconUrl } from "../assets/analysisIcons";
import { getCreateIconUrl } from "../assets/createIcons";
import type { ActionDescriptor, ActionState } from "./types";

/** Callbacks needed to build the static (non-feature) actions. */
export interface StaticActionCallbacks {
  onNewGroup: () => void;
  onDeleteSelection: () => void;
  onEditProperties: () => void;
  onEditRoi: () => void;
  onSaveProject: () => void;
  onLoadProject: () => void;
  onOpenFile: () => void;
  onSaveFile: () => void;
  onNewImage: () => void;
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
      id: "file.new_image",
      label: "New image…",
      menuPath: "File/New image…",
      beginGroup: true,
      enabled: ready,
      run: cb.onNewImage,
    },
    {
      id: "file.new_group",
      label: "New group",
      menuPath: "File/New group",
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
    {
      id: "edit.roi",
      label: "Edit ROI…",
      menuPath: "Edit/Edit ROI…",
      enabled: (s) => ready(s) && s.currentId !== null,
      run: cb.onEditRoi,
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

/** Wire one Analysis-menu entry per Sigima signal-analysis function.
 *  Mirrors the desktop app's flat ``Analysis`` menu — labels, icons and
 *  separators come straight from the Python catalogue. */
export function buildSignalAnalysisActions(
  entries: SignalAnalysisDescriptor[],
  onRun: (funcId: string, hasParams: boolean) => void,
): ActionDescriptor[] {
  return entries.map((e) => {
    // Substitute U+2215 (DIVISION SLASH) for ASCII "/" in labels containing
    // a math fraction (e.g. "Full width at 1/e²"); otherwise the menu-path
    // splitter would treat it as a sub-menu separator.  Visually identical.
    const safeLabel = e.label.replace(/\//g, "\u2215");
    return {
      id: `analysis.signal.${e.id}`,
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
