import type { FeatureDescriptor } from "../sigima/runtime";
import type { ActionDescriptor, ActionState } from "./types";

/** Callbacks needed to build the static (non-feature) actions. */
export interface StaticActionCallbacks {
  onNewSignal: () => void;
  onNewGroup: () => void;
  onDeleteSelection: () => void;
  onEditProperties: () => void;
  onEditRoi: () => void;
  onSaveProject: () => void;
  onLoadProject: () => void;
  onImportCsv: () => void;
  onExportCsv: () => void;
  onNewImage: () => void;
}

/** Wire static actions (File / Edit) ----------------------------------- */
export function buildStaticActions(
  cb: StaticActionCallbacks,
): ActionDescriptor[] {
  const ready = (s: ActionState) => s.status === "ready" && !s.busy;
  return [
    {
      id: "file.new_signal",
      label: "New signal…",
      menuPath: "File/New signal…",
      enabled: ready,
      run: cb.onNewSignal,
    },
    {
      id: "file.new_image",
      label: "New image…",
      menuPath: "File/New image…",
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
      id: "file.import_csv",
      label: "Import CSV…",
      menuPath: "File/Import CSV…",
      enabled: ready,
      run: cb.onImportCsv,
    },
    {
      id: "file.export_csv",
      label: "Export CSV…",
      menuPath: "File/Export CSV…",
      enabled: (s) => ready(s) && s.currentId !== null,
      run: cb.onExportCsv,
    },
    {
      id: "file.open_project",
      label: "Open project…",
      menuPath: "File/Open project…",
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
