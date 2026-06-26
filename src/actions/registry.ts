import type {
  FeatureDescriptor,
  ImageCreationType,
  ImageRoiSegment,
  InteractiveFitInfo,
  PluginMenuAction,
  SignalAnalysisDescriptor,
  SignalCreationType,
  SignalRoiSegment,
} from "../runtime/runtime";
import { getAnalysisIconUrl } from "../assets/analysisIcons";
import { getCreateIconUrl } from "../assets/createIcons";
import { getEditIconUrl } from "../assets/editIcons";
import { getFeatureIconUrl } from "../assets/featureIcons";
import { getH5IconUrl } from "../assets/h5Icons";
import { getHelpIconUrl } from "../assets/helpIcons";
import { getIoIconUrl } from "../assets/ioIcons";
import { getRoiIconUrl } from "../assets/roiIcons";
import { getRootIconUrl } from "../assets/rootIcons";
import datalabIconUrl from "../assets/DataLab.svg?url";
import { t } from "../i18n/translate";
import type { ActionDescriptor, ActionState } from "./types";

/** Callbacks needed to build the static (non-feature) actions. */
export interface StaticActionCallbacks {
  onNewGroup: () => void;
  onDeleteSelection: () => void;
  /** Delete every group and object of the active panel. */
  onDeleteAllObjects: () => void;
  onEditProperties: () => void;
  onOpenFile: () => void;
  onOpenDirectory: () => void;
  onSaveFile: () => void;
  onSaveToDirectory: () => void;
  onOpenWorkspaceHdf5: () => void;
  onSaveWorkspaceHdf5: () => void;
  onImportHdf5: () => void;
  onImportTextWizard: () => void;
  /** Trigger inline rename on the current object in the object tree. */
  onRenameCurrent: () => void;
  /** Duplicate every selected object (each becomes a new sibling). */
  onDuplicateSelection: () => void;
  /** Move the current object one slot up in its group. */
  onMoveSelectionUp: () => void;
  /** Move the current object one slot down in its group. */
  onMoveSelectionDown: () => void;
  /** Copy the active panel's group/object titles to the clipboard. */
  onCopyTitles: () => void;
  /** Copy the current object's metadata into the panel clipboard. */
  onCopyMetadata: () => void;
  /** Paste the clipboard metadata onto every selected object. */
  onPasteMetadata: () => void;
  /** Add a metadata item to every selected object. */
  onAddMetadata: () => void;
  /** Import metadata from a ``.dlabmeta`` file into the current object. */
  onImportMetadata: () => void;
  /** Export the current object's metadata to a ``.dlabmeta`` file. */
  onExportMetadata: () => void;
  /** Delete all metadata of every selected object. */
  onDeleteMetadata: () => void;
  /** Active object kind — drives the wording of File menu entries
   *  ("Open signal…" vs "Open image…", etc.). */
  panel: "signal" | "image";
}

/** Wire static actions (File / Edit) ----------------------------------- */
export function buildStaticActions(
  cb: StaticActionCallbacks,
): ActionDescriptor[] {
  const ready = (s: ActionState) => s.status === "ready" && !s.busy;
  const suffix = cb.panel === "image" ? "ima" : "sig";
  // Canonical English labels (kept literal in ``menuPath`` for a stable
  // structural key; the displayed ``label`` is translated). Separate
  // signal/image strings avoid gendered-article interpolation pitfalls
  // ("Open signal…" → "Ouvrir le signal…" vs "Ouvrir l'image…").
  const en =
    cb.panel === "image"
      ? {
          open: "Open image…",
          save: "Save image…",
          openDir: "Open images from directory…",
        }
      : {
          open: "Open signal…",
          save: "Save signal…",
          openDir: "Open signals from directory…",
        };
  return [
    {
      id: "file.open",
      label: t(en.open),
      menuPath: `File/${en.open}`,
      iconUrl: getIoIconUrl(`fileopen_${suffix}.svg`),
      toolbar: true,
      toolbarGroup: "file",
      toolbarOrder: 0,
      enabled: ready,
      run: cb.onOpenFile,
    },
    {
      id: "file.open_from_directory",
      label: t(en.openDir),
      menuPath: `File/${en.openDir}`,
      iconUrl: getIoIconUrl("fileopen_directory.svg"),
      toolbar: true,
      toolbarGroup: "file",
      toolbarOrder: 1,
      enabled: ready,
      run: cb.onOpenDirectory,
    },
    {
      id: "file.save",
      label: t(en.save),
      menuPath: `File/${en.save}`,
      iconUrl: getIoIconUrl(`filesave_${suffix}.svg`),
      toolbar: true,
      toolbarGroup: "file",
      toolbarOrder: 2,
      enabled: (s) => ready(s) && s.currentId !== null,
      run: cb.onSaveFile,
    },
    {
      id: "file.save_to_directory",
      label: t("Save to directory\u2026"),
      menuPath: "File/Save to directory\u2026",
      iconUrl: getIoIconUrl("save_to_directory.svg"),
      toolbar: true,
      toolbarGroup: "file",
      toolbarOrder: 3,
      enabled: (s) =>
        ready(s) && (s.selectedIds.length > 0 || s.currentId !== null),
      run: cb.onSaveToDirectory,
    },
    {
      id: "file.import_text",
      label: t("Import text data…"),
      menuPath: "File/Import text data…",
      iconUrl: getIoIconUrl("import_text.svg"),
      enabled: ready,
      run: cb.onImportTextWizard,
    },
    {
      id: "file.open_workspace_h5",
      label: t("Open HDF5 files…"),
      menuPath: "File/Open HDF5 files…",
      iconUrl: getIoIconUrl("fileopen_h5.svg"),
      beginGroup: true,
      toolbar: true,
      toolbarGroup: "file-h5",
      toolbarOrder: 0,
      enabled: ready,
      run: cb.onOpenWorkspaceHdf5,
    },
    {
      id: "file.save_workspace_h5",
      label: t("Save to HDF5 file…"),
      menuPath: "File/Save to HDF5 file…",
      iconUrl: getIoIconUrl("filesave_h5.svg"),
      toolbar: true,
      toolbarGroup: "file-h5",
      toolbarOrder: 1,
      enabled: (s) =>
        ready(s) && (s.hasObjects || s.hasMacros || s.hasNotebooks),
      run: cb.onSaveWorkspaceHdf5,
    },
    {
      id: "file.import_hdf5",
      label: t("Browse HDF5 file…"),
      menuPath: "File/Browse HDF5 file…",
      iconUrl: getH5IconUrl("h5browser.svg"),
      toolbar: true,
      toolbarGroup: "file-h5",
      toolbarOrder: 2,
      enabled: ready,
      run: cb.onImportHdf5,
    },
    // Edit menu — order mirrors DataLab Qt's Edit menu (New group first,
    // then per-object actions).
    {
      id: "edit.new_group",
      label: t("New group"),
      menuPath: "Edit/New group",
      iconUrl: getEditIconUrl("new_group.svg"),
      enabled: (s) => ready(s),
      run: cb.onNewGroup,
    },
    {
      id: "edit.delete",
      label: t("Delete selection"),
      menuPath: "Edit/Delete selection",
      iconUrl: getEditIconUrl("delete.svg"),
      beginGroup: true,
      toolbar: true,
      toolbarGroup: "edit",
      toolbarOrder: 3,
      enabled: (s) => ready(s) && s.selectedIds.length > 0,
      run: cb.onDeleteSelection,
    },
    {
      id: "edit.delete_all",
      label: t("Delete all groups and objects"),
      menuPath: "Edit/Delete all groups and objects",
      iconUrl: getEditIconUrl("delete_all.svg"),
      toolbar: true,
      toolbarGroup: "edit",
      toolbarOrder: 4,
      enabled: (s) => ready(s) && s.hasObjects,
      run: cb.onDeleteAllObjects,
    },
    {
      id: "edit.rename",
      label: t("Rename"),
      menuPath: "Edit/Rename",
      iconUrl: getEditIconUrl("rename.svg"),
      beginGroup: true,
      // Mirror DataLab desktop's ``SelectCond.exactly_one_group_or_one_object``:
      // a single group, or a single object (with no group) — selecting a group
      // populates ``selectedIds`` with its children, so check the group count.
      enabled: (s) =>
        ready(s) &&
        (s.selectedGroupCount === 1 ||
          (s.selectedGroupCount === 0 && s.selectedIds.length === 1)),
      run: cb.onRenameCurrent,
    },
    {
      id: "edit.duplicate",
      label: t("Duplicate"),
      menuPath: "Edit/Duplicate",
      iconUrl: getEditIconUrl("duplicate.svg"),
      toolbar: true,
      toolbarGroup: "edit",
      toolbarOrder: 2,
      enabled: (s) => ready(s) && s.selectedIds.length > 0,
      run: cb.onDuplicateSelection,
    },
    {
      id: "edit.move_up",
      label: t("Move up"),
      menuPath: "Edit/Move up",
      iconUrl: getEditIconUrl("move_up.svg"),
      toolbar: true,
      toolbarGroup: "edit",
      toolbarOrder: 0,
      enabled: (s) => ready(s) && s.currentId !== null,
      run: cb.onMoveSelectionUp,
    },
    {
      id: "edit.move_down",
      label: t("Move down"),
      menuPath: "Edit/Move down",
      iconUrl: getEditIconUrl("move_down.svg"),
      toolbar: true,
      toolbarGroup: "edit",
      toolbarOrder: 1,
      enabled: (s) => ready(s) && s.currentId !== null,
      run: cb.onMoveSelectionDown,
    },
    {
      id: "edit.properties",
      label: t("Properties…"),
      menuPath: "Edit/Properties…",
      iconUrl: getRootIconUrl("properties.svg"),
      enabled: (s) => ready(s) && s.currentId !== null,
      run: cb.onEditProperties,
    },
    // Metadata submenu — order mirrors DataLab Qt's Edit > Metadata.
    {
      id: "edit.metadata.copy",
      label: t("Copy metadata"),
      menuPath: "Edit/Metadata/Copy metadata",
      iconUrl: getEditIconUrl("metadata_copy.svg"),
      beginGroup: true,
      toolbar: true,
      toolbarGroup: "metadata",
      toolbarOrder: 0,
      enabled: (s) => ready(s) && s.selectedIds.length === 1,
      run: cb.onCopyMetadata,
    },
    {
      id: "edit.metadata.paste",
      label: t("Paste metadata"),
      menuPath: "Edit/Metadata/Paste metadata",
      iconUrl: getEditIconUrl("metadata_paste.svg"),
      toolbar: true,
      toolbarGroup: "metadata",
      toolbarOrder: 1,
      enabled: (s) =>
        ready(s) && s.hasMetadataClipboard && s.selectedIds.length > 0,
      run: cb.onPasteMetadata,
    },
    {
      id: "edit.metadata.add",
      label: t("Add metadata…"),
      menuPath: "Edit/Metadata/Add metadata…",
      iconUrl: getEditIconUrl("metadata_add.svg"),
      beginGroup: true,
      toolbar: true,
      toolbarGroup: "metadata-edit",
      toolbarOrder: 0,
      enabled: (s) => ready(s) && s.selectedIds.length > 0,
      run: cb.onAddMetadata,
    },
    {
      id: "edit.metadata.import",
      label: t("Import metadata…"),
      menuPath: "Edit/Metadata/Import metadata…",
      iconUrl: getEditIconUrl("metadata_import.svg"),
      toolbar: true,
      toolbarGroup: "metadata-edit",
      toolbarOrder: 1,
      enabled: (s) => ready(s) && s.selectedIds.length === 1,
      run: cb.onImportMetadata,
    },
    {
      id: "edit.metadata.export",
      label: t("Export metadata…"),
      menuPath: "Edit/Metadata/Export metadata…",
      iconUrl: getEditIconUrl("metadata_export.svg"),
      toolbar: true,
      toolbarGroup: "metadata-edit",
      toolbarOrder: 2,
      enabled: (s) => ready(s) && s.selectedIds.length === 1,
      run: cb.onExportMetadata,
    },
    {
      id: "edit.metadata.delete",
      label: t("Delete object metadata"),
      menuPath: "Edit/Metadata/Delete object metadata",
      iconUrl: getEditIconUrl("metadata_delete.svg"),
      beginGroup: true,
      toolbar: true,
      toolbarGroup: "metadata-del",
      toolbarOrder: 0,
      enabled: (s) => ready(s) && s.selectedIds.length > 0,
      run: cb.onDeleteMetadata,
    },
    {
      id: "edit.copy_titles",
      label: t("Copy titles to clipboard"),
      menuPath: "Edit/Copy titles to clipboard",
      iconUrl: getEditIconUrl("copy_titles.svg"),
      beginGroup: true,
      enabled: (s) => ready(s) && s.hasObjects,
      run: cb.onCopyTitles,
    },
  ];
}

/** Callbacks for the Help (?) menu actions. */
export interface HelpActionCallbacks {
  onShowAbout: () => void;
  onShowShortcuts: () => void;
  onShowConsole: () => void;
  onOpenUserGuide: () => void;
  onOpenWelcome: () => void;
  onStartTour: () => void;
  onShowReleaseNotes: () => void;
}

/** Wire Help / "?" menu actions. */
export function buildHelpActions(cb: HelpActionCallbacks): ActionDescriptor[] {
  // Help entries are always available (no runtime dependency).
  const always = () => true;
  return [
    {
      id: "help.welcome",
      label: t("Welcome"),
      menuPath: "Help/Welcome",
      iconUrl: datalabIconUrl,
      enabled: always,
      run: cb.onOpenWelcome,
    },
    {
      id: "help.tour",
      label: t("Take the guided tour"),
      menuPath: "Help/Take the guided tour",
      iconUrl: getHelpIconUrl("libre-gui-questions.svg"),
      enabled: always,
      run: cb.onStartTour,
    },
    {
      id: "help.userguide",
      label: t("User guide"),
      menuPath: "Help/User guide",
      iconUrl: getHelpIconUrl("libre-gui-help.svg"),
      beginGroup: true,
      enabled: always,
      run: cb.onOpenUserGuide,
    },
    {
      id: "help.releaseNotes",
      label: t("Release notes"),
      menuPath: "Help/Release notes",
      iconUrl: getHelpIconUrl("libre-gui-about.svg"),
      enabled: always,
      run: cb.onShowReleaseNotes,
    },
    {
      id: "help.documentation",
      label: t("DataLab project website"),
      menuPath: "Help/DataLab project website",
      iconUrl: getHelpIconUrl("libre-gui-globe.svg"),
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
      label: t("Keyboard shortcuts"),
      menuPath: "Help/Keyboard shortcuts",
      iconUrl: getHelpIconUrl("libre-gui-questions.svg"),
      enabled: always,
      run: cb.onShowShortcuts,
    },
    {
      id: "help.console",
      label: t("Browser console log"),
      menuPath: "Help/Browser console log",
      iconUrl: getRootIconUrl("console.svg"),
      beginGroup: true,
      enabled: always,
      run: cb.onShowConsole,
    },
    {
      id: "help.about",
      label: t("About DataLab Web"),
      menuPath: "Help/About DataLab Web",
      iconUrl: getHelpIconUrl("libre-gui-about.svg"),
      beginGroup: true,
      enabled: always,
      run: cb.onShowAbout,
    },
  ];
}

export interface ViewActionCallbacks {
  /** Current visibility of the general toolbar. */
  showToolbar: boolean;
  /** Toggle the general toolbar visibility (and persist the new value). */
  onToggleToolbar: () => void;
  /** Current value of the "show results overlay on plot" preference. */
  showResultsOverlay: boolean;
  /** Toggle the preference (and persist the new value). */
  onToggleResultsOverlay: () => void;
  /** Current value of the "show graphical object titles" preference. */
  showGraphicalTitles: boolean;
  /** Toggle the preference (and persist the new value). */
  onToggleGraphicalTitles: () => void;
  /** Open the current selection in a full-screen popout dialog. */
  onOpenSeparateView: () => void;
  /** True when the active panel has at least one object selected
   *  (drives the enabled state of "View in a new window…"). */
  hasSelection: boolean;
  /** True when the Notebook panel is currently detached as a
   *  floating overlay. */
  notebookFloating: boolean;
  /** Toggle the Notebook panel placement (tab ⇄ floating). */
  onToggleNotebookFloating: () => void;
  /** True when the Macro panel is currently detached as a floating
   *  overlay. */
  macroFloating: boolean;
  /** Toggle the Macro panel placement (tab ⇄ floating). */
  onToggleMacroFloating: () => void;
  /** Currently active locale code (e.g. ``"en"`` / ``"fr"``). */
  locale: string;
  /** Locales offered in the Language submenu (code + native label). */
  availableLocales: { code: string; label: string }[];
  /** Switch the UI locale (triggers a full reload, see ``locale.ts``). */
  onSetLocale: (code: string) => void;
}

/** Wire View menu actions (UI preferences only). */
export function buildViewActions(cb: ViewActionCallbacks): ActionDescriptor[] {
  const always = () => true;
  // Use a leading checkmark glyph as a poor-man's "checkable" item;
  // the menu bar otherwise renders flat labels and we don't want to
  // grow the action descriptor schema for toggles.
  const checkPrefix = (on: boolean) => (on ? "\u2713 " : "    ");
  const toolbarPrefix = checkPrefix(cb.showToolbar);
  const overlayPrefix = checkPrefix(cb.showResultsOverlay);
  const titlesPrefix = checkPrefix(cb.showGraphicalTitles);
  const notebookPrefix = checkPrefix(cb.notebookFloating);
  const macroPrefix = checkPrefix(cb.macroFloating);
  return [
    {
      id: "view.open_separate_view",
      label: t("View in a new window…"),
      menuPath: "View/View in a new window\u2026",
      enabled: (s) =>
        s.status === "ready" &&
        !s.busy &&
        cb.hasSelection &&
        s.currentId !== null,
      run: cb.onOpenSeparateView,
    },
    {
      id: "view.show_toolbar",
      label: `${toolbarPrefix}${t("Show toolbar")}`,
      menuPath: `View/${toolbarPrefix}Show toolbar`,
      beginGroup: true,
      enabled: always,
      run: cb.onToggleToolbar,
    },
    {
      id: "view.results_overlay",
      label: `${overlayPrefix}${t("Show results overlay on plot")}`,
      menuPath: `View/${overlayPrefix}Show results overlay on plot`,
      enabled: always,
      run: cb.onToggleResultsOverlay,
    },
    {
      id: "view.show_graphical_titles",
      label: `${titlesPrefix}${t("Show graphical object titles")}`,
      menuPath: `View/${titlesPrefix}Show graphical object titles`,
      enabled: always,
      run: cb.onToggleGraphicalTitles,
    },
    {
      id: "view.notebook_floating",
      label: `${notebookPrefix}${t("Detach Notebooks panel")}`,
      menuPath: `View/${notebookPrefix}Detach Notebooks panel`,
      beginGroup: true,
      enabled: always,
      run: cb.onToggleNotebookFloating,
    },
    {
      id: "view.macro_floating",
      label: `${macroPrefix}${t("Detach Macros panel")}`,
      menuPath: `View/${macroPrefix}Detach Macros panel`,
      enabled: always,
      run: cb.onToggleMacroFloating,
    },
    ...cb.availableLocales.map((loc, index) => ({
      id: `view.language.${loc.code}`,
      label: `${checkPrefix(loc.code === cb.locale)}${loc.label}`,
      // The leaf segment uses the stable locale code; the folder label is
      // translated via ``t("Language")`` by the menu-tree builder.
      menuPath: `View/Language/${loc.code}`,
      // The first entry opens a new group so the Language submenu is
      // separated from the panel-detach toggles above.
      beginGroup: index === 0 ? true : undefined,
      enabled: always,
      run: () => {
        if (loc.code !== cb.locale) cb.onSetLocale(loc.code);
      },
    })),
  ];
}

/** Callbacks for the AI Assistant menu entries. */
export interface AIAssistantActionCallbacks {
  /** Current visibility of the AI Assistant panel. */
  visible: boolean;
  /** Toggle the panel (and persist the new value). */
  onTogglePanel: () => void;
  /** Open the AI Assistant settings dialog. */
  onOpenSettings: () => void;
}

/** Wire AI Assistant menu actions (under the View menu). */
export function buildAIAssistantActions(
  cb: AIAssistantActionCallbacks,
): ActionDescriptor[] {
  const always = () => true;
  const checkPrefix = cb.visible ? "\u2713 " : "    ";
  return [
    {
      id: "view.ai_assistant.toggle",
      label: `${checkPrefix}${t("Show AI Assistant")}`,
      menuPath: `View/${checkPrefix}Show AI Assistant`,
      beginGroup: true,
      enabled: always,
      run: cb.onTogglePanel,
    },
    {
      id: "view.ai_assistant.settings",
      label: t("AI Assistant settings…"),
      menuPath: "View/AI Assistant settings\u2026",
      enabled: always,
      run: cb.onOpenSettings,
    },
  ];
}

/** Wire feature-driven actions (Operations / Processing / …) ---------- */
/**
 * Decide whether a feature action is selectable for the current
 * {@link ActionState}, based on its Sigima ``pattern``.
 *
 * The mapping mirrors the input arity declared by ``processor.py``:
 *
 * | pattern   | meaning                       | requirement beyond a selection |
 * | --------- | ----------------------------- | ------------------------------ |
 * | ``1_to_1``| one object → one object       | none                           |
 * | ``n_to_1``| n objects → one object        | at least two selected objects  |
 * | ``2_to_1``| object + operand → one object | a second object must exist     |
 *
 * Every pattern first needs the runtime ready, not busy, and at least one
 * selected or current object. ``n_to_1`` aggregations (Sum, Average, …) are
 * only meaningful on two or more objects, mirroring DataLab desktop's
 * ``SelectCond.at_least_two``. Keep this in sync with ``processor.py`` when a
 * new pattern is introduced.
 */
export function isFeatureActionEnabled(
  pattern: FeatureDescriptor["pattern"],
  s: ActionState,
): boolean {
  if (s.status !== "ready" || s.busy) return false;
  if (s.selectedIds.length === 0 && !s.currentId) return false;
  // ``n_to_1`` aggregations need at least two objects to combine.
  if (pattern === "n_to_1") return s.selectedIds.length >= 2;
  // ``2_to_1`` needs a second operand object to combine with the selection.
  if (pattern === "2_to_1") return s.hasObjects;
  return true;
}

export function buildFeatureActions(
  features: FeatureDescriptor[],
  onApply: (featureId: string) => void,
): ActionDescriptor[] {
  return features.map((f) => ({
    id: `feature.${f.id}`,
    // Leaf labels may be DataLab-Web overrides (English, from
    // ``processor.py``) or Sigima-owned strings already localised by the
    // ``.mo`` catalog. ``t()`` is a safe pass-through for the latter (no
    // matching key → returned unchanged) and translates the former.
    label: t(f.label),
    menuPath: f.menu_path,
    iconUrl: getFeatureIconUrl(f.icon),
    enabled: (s) => isFeatureActionEnabled(f.pattern, s),
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
    label: `${t(f.label)}\u2026`,
    menuPath: `Processing/Fitting/Interactive fitting/${f.label}`,
    beginGroup: idx === 0,
    enabled: (s) => s.status === "ready" && !s.busy && s.currentId !== null,
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
  return types.map((ct) => ({
    id: `create.signal.${ct.value}`,
    label: t(ct.label),
    menuPath: `Create/${ct.label}`,
    iconUrl: getCreateIconUrl(ct.icon),
    beginGroup: ct.separator_before,
    enabled: ready,
    run: () => onCreate(ct.value),
  }));
}

/** Wire one Create-menu entry per Sigima image generation type. */
export function buildImageCreationActions(
  types: ImageCreationType[],
  onCreate: (stype: string) => void,
): ActionDescriptor[] {
  const ready = (s: ActionState) => s.status === "ready" && !s.busy;
  return types.map((ct) => ({
    id: `create.image.${ct.value}`,
    label: t(ct.label),
    menuPath: `Create/${ct.label}`,
    iconUrl: getCreateIconUrl(ct.icon),
    beginGroup: ct.separator_before,
    enabled: ready,
    run: () => onCreate(ct.value),
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

/** Wire the single "Plot results" entry at the bottom of the Analysis
 *  menu (mirrors DataLab desktop).  Aggregates the analysis results
 *  stored on the selected objects into new result signals. */
export function buildPlotResultsAction(
  kind: "signal" | "image",
  onPlotResults: () => void,
): ActionDescriptor {
  return {
    id: `analysis.${kind}.plot_results`,
    label: `${t("Plot results")}\u2026`,
    menuPath: `Analysis/${t("Plot results")}\u2026`,
    iconUrl: getAnalysisIconUrl("plot_results.svg"),
    beginGroup: true,
    enabled: (s) => s.status === "ready" && !s.busy && s.selectedIds.length > 0,
    run: onPlotResults,
  };
}

function buildAnalysisActions(
  kind: "signal" | "image",
  entries: SignalAnalysisDescriptor[],
  onRun: (funcId: string, hasParams: boolean) => void,
): ActionDescriptor[] {
  return entries.map((e) => {
    // Translate first, then substitute U+2215 (DIVISION SLASH) for ASCII
    // "/" in labels containing a math fraction (e.g. "Full width at
    // 1/e²"); otherwise the menu-path splitter would treat it as a
    // sub-menu separator. Visually identical. ``t()`` is a safe
    // pass-through for Sigima-owned labels already localised by ``.mo``.
    const safeLabel = t(e.label).replace(/\//g, "\u2215");
    // Group related analyses under a submenu folder (e.g. the four blob
    // detectors live under "Analysis/Blob detection", mirroring the
    // desktop app). Folder labels are translated by ``buildMenuTree``.
    const menuPath = e.submenu
      ? `Analysis/${e.submenu}/${safeLabel}`
      : `Analysis/${safeLabel}`;
    return {
      id: `analysis.${kind}.${e.id}`,
      label: e.has_params ? `${safeLabel}…` : safeLabel,
      menuPath,
      iconUrl: getAnalysisIconUrl(e.icon),
      beginGroup: e.separator_before,
      enabled: (s) => s.status === "ready" && !s.busy && s.currentId !== null,
      run: () => onRun(e.id, e.has_params),
    };
  });
}

/** Callbacks for the ``ROI`` top-level menu (mirrors DataLab desktop). */
export interface RoiActionCallbacks {
  /** Toggle the docked ROI editor (draw + coordinate table) on the plot. */
  onToggleEditMode: () => void;
  /** Extract one new signal per ROI (1-to-n). */
  onExtractEach: () => void;
  /** Extract a single new signal containing the concatenation of all ROIs. */
  onExtractMerged: () => void;
  /** Copy the displayed signal's ROI into the panel clipboard. */
  onCopy: () => void;
  /** Paste the clipboard ROI onto the selected signals. */
  onPaste: () => void;
  /** Import a ROI from a ``.dlabroi`` file onto the selected signals. */
  onImport: () => void;
  /** Export the displayed signal's ROI to a ``.dlabroi`` file. */
  onExport: () => void;
  /** Drop a single ROI by index. */
  onRemoveAt: (index: number) => void;
  /** Drop every ROI on the current signal. */
  onRemoveAll: () => void;
}

/** Wire the ``ROI`` menu actions for the currently displayed signal. */
export function buildRoiActions(
  roi: SignalRoiSegment[],
  roiEditMode: boolean,
  hasRoiClipboard: boolean,
  cb: RoiActionCallbacks,
): ActionDescriptor[] {
  const ready = (s: ActionState) =>
    s.status === "ready" && !s.busy && s.currentId !== null;
  const readyWithRoi = (s: ActionState) => ready(s) && roi.length > 0;
  const readyWithClipboard = (s: ActionState) => ready(s) && hasRoiClipboard;
  // "Remove all" mirrors desktop's ``SelectCond.with_roi``: enabled when
  // *any* selected object has a ROI, even if the displayed one has none.
  const readyWithSelectionRoi = (s: ActionState) =>
    ready(s) && (roi.length > 0 || s.selectionHasRoi);
  const out: ActionDescriptor[] = [
    {
      id: "roi.edit",
      label: roiEditMode
        ? t("Stop editing regions of interest")
        : t("Edit regions of interest"),
      menuPath: roiEditMode
        ? "ROI/Stop editing regions of interest"
        : "ROI/Edit regions of interest",
      iconUrl: getRoiIconUrl("roi_graphical"),
      enabled: ready,
      run: cb.onToggleEditMode,
    },
    {
      id: "roi.copy",
      label: t("Copy ROI"),
      menuPath: "ROI/Copy ROI",
      iconUrl: getRoiIconUrl("roi_copy"),
      beginGroup: true,
      toolbar: true,
      toolbarGroup: "roi",
      toolbarOrder: 0,
      enabled: readyWithRoi,
      run: cb.onCopy,
    },
    {
      id: "roi.paste",
      label: t("Paste ROI"),
      menuPath: "ROI/Paste ROI",
      iconUrl: getRoiIconUrl("roi_paste"),
      toolbar: true,
      toolbarGroup: "roi",
      toolbarOrder: 1,
      enabled: readyWithClipboard,
      run: cb.onPaste,
    },
    {
      id: "roi.import",
      label: t("Import ROI…"),
      menuPath: "ROI/Import ROI…",
      iconUrl: getRoiIconUrl("roi_import"),
      toolbar: true,
      toolbarGroup: "roi",
      toolbarOrder: 2,
      enabled: ready,
      run: cb.onImport,
    },
    {
      id: "roi.export",
      label: t("Export ROI…"),
      menuPath: "ROI/Export ROI…",
      iconUrl: getRoiIconUrl("roi_export"),
      toolbar: true,
      toolbarGroup: "roi",
      toolbarOrder: 3,
      enabled: readyWithRoi,
      run: cb.onExport,
    },
    {
      id: "roi.extract_each",
      label: t("Extract (one signal per ROI)"),
      menuPath: "ROI/Extract (one signal per ROI)",
      iconUrl: getRoiIconUrl("roi_sig"),
      beginGroup: true,
      enabled: readyWithRoi,
      run: cb.onExtractEach,
    },
    {
      id: "roi.extract_merged",
      label: t("Extract (merged into one signal)"),
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
    label: t("Remove all"),
    menuPath: "ROI/Remove/Remove all",
    iconUrl: getRoiIconUrl("roi_delete"),
    beginGroup: roi.length > 0,
    enabled: readyWithSelectionRoi,
    run: cb.onRemoveAll,
  });
  return out;
}

/** Callbacks for the image ``ROI`` top-level menu. */
export interface ImageRoiActionCallbacks {
  /** Toggle the docked ROI editor (draw + coordinate table) on the plot. */
  onToggleEditMode: () => void;
  /** Append a new default rectangle ROI then open the editor panel. */
  onAddRectangle: () => void;
  /** Append a new default circle ROI then open the editor panel. */
  onAddCircle: () => void;
  /** Open the "Create ROI grid" dialog and replace the current image's ROI
   *  with a generated grid of rectangles. */
  onCreateGrid: () => void;
  /** Extract one new image per ROI (1-to-n). */
  onExtractEach: () => void;
  /** Extract a single new image containing the union of all ROIs. */
  onExtractMerged: () => void;
  /** Copy the displayed image's ROI into the panel clipboard. */
  onCopy: () => void;
  /** Paste the clipboard ROI onto the selected images. */
  onPaste: () => void;
  /** Import a ROI from a ``.dlabroi`` file onto the selected images. */
  onImport: () => void;
  /** Export the displayed image's ROI to a ``.dlabroi`` file. */
  onExport: () => void;
  /** Drop a single ROI by index. */
  onRemoveAt: (index: number) => void;
  /** Drop every ROI on the current image. */
  onRemoveAll: () => void;
}

/** Wire the ``ROI`` menu actions for the currently displayed image. */
export function buildImageRoiActions(
  roi: ImageRoiSegment[],
  roiEditMode: boolean,
  hasRoiClipboard: boolean,
  cb: ImageRoiActionCallbacks,
): ActionDescriptor[] {
  const ready = (s: ActionState) =>
    s.status === "ready" && !s.busy && s.currentId !== null;
  const readyWithRoi = (s: ActionState) => ready(s) && roi.length > 0;
  const readyWithClipboard = (s: ActionState) => ready(s) && hasRoiClipboard;
  // "Remove all" mirrors desktop's ``SelectCond.with_roi``: enabled when
  // *any* selected object has a ROI, even if the displayed one has none.
  const readyWithSelectionRoi = (s: ActionState) =>
    ready(s) && (roi.length > 0 || s.selectionHasRoi);
  const out: ActionDescriptor[] = [
    {
      id: "image_roi.edit",
      label: roiEditMode
        ? t("Stop editing regions of interest")
        : t("Edit regions of interest"),
      menuPath: roiEditMode
        ? "ROI/Stop editing regions of interest"
        : "ROI/Edit regions of interest",
      iconUrl: getRoiIconUrl("roi_graphical"),
      enabled: ready,
      run: cb.onToggleEditMode,
    },
    {
      id: "image_roi.add_rectangle",
      label: t("Add rectangular ROI…"),
      menuPath: "ROI/Add rectangular ROI…",
      iconUrl: getRoiIconUrl("roi_new_rectangle"),
      beginGroup: true,
      enabled: ready,
      run: cb.onAddRectangle,
    },
    {
      id: "image_roi.add_circle",
      label: t("Add circular ROI…"),
      menuPath: "ROI/Add circular ROI…",
      iconUrl: getRoiIconUrl("roi_new_circle"),
      enabled: ready,
      run: cb.onAddCircle,
    },
    {
      id: "image_roi.create_grid",
      label: t("Create ROI grid\u2026"),
      menuPath: "ROI/Create ROI grid\u2026",
      iconUrl: getRoiIconUrl("roi_grid"),
      enabled: ready,
      run: cb.onCreateGrid,
    },
    {
      id: "image_roi.copy",
      label: t("Copy ROI"),
      menuPath: "ROI/Copy ROI",
      iconUrl: getRoiIconUrl("roi_copy"),
      beginGroup: true,
      toolbar: true,
      toolbarGroup: "roi",
      toolbarOrder: 0,
      enabled: readyWithRoi,
      run: cb.onCopy,
    },
    {
      id: "image_roi.paste",
      label: t("Paste ROI"),
      menuPath: "ROI/Paste ROI",
      iconUrl: getRoiIconUrl("roi_paste"),
      toolbar: true,
      toolbarGroup: "roi",
      toolbarOrder: 1,
      enabled: readyWithClipboard,
      run: cb.onPaste,
    },
    {
      id: "image_roi.import",
      label: t("Import ROI…"),
      menuPath: "ROI/Import ROI…",
      iconUrl: getRoiIconUrl("roi_import"),
      toolbar: true,
      toolbarGroup: "roi",
      toolbarOrder: 2,
      enabled: ready,
      run: cb.onImport,
    },
    {
      id: "image_roi.export",
      label: t("Export ROI…"),
      menuPath: "ROI/Export ROI…",
      iconUrl: getRoiIconUrl("roi_export"),
      toolbar: true,
      toolbarGroup: "roi",
      toolbarOrder: 3,
      enabled: readyWithRoi,
      run: cb.onExport,
    },
    {
      id: "image_roi.extract_each",
      label: t("Extract (one image per ROI)"),
      menuPath: "ROI/Extract (one image per ROI)",
      iconUrl: getRoiIconUrl("roi_ima"),
      beginGroup: true,
      enabled: readyWithRoi,
      run: cb.onExtractEach,
    },
    {
      id: "image_roi.extract_merged",
      label: t("Extract (merged into one image)"),
      menuPath: "ROI/Extract (merged into one image)",
      iconUrl: getRoiIconUrl("roi_ima"),
      enabled: readyWithRoi,
      run: cb.onExtractMerged,
    },
  ];
  roi.forEach((seg, idx) => {
    const fallback = `${seg.geometry === "rectangle" ? t("Rect") : seg.geometry === "circle" ? t("Circle") : t("Poly")} ${idx + 1}`;
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
    label: t("Remove all"),
    menuPath: "ROI/Remove/Remove all",
    iconUrl: getRoiIconUrl("roi_delete"),
    beginGroup: roi.length > 0,
    enabled: readyWithSelectionRoi,
    run: cb.onRemoveAll,
  });
  return out;
}

/** Callbacks for the image ``Erase area`` action (mirrors DataLab desktop's
 *  ``Processing > Erase area…``). The user-defined ROI is ad-hoc and does
 *  not modify the source image's own ROI list. */
export interface ImageEraseActionCallbacks {
  onErase: () => void;
}

/** Wire the ``Erase area…`` entry directly in the ``Processing`` menu (after
 *  the processing submenus, with a leading separator), mirroring DataLab
 *  desktop's placement and ``erase.svg`` icon. */
export function buildImageEraseActions(
  cb: ImageEraseActionCallbacks,
): ActionDescriptor[] {
  const ready = (s: ActionState) =>
    s.status === "ready" && !s.busy && s.currentId !== null;
  return [
    {
      id: "image.erase_area",
      label: t("Erase area\u2026"),
      menuPath: "Processing/Erase area\u2026",
      iconUrl: getFeatureIconUrl("erase.svg"),
      beginGroup: true,
      enabled: ready,
      run: cb.onErase,
    },
  ];
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
    s.status === "ready" &&
    !s.busy &&
    (s.selectedIds.length > 0 || s.currentId !== null);
  return [
    {
      id: "image.distribute_on_grid",
      label: t("Distribute on a grid…"),
      menuPath: "Processing/Geometry/Distribute on a grid…",
      beginGroup: true,
      enabled,
      run: cb.onDistributeOnGrid,
    },
    {
      id: "image.reset_positions",
      label: t("Reset image positions"),
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

  // Always-visible "Plugins" entries (manager + reload), kept at the *end*
  // of the menu — after any plugin-contributed actions — with a separator
  // before them, mirroring DataLab desktop (and using the same icons).
  const fixed: ActionDescriptor[] = [
    {
      id: "plugins.manager",
      label: t("Manage plugins…"),
      menuPath: "Plugins/Manage plugins…",
      iconUrl: getRootIconUrl("libre-gui-settings.svg"),
      beginGroup: true,
      enabled: ready,
      run: cb.onOpenManager,
    },
    {
      id: "plugins.reload_all",
      label: t("Reload all plugins"),
      menuPath: "Plugins/Reload all plugins",
      iconUrl: getRootIconUrl("refresh-auto.svg"),
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
      iconUrl: getFeatureIconUrl(entry.icon),
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

  return [...dynamic, ...fixed];
}
