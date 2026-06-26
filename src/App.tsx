import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRuntime } from "./runtime/RuntimeContext";
import { useWorkspace } from "./runtime/WorkspaceContext";
import { DataLabRuntime } from "./runtime/runtime";
import { useBeforeUnloadGuard } from "./runtime/useBeforeUnloadGuard";
import { useDocumentTitle } from "./runtime/useDocumentTitle";
import { REMOTE_MODEL_CHANGED_EVENT } from "./runtime/remoteBridge";
import { registerSelectionSource } from "./runtime/selectionState";
import type {
  FeatureDescriptor,
  H5BrowserFile,
  H5BrowserNode,
  ImageData,
  InteractiveFitInfo,
  JsonSchema,
  PanelTree,
  PluginMenuAction,
  PlotResultsSchemaEntry,
  SchemaWithValues,
  SignalData,
} from "./runtime/runtime";
import { MenuBar } from "./components/MenuBar";
import { CommandPalette } from "./components/CommandPalette";
import { Toolbar } from "./components/Toolbar";
import {
  buildAIAssistantActions,
  buildFeatureActions,
  buildHelpActions,
  buildImageAnalysisActions,
  buildImageCreationActions,
  buildImageGridActions,
  buildImageRoiActions,
  buildImageEraseActions,
  buildInteractiveFitActions,
  buildPluginActions,
  buildPlotResultsAction,
  buildRoiActions,
  buildSignalAnalysisActions,
  buildSignalCreationActions,
  buildStaticActions,
  buildViewActions,
} from "./actions/registry";
import { ObjectTree } from "./components/ObjectTree";
import type { ObjectTreeHandle } from "./components/ObjectTree";
import {
  ObjectNavigationProvider,
  type OidLookupEntry,
  type GroupLookupEntry,
} from "./components/ObjectNavigationContext";
import { ContextMenu } from "./components/ContextMenu";
import { buildObjectContextMenu } from "./actions/buildMenu";
import { TreeKindSwitcher } from "./components/TreeKindSwitcher";
import {
  CentralViewSwitcher,
  type CentralView,
} from "./components/CentralViewSwitcher";
import { SignalPlot } from "./components/SignalPlot";
import { ImagePlot } from "./components/ImagePlot";
import {
  MultiImagePlot,
  MULTI_IMAGE_LIMIT,
  MULTI_IMAGE_MAX_SIZE,
} from "./components/MultiImagePlot";
import { MultiImageSpatialPlot } from "./components/MultiImageSpatialPlot";
import { DataSetDialog } from "./components/DataSetDialog";
import {
  ProfileDefinitionDialog,
  type ProfileFeatureId,
} from "./components/ProfileDefinitionDialog";
import { OperandPicker } from "./components/OperandPicker";
import { HelpDialog, type HelpView } from "./components/HelpDialog";
import { ReleaseNotesDialog } from "./components/releasenotes/ReleaseNotesDialog";
import {
  markConsoleErrorsSeen,
  useConsoleErrorTitlePrefix,
} from "./utils/consoleLog";
import { DialogBridge } from "./components/DialogBridge";
import { t } from "./i18n/translate";
import { useTranslation } from "./i18n/I18nProvider";
import {
  useConfirm,
  useMessage,
  useProcessingError,
  usePrompt,
} from "./components/ConfirmDialog";
import { EdgeSlowLoadHint } from "./components/EdgeSlowLoadHint";
import { useProgress } from "./components/ProgressDialog";
import { ProcessingOrchestrator } from "./runtime/ProcessingOrchestrator";
import { pyodideLang } from "./i18n/locale";
import {
  SeparateViewDialog,
  type SeparateViewContent,
} from "./components/SeparateViewDialog";
import { InteractiveFitDialog } from "./components/InteractiveFitDialog";
import { PluginManagerDialog } from "./components/PluginManagerDialog";
import { ObjectPropertiesDialog } from "./components/ObjectPropertiesDialog";
import { RoiPanel } from "./components/RoiPanel";
import type { RoiDrawGeometry } from "./components/RoiPanel";
import { RoiGridDialog } from "./components/RoiGridDialog";
import { H5BrowserDialog } from "./components/H5BrowserDialog";
import { RecoveryBanner } from "./components/RecoveryBanner";
import {
  SaveToDirectoryDialog,
  type SaveToDirectoryResult,
  type SaveToDirectorySource,
} from "./components/SaveToDirectoryDialog";
import { TextImportWizard } from "./components/TextImportWizard";
import { SidePanel } from "./components/SidePanel";
import { AIAssistantPanel } from "./components/AIAssistant/AIAssistantPanel";
import { UserGuidePanel } from "./components/userguide/UserGuidePanel";
import {
  WelcomeView,
  readShowWelcomeOnStartup,
} from "./components/welcome/WelcomeView";
import { GuidedTour } from "./components/welcome/GuidedTour";
import {
  buildDefaultTourSteps,
  type TourContext,
} from "./components/welcome/tourSteps";
import { AISettingsDialog } from "./components/AIAssistant/AISettingsDialog";
import { Splitter } from "./components/Splitter";
import { FloatingDockStack } from "./components/FloatingDock";
import { DraggableFloating } from "./components/DraggableFloating";
import { type MacroPanelHandle } from "./components/MacroPanel";
import { type NotebookPanelHandle } from "./components/notebook/NotebookPanel";
import { useTheme } from "./utils/theme";
import { pickDirectoryRecursive, groupByFolder } from "./utils/pickDirectory";
import { formatBytes } from "./utils/memory";
import { listRecent } from "./storage/recentStore";
import type {
  AnalysisResult,
  ImageCreationType,
  ImageRoiSegment,
  ObjectMeta,
  PanelKind,
  PlotlyAnnotations,
  SignalAnalysisDescriptor,
  SignalCreationType,
  SignalRoiSegment,
} from "./runtime/runtime";

// The Macro and Notebook panels pull in the CodeMirror editor stack (and,
// transitively, the macro/notebook worker glue). They are mounted only
// once the runtime is ready — i.e. after the 30-60 s Pyodide boot — so
// loading their chunk lazily keeps CodeMirror out of the initial bundle
// at no perceived cost: the chunk is fetched during/after boot, well
// before the user can open an editor.
const MacroPanel = lazy(() =>
  import("./components/MacroPanel").then((m) => ({ default: m.MacroPanel })),
);
const NotebookPanel = lazy(() =>
  import("./components/notebook/NotebookPanel").then((m) => ({
    default: m.NotebookPanel,
  })),
);

interface PendingFeature {
  feature: FeatureDescriptor;
  sourceIds: string[];
  operandId: string | null;
  schema: SchemaWithValues | null;
  /** Selected source group ids (group-exclusive processing); ``[]`` when
   *  individual objects were selected. */
  groupIds: string[];
}

/** Image features whose parameters are also editable graphically through
 *  :class:`ProfileDefinitionDialog` (mirrors DataLab desktop's
 *  ``ProfileExtractionDialog``).  Ids carry the ``image:`` namespace
 *  prefix added by ``bootstrap._build_full_catalog`` to avoid colliding
 *  with same-named signal features. */
const PROFILE_FEATURE_IDS = new Set<string>([
  "image:line_profile",
  "image:segment_profile",
  "image:average_profile",
]);

/** Pending parametric analysis waiting for the user's parameter input. */
interface PendingAnalysis {
  funcId: string;
  label: string;
  schema: SchemaWithValues;
  kind: "signal" | "image";
}

/** Sequential "Plot results" dialog state: one dialog per result category
 *  found across the selected objects (mirrors DataLab desktop, which loops
 *  over result categories). */
interface PendingPlotResults {
  /** Snapshot of the source object ids at invocation time. */
  ids: string[];
  /** Title of the (get-or-create) "Results" signal group. */
  groupName: string;
  /** One entry per plottable result category. */
  entries: PlotResultsSchemaEntry[];
  /** Index of the category currently shown in the dialog. */
  index: number;
  /** Ids of every result signal created so far across categories. */
  createdIds: string[];
}

/** Build the (hand-made, fully localised) DataSet schema for one
 *  "Plot results" category dialog.  Mirrors DataLab desktop's
 *  ``__create_plot_result_param_class``: a plot-kind choice plus X / Y
 *  axis choices populated from the result's numeric columns. */
function buildPlotResultsSchema(
  entry: PlotResultsSchemaEntry,
): SchemaWithValues {
  const xChoices = [
    { value: "indices", label: t("Indices") },
    ...entry.numeric_headers.map((h) => ({ value: h, label: h })),
  ];
  const yChoices = entry.numeric_headers.map((h) => ({ value: h, label: h }));
  const properties: Record<string, JsonSchema> = {
    kind: {
      "x-guidata-kind": "choice",
      "x-guidata-label": t("Plot kind"),
      "x-guidata-choices": [
        {
          value: "one_curve_per_object",
          label: t("One curve per object (or ROI) and per result title"),
        },
        {
          value: "one_curve_per_title",
          label: t("One curve per result title"),
        },
      ],
    },
    xaxis: {
      "x-guidata-kind": "choice",
      "x-guidata-label": t("X axis"),
      "x-guidata-choices": xChoices,
    },
    yaxis: {
      "x-guidata-kind": "choice",
      "x-guidata-label": t("Y axis"),
      "x-guidata-choices": yChoices,
    },
  };
  const schema: JsonSchema = {
    type: "object",
    properties,
    "x-guidata-property-order": ["kind", "xaxis", "yaxis"],
    description: t("Plot results obtained from previous analyses."),
  };
  return {
    schema,
    values: {
      kind: entry.default_kind,
      xaxis: "indices",
      yaxis: yChoices[0]?.value ?? "",
    },
  };
}

/** Persist a numeric layout dimension to localStorage so it survives a
 *  page reload. */
function usePersistedSize(
  key: string,
  defaultValue: number,
): [number, (next: number) => void] {
  const [value, setValue] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return defaultValue;
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : defaultValue;
    } catch {
      return defaultValue;
    }
  });
  const update = useCallback(
    (next: number) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        /* ignore quota / disabled storage */
      }
    },
    [key],
  );
  return [value, update];
}

const SHOW_RESULTS_OVERLAY_KEY = "datalab-web.show-results-overlay";
const SHOW_GRAPHICAL_TITLES_KEY = "datalab-web.show-graphical-titles";
const SHOW_TOOLBAR_KEY = "datalab-web.show-toolbar";
// Multi-image view mode: ``false`` = read-only CSS grid (default),
// ``true`` = spatial overlay honouring each image's x0/y0/dx/dy.
const MULTI_IMAGE_SPATIAL_KEY = "datalab-web.multi-image-spatial";

function collectSupportedH5NodeIds(
  node: H5BrowserNode,
  out: Set<string>,
): void {
  if (node.is_supported) out.add(node.id);
  for (const child of node.children) collectSupportedH5NodeIds(child, out);
}

/** Persist a boolean preference to localStorage. */
function usePersistedBool(
  key: string,
  defaultValue: boolean,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return raw === "true";
    } catch {
      return defaultValue;
    }
  });
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        /* ignore quota / disabled storage */
      }
    },
    [key],
  );
  return [value, update];
}

export default function App() {
  const { runtime, status, message, error } = useRuntime();
  const workspace = useWorkspace();
  const confirm = useConfirm();
  const notify = useMessage();
  const showProcessingError = useProcessingError();
  const prompt = usePrompt();
  const runWithProgress = useProgress();
  // Interruptible processing: a lazily-spawned compute worker runs the heavy
  // Sigima call off the kernel so the user can cancel it (by terminating the
  // worker) without a ``SharedArrayBuffer``. Owned here so one worker is reused
  // across processings and disposed on unmount. See ``ProcessingOrchestrator``.
  const orchestratorRef = useRef<ProcessingOrchestrator | null>(null);
  useEffect(() => {
    if (!runtime) return;
    const orch = new ProcessingOrchestrator(runtime, pyodideLang());
    orchestratorRef.current = orch;
    if (import.meta.env.DEV) {
      // Expose for ad-hoc debugging and E2E probes (the cancellable path
      // runs a *second* Pyodide in the compute worker, which only a
      // browser-driven test can exercise). Mirrors ``window.runtime``.
      (
        window as unknown as { orchestrator?: ProcessingOrchestrator }
      ).orchestrator = orch;
    }
    return () => {
      orch.dispose();
      orchestratorRef.current = null;
    };
  }, [runtime]);
  const [hasMetadataClipboard, setHasMetadataClipboard] = useState(false);
  const {
    dirty: workspaceDirty,
    filename: workspaceFilename,
    recovered: workspaceRecovered,
    markDirty,
    markClean,
    setFilename: setWorkspaceFilename,
  } = workspace;
  // Window-title + reload-guard: the HDF5 workspace file is the single
  // durable contract. Anything in-memory that diverges from it must be
  // signalled (•) and protected against accidental reloads. See
  // ``runtime/WorkspaceContext.tsx``.
  useDocumentTitle({
    filename: workspaceFilename,
    dirty: workspaceDirty,
    recovered: workspaceRecovered,
  });
  useBeforeUnloadGuard(workspaceDirty);
  const [treeKind, setTreeKind] = useState<PanelKind>("signal");
  // Live mirror of ``treeKind`` for async guards: a fire-and-forget
  // ``refresh()`` started for one panel must not write its results after
  // the user (or a proxy/notebook call) switched to the other panel. See
  // the staleness check in ``refresh`` below.
  const treeKindRef = useRef<PanelKind>(treeKind);
  treeKindRef.current = treeKind;
  const [centralView, setCentralView] = useState<CentralView>("plot");
  const notebookPanelRef = useRef<NotebookPanelHandle | null>(null);
  const macroPanelRef = useRef<MacroPanelHandle | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = usePersistedSize(
    "datalab-web.leftPanelWidth",
    280,
  );
  const [sidePanelWidth, setSidePanelWidth] = usePersistedSize(
    "datalab-web.sidePanelWidth",
    360,
  );
  const [aiPanelVisible, setAIPanelVisible] = usePersistedBool(
    "datalab-web.aiPanelVisible",
    false,
  );
  const [aiPanelCollapsed, setAIPanelCollapsed] = usePersistedBool(
    "datalab-web.aiPanelCollapsed",
    false,
  );
  const toggleAIPanel = useCallback(() => {
    setAIPanelVisible(!aiPanelVisible);
    // Re-opening from the menu always shows the full panel, never the
    // pill — otherwise the menu entry would seem to do nothing if the
    // panel had been minimised before the previous hide.
    if (!aiPanelVisible) setAIPanelCollapsed(false);
  }, [aiPanelVisible, setAIPanelVisible, setAIPanelCollapsed]);
  // Unconditionally open and expand the AI Assistant panel (used by the
  // Welcome page card, where toggling would be confusing if the panel
  // happened to be already visible).
  const openAIPanel = useCallback(() => {
    setAIPanelVisible(true);
    setAIPanelCollapsed(false);
  }, [setAIPanelVisible, setAIPanelCollapsed]);
  // Command palette (VSCode-style quick command launcher). Toggled by
  // the menu-bar button and the global Ctrl/Cmd+K shortcut.
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Ctrl+K (Windows/Linux) or Cmd+K (macOS), without other modifiers.
      const key = event.key.toLowerCase();
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        key === "k"
      ) {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Notebook / Macro placement.  Each can independently be docked as
  // the central tab (default) or detached as a floating overlay in
  // the right-hand :class:`FloatingDockStack`.  The panels stay
  // mounted across placement changes — see the portal/stable-host
  // pattern in the JSX below.
  const [notebookFloating, setNotebookFloating] = usePersistedBool(
    "datalab-web.notebookFloating",
    false,
  );
  const [macroFloating, setMacroFloating] = usePersistedBool(
    "datalab-web.macroFloating",
    false,
  );
  const toggleNotebookFloating = useCallback(() => {
    const next = !notebookFloating;
    setNotebookFloating(next);
    // When detaching, free the central area so the user keeps seeing
    // the plot rather than a blank tab slot.
    if (next) {
      setCentralView((cv) => (cv === "notebook" ? "plot" : cv));
    } else {
      // When docking back, give focus to the freshly-restored tab.
      setCentralView("notebook");
    }
  }, [notebookFloating, setNotebookFloating]);
  const toggleMacroFloating = useCallback(() => {
    const next = !macroFloating;
    setMacroFloating(next);
    if (next) {
      setCentralView((cv) => (cv === "macro" ? "plot" : cv));
    } else {
      setCentralView("macro");
    }
  }, [macroFloating, setMacroFloating]);
  // Stable DOM containers for the Notebook / Macro panels.  They are
  // moved between the central area and the FloatingDockStack via
  // ``appendChild`` rather than being unmounted / remounted, so the
  // panels' React state (cell outputs, kernel worker, editor
  // selection) survives every placement toggle.  ``createPortal``
  // always targets the same element, so React itself never tears
  // down the panel subtree.
  // Stable DOM containers for the Notebook / Macro panels.  They are
  // moved between the central area and the FloatingDockStack via
  // ``appendChild`` rather than being unmounted / remounted, so the
  // panels' React state (cell outputs, kernel worker, editor
  // selection) survives every placement toggle.  ``createPortal``
  // always targets the same element, so React itself never tears
  // down the panel subtree.  We use ``useRef`` (not ``useMemo``) so
  // the element is *guaranteed* stable for the lifetime of the App
  // — ``useMemo`` may legitimately recompute and would silently
  // orphan the previous portal element.
  const notebookPortalElRef = useRef<HTMLDivElement | null>(null);
  if (notebookPortalElRef.current === null && typeof document !== "undefined") {
    const el = document.createElement("div");
    el.className = "nb-panel-portal";
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.flex = "1 1 auto";
    el.style.minWidth = "0";
    el.style.minHeight = "0";
    el.style.width = "100%";
    el.style.height = "100%";
    notebookPortalElRef.current = el;
  }
  const notebookPortalEl = notebookPortalElRef.current;
  const macroPortalElRef = useRef<HTMLDivElement | null>(null);
  if (macroPortalElRef.current === null && typeof document !== "undefined") {
    const el = document.createElement("div");
    el.className = "macro-panel-portal";
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.flex = "1 1 auto";
    el.style.minWidth = "0";
    el.style.minHeight = "0";
    el.style.width = "100%";
    el.style.height = "100%";
    macroPortalElRef.current = el;
  }
  const macroPortalEl = macroPortalElRef.current;
  // DOM-side hosts: where each panel's portal element should live
  // *right now*.  We track both the "central" host (a div inside the
  // plot area, visible only when the panel owns the central tab) and
  // the "floating" host (a div inside the FloatingDockStack, visible
  // only when the panel is detached).  The effect below moves the
  // portal element between the two.
  const [notebookCentralHost, setNotebookCentralHost] =
    useState<HTMLDivElement | null>(null);
  const [notebookFloatingHost, setNotebookFloatingHost] =
    useState<HTMLDivElement | null>(null);
  const [macroCentralHost, setMacroCentralHost] =
    useState<HTMLDivElement | null>(null);
  const [macroFloatingHost, setMacroFloatingHost] =
    useState<HTMLDivElement | null>(null);
  // ``useLayoutEffect`` (not ``useEffect``) so the DOM reparenting
  // happens *synchronously* after React has committed its own DOM
  // mutations and *before* the browser paints — avoiding any flash
  // of the portal element in its old location.  When no valid target
  // exists yet (e.g. the floating wrapper hasn't been ref'd by React
  // at this exact commit pass), we still detach the portal from any
  // stale parent so it can't keep visually lingering in a wrapper
  // React has already unmounted.
  useLayoutEffect(() => {
    if (!notebookPortalEl) return;
    const target = notebookFloating
      ? notebookFloatingHost
      : notebookCentralHost;
    if (target) {
      if (notebookPortalEl.parentNode !== target) {
        target.appendChild(notebookPortalEl);
      }
    } else if (notebookPortalEl.parentNode) {
      notebookPortalEl.parentNode.removeChild(notebookPortalEl);
    }
  }, [
    notebookPortalEl,
    notebookFloating,
    notebookCentralHost,
    notebookFloatingHost,
  ]);
  useLayoutEffect(() => {
    if (!macroPortalEl) return;
    const target = macroFloating ? macroFloatingHost : macroCentralHost;
    if (target) {
      if (macroPortalEl.parentNode !== target) {
        target.appendChild(macroPortalEl);
      }
    } else if (macroPortalEl.parentNode) {
      macroPortalEl.parentNode.removeChild(macroPortalEl);
    }
  }, [macroPortalEl, macroFloating, macroCentralHost, macroFloatingHost]);
  const [showAISettings, setShowAISettings] = useState(false);
  // View > "Show results overlay on plot" toggle.  Off by default
  // because the right-hand Results panel already renders the same
  // numbers in a structured grid.  Useful when the user pops out
  // the panel or hides it.
  const [showResultsOverlay, setShowResultsOverlay] = usePersistedBool(
    SHOW_RESULTS_OVERLAY_KEY,
    false,
  );
  const toggleResultsOverlay = useCallback(
    () => setShowResultsOverlay(!showResultsOverlay),
    [showResultsOverlay, setShowResultsOverlay],
  );
  // View > "Show graphical object titles" toggle.  On by default to
  // mirror DataLab desktop, where ROI labels and analysis-result text
  // (FWHM, segment lengths, peak names…) are visible out of the box.
  const [showGraphicalTitles, setShowGraphicalTitles] = usePersistedBool(
    SHOW_GRAPHICAL_TITLES_KEY,
    true,
  );
  const toggleGraphicalTitles = useCallback(
    () => setShowGraphicalTitles(!showGraphicalTitles),
    [showGraphicalTitles, setShowGraphicalTitles],
  );
  // View > "Show toolbar" toggle.  On by default to mirror DataLab
  // desktop, which always shows its toolbars.
  const [showToolbar, setShowToolbar] = usePersistedBool(
    SHOW_TOOLBAR_KEY,
    true,
  );
  const toggleToolbar = useCallback(
    () => setShowToolbar(!showToolbar),
    [showToolbar, setShowToolbar],
  );
  // View > "View in a new window…" — opens a full-screen modal hosting
  // the current selection's plot, so the user can see it without the
  // surrounding panels.
  const [separateViewOpen, setSeparateViewOpen] = useState(false);
  const openSeparateView = useCallback(() => setSeparateViewOpen(true), []);
  const closeSeparateView = useCallback(() => setSeparateViewOpen(false), []);
  const [tree, setTree] = useState<PanelTree | null>(null);
  /** Lightweight snapshot of the *other* panel (metadata only). Kept
   *  in sync alongside :state:`tree` so :class:`TitleWithLinks` can
   *  resolve hex short ids that live in the inactive panel (e.g.
   *  signal sources of an image profile result). */
  const [inactiveTree, setInactiveTree] = useState<PanelTree | null>(null);
  const [selectedIds, _setSelectedIdsRaw] = useState<string[]>([]);
  // Bail out on no-op updates: callers commonly pass a freshly-created
  // array (`[id]`, `[...prev]`, `prev.filter(...)`) even when the
  // semantic value is unchanged. Returning a new reference triggers
  // useEffect re-fires across the App and was the root cause of an
  // infinite render loop on the guided tour transition 12→13.
  const setSelectedIds = useCallback(
    (arg: string[] | ((prev: string[]) => string[])) => {
      _setSelectedIdsRaw((prev) => {
        const raw = typeof arg === "function" ? arg(prev) : arg;
        // Normalise to unique ids (keep first occurrence, preserve order).
        // Group navigation builds the selection from a group's object
        // list (`grp.objects.map(o => o.id)`); a duplicate there would
        // otherwise reach `MultiImagePlot`, whose cells are keyed by
        // object id, producing React "duplicate key" warnings and the
        // ensuing reconciliation loop. Deduping centrally protects every
        // consumer (multi-image grid, ROI checks, processing sources).
        const next =
          raw.length > 1 && new Set(raw).size !== raw.length
            ? [...new Set(raw)]
            : raw;
        if (
          next === prev ||
          (next.length === prev.length && next.every((id, i) => id === prev[i]))
        ) {
          return prev;
        }
        return next;
      });
    },
    [],
  );
  const [currentId, setCurrentId] = useState<string | null>(null);
  /** Explicitly selected GROUP ids (group-exclusive selection, mirroring
   *  DataLab desktop). Empty when individual objects are selected. When
   *  non-empty, applying a processing creates new result group(s). */
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [data, setData] = useState<SignalData | null>(null);
  /** Other signals selected alongside ``currentId`` — overlaid on top
   *  of ``data`` in :class:`SignalPlot` to mirror DataLab desktop's
   *  multi-curve plot. */
  const [extraSignals, setExtraSignals] = useState<SignalData[]>([]);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  /** Other images selected alongside ``currentId`` - laid out as a
   *  read-only grid in :class:`MultiImagePlot` to mirror DataLab
   *  desktop's multi-image viewer. */
  const [extraImages, setExtraImages] = useState<ImageData[]>([]);
  /** Multi-image view mode: ``false`` = thumbnail grid (default),
   *  ``true`` = spatial overlay honouring each image's origin so the
   *  "Distribute on a grid" / "Reset positions" geometry tools are
   *  observable.  Persisted across reloads. */
  const [spatialMultiImage, setSpatialMultiImage] = usePersistedBool(
    MULTI_IMAGE_SPATIAL_KEY,
    false,
  );
  const [features, setFeatures] = useState<FeatureDescriptor[]>([]);
  const [busy, setBusy] = useState(false);
  /** Live counts of macros / notebooks reported by their panels.
   *  Used to enable "Save HDF5 workspace…" for workspaces that
   *  contain only macros or notebooks (no signals/images). */
  const [macroCount, setMacroCount] = useState(0);
  const [notebookCount, setNotebookCount] = useState(0);
  /**
   * Bumped every time the Python ``_STORE`` is wholesale replaced
   * (e.g. opening an HDF5 workspace with ``replace=True``). Used as
   * the React ``key`` of the Macro and Notebook panels so they are
   * remounted and re-hydrate from the runtime instead of clinging to
   * the previous workspace's tabs.
   */
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  /**
   * Cold-start recovery banner state (PR 2 of the workspace-dirty UX
   * work). When the macro / notebook panels rehydrate from the
   * IndexedDB "Recent…" cache on first mount, we surface a one-time
   * informational banner reminding the user that signals/images do
   * **not** survive a reload — only HDF5 saves are durable.
   *
   * ``null`` while we haven't checked yet; ``{ macros, notebooks }``
   * once we know how many entries the cache held when the page
   * loaded; reset to ``null`` after Save / Dismiss.
   */
  const [recoveryBanner, setRecoveryBanner] = useState<{
    macros: number;
    notebooks: number;
  } | null>(null);
  // Guard: evaluate the banner only once per mount. We don't want it
  // to reappear after the user opens an HDF5 (which clears recovered
  // via ``markClean``) and then reloads — that's a normal cycle.
  const recoveryEvaluated = useRef(false);
  const [pending, setPending] = useState<PendingFeature | null>(null);
  const [pendingProfile, setPendingProfile] = useState<{
    feature: FeatureDescriptor;
    sourceIds: string[];
    schema: SchemaWithValues;
    imageData: ImageData;
    groupIds: string[];
  } | null>(null);
  const [pendingOperand, setPendingOperand] = useState<{
    feature: FeatureDescriptor;
    sourceIds: string[];
    groupIds: string[];
  } | null>(null);
  const [editingMeta, setEditingMeta] = useState<ObjectMeta | null>(null);
  const [helpView, setHelpView] = useState<HelpView | null>(null);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  // Persistent error indicator: prefix the tab title with "(!) " when
  // any browser-console ``warn``/``error`` entry is still unseen.
  useConsoleErrorTitlePrefix();
  // Opening the Browser console log dialog acknowledges every buffered
  // entry, so the menu-bar indicator and the title prefix both clear.
  useEffect(() => {
    if (helpView === "console") markConsoleErrorsSeen();
  }, [helpView]);
  // Persistent error indicator: prefix the tab title with "(!) " when
  // any browser-console ``warn``/``error`` entry is still unseen.
  useConsoleErrorTitlePrefix();
  // Opening the Browser console log dialog acknowledges every buffered
  // entry, so the menu-bar indicator and the title prefix both clear.
  useEffect(() => {
    if (helpView === "console") markConsoleErrorsSeen();
  }, [helpView]);
  const [userGuideOpen, setUserGuideOpen] = useState(false);
  // Welcome view: shown automatically on first load (and any time the
  // workspace is empty) unless the user has unchecked "Show welcome on
  // startup".  Also re-openable on demand from Help > Welcome, in
  // which case it overrides the empty/non-empty heuristic via
  // ``welcomeForced``.
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [welcomeForced, setWelcomeForced] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  // IDs of demo objects seeded by the guided tour — cleared when the
  // tour closes. We track them in a ref so the cleanup runs without
  // re-triggering render-time effects.
  const tourDemoIdsRef = useRef<string[]>([]);
  // Snapshot of treeKind / centralView taken when the tour starts, so
  // we can restore the user's previous context on close.
  const tourSnapshotRef = useRef<{
    treeKind: PanelKind;
    centralView: CentralView;
  } | null>(null);
  const [h5BrowserFiles, setH5BrowserFiles] = useState<H5BrowserFile[] | null>(
    null,
  );
  const [textImportOpen, setTextImportOpen] = useState(false);
  /** Pending "Save to directory…" dialog. ``null`` when the dialog is
   *  closed; otherwise carries the source signal ids (with their
   *  human-readable group/title labels) and the writable extensions list
   *  fetched from Sigima. */
  const [pendingSaveToDir, setPendingSaveToDir] = useState<{
    sources: SaveToDirectorySource[];
    extensions: string[];
  } | null>(null);
  const [pluginActions, setPluginActions] = useState<PluginMenuAction[]>([]);
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
  const [annotations, setAnnotations] = useState<PlotlyAnnotations>({
    shapes: [],
    annotations: [],
  });
  const [roi, setRoi] = useState<SignalRoiSegment[]>([]);
  const [roiEditMode, setRoiEditMode] = useState<boolean>(false);
  const [imageRoi, setImageRoi] = useState<ImageRoiSegment[]>([]);
  const [imageRoiEditMode, setImageRoiEditMode] = useState<boolean>(false);
  /** Index of the ROI whose form is shown in the docked ROI panel
   *  (``null`` ⇒ none selected). Shared by signal & image editors. */
  const [selectedRoiIndex, setSelectedRoiIndex] = useState<number | null>(null);
  /** Geometry currently armed for graphical drawing on the plot
   *  (``null`` ⇒ no draw tool armed). Drives the plot ``dragmode``. */
  const [roiDrawGeometry, setRoiDrawGeometry] =
    useState<RoiDrawGeometry | null>(null);
  /** Vertex index of the selected polygon ROI whose coordinate cell is being
   *  edited in the ROI panel (``null`` ⇒ none). Highlighted on the plot. */
  const [activeRoiVertex, setActiveRoiVertex] = useState<number | null>(null);
  /** Persisted LUT range override for the current image (``null`` ⇒
   *  fall back to the image's intrinsic ``data_min``/``data_max``).
   *  Driven by the contrast tool inside :class:`ImagePlot`. */
  const [imageLutRange, setImageLutRange] = useState<[number, number] | null>(
    null,
  );
  /** Transient "erase area" session: when active, the docked ROI panel and
   *  the image plot edit ``eraseRegions`` (not persisted on the object); the
   *  panel's primary button runs ``eraseImageArea`` on those regions.
   *  Mirrors DataLab desktop's ``Processing > Restoration > Erase area…``. */
  const [imageEraseMode, setImageEraseMode] = useState<boolean>(false);
  const [eraseRegions, setEraseRegions] = useState<ImageRoiSegment[]>([]);
  const [signalTypes, setSignalTypes] = useState<SignalCreationType[]>([]);
  const [imageTypes, setImageTypes] = useState<ImageCreationType[]>([]);
  const [analysisEntries, setAnalysisEntries] = useState<
    SignalAnalysisDescriptor[]
  >([]);
  const [imageAnalysisEntries, setImageAnalysisEntries] = useState<
    SignalAnalysisDescriptor[]
  >([]);
  const [pendingAnalysis, setPendingAnalysis] =
    useState<PendingAnalysis | null>(null);
  const [pendingPlotResults, setPendingPlotResults] =
    useState<PendingPlotResults | null>(null);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  /** Analysis results attached to the other selected signals (excluding
   *  ``currentId``).  Merged with ``results`` in :class:`SignalPlot` so
   *  geometry overlays (FWHM segments, peak markers, …) are drawn for
   *  every selected signal, not just the displayed one.  The right-hand
   *  Results panel keeps showing ``currentId``'s results only. */
  const [extraResults, setExtraResults] = useState<AnalysisResult[]>([]);
  const [sideRefreshNonce, setSideRefreshNonce] = useState(0);
  // Bumped after any action that mutates the *current* object's
  // metadata (paste / add / delete / import metadata).  Metadata can
  // carry ROIs, Plotly annotations and analysis results that are drawn
  // on the central plot, so the plot-data effect re-reads them when
  // this counter changes — mirroring DataLab desktop's "refresh the
  // selected object's plot after a metadata action".
  const [plotRefreshNonce, setPlotRefreshNonce] = useState(0);
  // ``true`` when at least one selected object has a ROI.  Drives the
  // enablement of the ROI "Remove all" action so it matches DataLab
  // desktop's ``SelectCond.with_roi`` (enabled when *any* selected
  // object carries a ROI, not only the displayed one).
  const [selectionHasRoi, setSelectionHasRoi] = useState(false);
  // Whether the ROI clipboard holds a ROI compatible with the active
  // panel (signal vs image), so "Paste ROI" can be enabled.  Mirrors
  // DataLab desktop's per-panel ROI clipboard.
  const [hasRoiClipboard, setHasRoiClipboard] = useState(false);
  const [pendingImageGrid, setPendingImageGrid] = useState<{
    sourceIds: string[];
    schema: SchemaWithValues;
  } | null>(null);
  const [pendingRoiGrid, setPendingRoiGrid] = useState<{
    oid: string;
    schema: SchemaWithValues;
  } | null>(null);
  const [interactiveFits, setInteractiveFits] = useState<InteractiveFitInfo[]>(
    [],
  );
  const [pendingFit, setPendingFit] = useState<{
    fit: InteractiveFitInfo;
    oid: string;
  } | null>(null);
  const [preferredSideTab, setPreferredSideTab] = useState<
    "creation" | "properties" | "results"
  >("properties");

  const theme = useTheme().theme;

  const refresh = useCallback(
    async (preferredCurrentId?: string | null) => {
      if (!runtime) return;
      const kind = treeKind;
      const newTree = await runtime.getPanelTree(kind);
      // Staleness guard: if the active panel changed while we were
      // awaiting (e.g. a fire-and-forget ``refresh()`` for the signal
      // panel resolving after a notebook/proxy call switched to images),
      // dropping these writes prevents an inconsistent state where
      // ``currentId`` would point at an object of the *other* kind — which
      // made the central viewer call ``get_image_data`` on a 1-D
      // ``SignalObj`` (``IndexError: tuple index out of range``).
      if (treeKindRef.current !== kind) return;
      setTree(newTree);
      // A model mutation invalidates any prior group-exclusive selection.
      setSelectedGroupIds([]);
      const allIds: string[] = [];
      for (const g of newTree.groups)
        for (const o of g.objects) allIds.push(o.id);
      setSelectedIds((prev) => prev.filter((id) => allIds.includes(id)));
      setCurrentId((prev) => {
        if (preferredCurrentId && allIds.includes(preferredCurrentId)) {
          return preferredCurrentId;
        }
        if (prev && allIds.includes(prev)) return prev;
        return allIds[0] ?? null;
      });
      if (preferredCurrentId && allIds.includes(preferredCurrentId)) {
        setSelectedIds([preferredCurrentId]);
      }
    },
    [runtime, treeKind, setSelectedIds],
  );

  /** Refresh a panel that may differ from the current ``treeKind``,
   *  switching the tree (and central view back to plot) in the
   *  process.  Used by cross-kind processings whose result lands in a
   *  different panel than the source. */
  const refreshPanelKind = useCallback(
    async (kind: PanelKind, preferredCurrentId?: string | null) => {
      if (!runtime) return;
      setTreeKind(kind);
      setCentralView("plot");
      // Reset the per-panel selection state *synchronously* with the
      // ``treeKind`` switch so the central viewer effect cannot fire
      // an intermediate render where ``treeKind`` already points at
      // the new panel while ``currentId`` still holds an OID from the
      // previous one — that mismatch caused ``get_image_data`` /
      // ``get_signal_xy`` to be called with the wrong kind of object
      // (IndexError on a 1D SignalObj fed to the image fetcher;
      // AttributeError when an ImageObj reached the signal fetcher).
      setCurrentId(null);
      setSelectedIds([]);
      setSelectedGroupIds([]);
      const newTree = await runtime.getPanelTree(kind);
      setTree(newTree);
      const allIds: string[] = [];
      for (const g of newTree.groups)
        for (const o of g.objects) allIds.push(o.id);
      if (preferredCurrentId && allIds.includes(preferredCurrentId)) {
        setCurrentId(preferredCurrentId);
        setSelectedIds([preferredCurrentId]);
      } else {
        setCurrentId(allIds[0] ?? null);
        setSelectedIds([]);
      }
    },
    [runtime, setSelectedIds],
  );

  // Refresh the UI whenever a remote-control RPC mutates the object
  // model (signal/image added/removed, processing applied…). The
  // bridge in ``remoteBridge.ts`` dispatches this CustomEvent on
  // ``window`` so we don't need to wire a callback through the
  // RuntimeContext provider.
  useEffect(() => {
    if (!runtime) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ panel: string | null }>).detail;
      const target = detail?.panel;
      if (target === "signal" || target === "image") {
        if (target === treeKind) {
          void refresh();
          // ``refresh()`` only re-reads the tree/selection. When a
          // remote/macro/notebook/AI call mutates the *current*
          // object's metadata (title, axis labels/units, ROIs…)
          // without changing ``currentId``, the central plot-data
          // effect wouldn't otherwise re-run and the graph would keep
          // stale axis titles/units. Bump the plot nonce so it
          // re-fetches the displayed object's data.
          setPlotRefreshNonce((n) => n + 1);
        } else {
          // The result landed in a panel the user isn't looking at.
          // Don't yank them away — they'll see it on next switch.
        }
      } else {
        // Unknown / null panel: best-effort refresh of the active one.
        void refresh();
        setPlotRefreshNonce((n) => n + 1);
      }
    };
    window.addEventListener(REMOTE_MODEL_CHANGED_EVENT, handler);
    return () => {
      window.removeEventListener(REMOTE_MODEL_CHANGED_EVENT, handler);
    };
  }, [runtime, treeKind, refresh]);

  // Workspace-dirty tracking.
  //
  // The runtime tags every Python helper that mutates durable state
  // (``MUTATING_PY_FUNCTIONS`` in ``runtime.ts``) and notifies
  // listeners after each successful call. We subscribe once and flip
  // the workspace context's ``dirty`` flag — UI indicators (window
  // title •, ``beforeunload`` guard) react automatically.
  //
  // ``Open HDF5 workspace…`` and ``Save HDF5 workspace…`` are the
  // only *clean* transitions; they call ``markClean()`` directly
  // (see ``handleSaveWorkspaceHdf5`` / ``handleOpenWorkspaceHdf5``).
  useEffect(() => {
    if (!runtime) return;
    const unsubscribe = runtime.onWorkspaceMutation(() => {
      markDirty();
    });
    return unsubscribe;
  }, [runtime, markDirty]);

  // Sync the "Paste metadata" availability from the Python clipboard
  // once the runtime is ready. The Python ``_METADATA_CLIPBOARD`` is
  // preserved across HMR reloads, so the React flag (which resets to
  // ``false`` on every reload) must be re-derived from it.
  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    void (async () => {
      const has = await runtime.hasMetadataInClipboard();
      if (!cancelled) setHasMetadataClipboard(has);
    })();
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  // Cold-start "Recent…" hint: once after the runtime is ready and no
  // HDF5 file is associated with this session, peek at the IndexedDB
  // "Recent…" cache. Macros and notebooks are no longer silently
  // restored (they are only reachable through each panel's "Recent…"
  // menu), so if the cache holds any edited documents we surface a
  // one-time informational banner telling the user where to find them.
  // The workspace itself stays clean / non-recovered — HDF5 is still
  // the single durable source of truth.
  useEffect(() => {
    if (status !== "ready") return;
    if (recoveryEvaluated.current) return;
    if (workspaceFilename !== null) return;
    recoveryEvaluated.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const [macros, notebooks] = await Promise.all([
          listRecent("macro"),
          listRecent("notebook"),
        ]);
        if (cancelled) return;
        if (macros.length === 0 && notebooks.length === 0) return;
        setRecoveryBanner({
          macros: macros.length,
          notebooks: notebooks.length,
        });
      } catch {
        /* IndexedDB unavailable — banner stays hidden. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, workspaceFilename]);

  // Auto-hide the "Recent…" hint once the user has opened or saved an
  // HDF5 workspace: they are now in a named, durable workspace and the
  // cold-start hint is no longer relevant.
  useEffect(() => {
    if (recoveryBanner !== null && workspaceFilename !== null) {
      setRecoveryBanner(null);
    }
  }, [recoveryBanner, workspaceFilename]);

  useEffect(() => {
    if (status !== "ready" || !runtime) return;
    let cancelled = false;
    runtime.listFeatures().then((v) => {
      if (!cancelled) setFeatures(v);
    });
    runtime.listSignalCreationTypes().then((v) => {
      if (!cancelled) setSignalTypes(v);
    });
    runtime.listImageCreationTypes().then((v) => {
      if (!cancelled) setImageTypes(v);
    });
    runtime.listSignalAnalysis().then((v) => {
      if (!cancelled) setAnalysisEntries(v);
    });
    runtime.listImageAnalysis().then((v) => {
      if (!cancelled) setImageAnalysisEntries(v);
    });
    runtime.listPluginMenuActions().then((v) => {
      if (!cancelled) setPluginActions(v);
    });
    runtime.listInteractiveFits().then((v) => {
      if (!cancelled) setInteractiveFits(v);
    });
    refresh();
    return () => {
      cancelled = true;
    };
  }, [status, runtime, refresh]);

  useEffect(() => {
    if (!runtime || !currentId) {
      setData(null);
      setExtraSignals([]);
      setImageData(null);
      setExtraImages([]);
      setAnnotations({ shapes: [], annotations: [] });
      setRoi([]);
      setImageRoi([]);
      setImageLutRange(null);
      setResults([]);
      setExtraResults([]);
      return;
    }
    let cancelled = false;
    if (treeKind === "image") {
      // Image panel: viewer + ROI + analysis results.
      setData(null);
      setExtraSignals([]);
      setExtraResults([]);
      setAnnotations({ shapes: [], annotations: [] });
      setRoi([]);
      setImageLutRange(null);
      runtime
        .getImageData(currentId)
        .then((d) => {
          if (!cancelled) setImageData(d);
        })
        .catch(() => {
          if (!cancelled) setImageData(null);
        });
      // Fetch the other selected images (excluding the current one) so
      // they can be laid out side-by-side in MultiImagePlot.  We cap
      // the request at MULTI_IMAGE_LIMIT to keep the bridge payload
      // bounded; the component renders a "+N more" banner when the
      // selection exceeds that limit.
      const extraImgIds = selectedIds
        .filter((id) => id !== currentId)
        .slice(0, MULTI_IMAGE_LIMIT - 1);
      if (extraImgIds.length === 0) {
        setExtraImages([]);
      } else {
        runtime
          .getImagesData(extraImgIds, MULTI_IMAGE_MAX_SIZE)
          .then((imgs) => {
            if (!cancelled) setExtraImages(imgs);
          })
          .catch(() => {
            if (!cancelled) setExtraImages([]);
          });
      }
      runtime
        .getImageRoi(currentId)
        .then((segs) => {
          if (!cancelled) setImageRoi(segs);
        })
        .catch(() => {
          if (!cancelled) setImageRoi([]);
        });
      runtime
        .getLutRange(currentId)
        .then((r) => {
          if (!cancelled) setImageLutRange(r);
        })
        .catch(() => {
          if (!cancelled) setImageLutRange(null);
        });
      runtime
        .listImageResults(currentId)
        .then((rs) => {
          if (!cancelled) setResults(rs);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
      return () => {
        cancelled = true;
      };
    }
    setImageData(null);
    setExtraImages([]);
    setImageRoi([]);
    runtime
      .getSignalData(currentId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    // Fetch the other selected signals (excluding the current one) so
    // they can be overlaid on the same plot.
    const extraIds = selectedIds.filter((id) => id !== currentId);
    if (extraIds.length === 0) {
      setExtraSignals([]);
      setExtraResults([]);
    } else {
      runtime
        .getSignalsData(extraIds)
        .then((sigs) => {
          if (!cancelled) setExtraSignals(sigs);
        })
        .catch(() => {
          if (!cancelled) setExtraSignals([]);
        });
      // Also fetch their analysis results so geometry overlays (FWHM
      // segments, peak markers, …) are drawn for every selected signal,
      // not only the displayed one.
      Promise.all(extraIds.map((id) => runtime.listSignalResults(id)))
        .then((lists) => {
          if (!cancelled) setExtraResults(lists.flat());
        })
        .catch(() => {
          if (!cancelled) setExtraResults([]);
        });
    }
    runtime
      .getPlotlyAnnotations(currentId)
      .then((a) => {
        if (!cancelled) setAnnotations(a);
      })
      .catch(() => {
        if (!cancelled) setAnnotations({ shapes: [], annotations: [] });
      });
    runtime
      .getSignalRoi(currentId)
      .then((segs) => {
        if (!cancelled) setRoi(segs);
      })
      .catch(() => {
        if (!cancelled) setRoi([]);
      });
    runtime
      .listSignalResults(currentId)
      .then((rs) => {
        if (!cancelled) setResults(rs);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, currentId, treeKind, selectedIds, plotRefreshNonce]);

  const handleSelectionChange = useCallback(
    (ids: string[], current: string | null, groupIds?: string[]) => {
      // If the user clicks on a signal/image in the (always visible)
      // ObjectTree while the central view is showing a macro or
      // notebook editor, snap the central view back to the plot so
      // the selection is actually visible.  The editor stays mounted
      // (display:none) so its scroll/cursor/input state survive.
      if (centralView !== "plot" && ids.length > 0) {
        setCentralView("plot");
      }
      setSelectedIds(ids);
      setCurrentId(current);
      // Objects XOR groups (mirrors desktop): a group click passes the
      // selected group ids; any other selection clears the group selection.
      setSelectedGroupIds(groupIds ?? []);
    },
    [centralView, setSelectedIds],
  );

  // Track whether *any* selected object has a ROI, so the ROI "Remove
  // all" action can be enabled for the whole selection (and not only
  // when the displayed object has a ROI), mirroring DataLab desktop's
  // ``SelectCond.with_roi``.  Recomputed on selection changes and after
  // plot-affecting metadata mutations (``plotRefreshNonce``).
  useEffect(() => {
    if (!runtime) {
      setSelectionHasRoi(false);
      return;
    }
    const ids = selectedIds.length ? selectedIds : currentId ? [currentId] : [];
    if (ids.length === 0) {
      setSelectionHasRoi(false);
      return;
    }
    let cancelled = false;
    runtime
      .objectsHaveRoi(ids)
      .then((has) => {
        if (!cancelled) setSelectionHasRoi(has);
      })
      .catch(() => {
        if (!cancelled) setSelectionHasRoi(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, selectedIds, currentId, plotRefreshNonce]);

  // Track whether the ROI clipboard holds a ROI matching the active panel
  // kind (signal vs image), so the "Paste ROI" action can be enabled.
  // Re-evaluated when switching panels or after a copy (``plotRefreshNonce``).
  useEffect(() => {
    if (!runtime) {
      setHasRoiClipboard(false);
      return;
    }
    let cancelled = false;
    runtime
      .hasRoiInClipboard(treeKind)
      .then((has) => {
        if (!cancelled) setHasRoiClipboard(has);
      })
      .catch(() => {
        if (!cancelled) setHasRoiClipboard(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, treeKind, plotRefreshNonce]);

  // Publish selection / panel snapshots to non-React consumers (the
  // iframe-embedded remote bridge in particular, so host pages can
  // call ``client.getSelection()`` / target the *current* object).
  useEffect(() => {
    registerSelectionSource(() => ({
      ids: selectedIds,
      currentId,
      panel: centralView === "plot" ? treeKind : centralView,
    }));
    return () => registerSelectionSource(null);
  }, [selectedIds, currentId, centralView, treeKind]);

  const handleTreeKindChange = useCallback(
    (kind: PanelKind) => {
      if (kind === treeKind) return;
      setTreeKind(kind);
      setSelectedIds([]);
      setCurrentId(null);
      setData(null);
      setExtraSignals([]);
      setImageData(null);
      setRoi([]);
      setImageRoi([]);
      setResults([]);
    },
    [treeKind, setSelectedIds],
  );

  const handleCentralViewChange = useCallback(
    (view: CentralView) => {
      // Clicking a detached tab re-docks it as the central view, so
      // users always have a discoverable way back to the tab layout
      // (in addition to the panel's own "↙ Dock" toolbar button).
      if (view === "notebook" && notebookFloating) {
        setNotebookFloating(false);
        setCentralView(view);
        return;
      }
      if (view === "macro" && macroFloating) {
        setMacroFloating(false);
        setCentralView(view);
        return;
      }
      if (view === centralView) return;
      setCentralView(view);
    },
    [
      centralView,
      notebookFloating,
      macroFloating,
      setNotebookFloating,
      setMacroFloating,
    ],
  );

  // Keep ``inactiveTree`` in sync with the panel the user *isn't*
  // looking at, so :class:`TitleWithLinks` can resolve cross-panel
  // hex short ids. Re-runs whenever the active tree refreshes or the
  // user switches panels — both are cheap metadata fetches.
  useEffect(() => {
    if (!runtime) {
      setInactiveTree(null);
      return;
    }
    const other: PanelKind = treeKind === "signal" ? "image" : "signal";
    let cancelled = false;
    runtime
      .getPanelTree(other)
      .then((t) => {
        if (!cancelled) setInactiveTree(t);
      })
      .catch(() => {
        if (!cancelled) setInactiveTree(null);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, treeKind, tree]);

  /** ``oid → { kind, node }`` lookup spanning both panel trees. Used
   *  by :class:`TitleWithLinks` to decide whether a hex token in a
   *  computation title is a real source id (→ render a link) or an
   *  accidental match (→ render plain text). */
  const oidIndex = useMemo<Map<string, OidLookupEntry>>(() => {
    const map = new Map<string, OidLookupEntry>();
    for (const t of [tree, inactiveTree]) {
      if (!t) continue;
      for (const g of t.groups) {
        for (const o of g.objects) {
          map.set(o.id, { kind: t.kind, node: o });
        }
      }
    }
    return map;
  }, [tree, inactiveTree]);

  /** Group-id index across both panels, parallel to {@link oidIndex}.
   *  Lets :class:`TitleWithLinks` resolve the source-group tokens that
   *  appear in result-group titles (``fft(g3f5b2c1)``). */
  const groupIndex = useMemo<Map<string, GroupLookupEntry>>(() => {
    const map = new Map<string, GroupLookupEntry>();
    for (const t of [tree, inactiveTree]) {
      if (!t) continue;
      for (const g of t.groups) {
        map.set(g.gid, { kind: t.kind, name: g.name });
      }
    }
    return map;
  }, [tree, inactiveTree]);
  const navigateToOid = useCallback(
    (oid: string) => {
      const entry = oidIndex.get(oid);
      if (!entry) return;
      if (entry.kind !== treeKind) {
        void refreshPanelKind(entry.kind, oid);
      } else {
        if (centralView !== "plot") setCentralView("plot");
        setSelectedIds([oid]);
        setCurrentId(oid);
      }
    },
    [oidIndex, treeKind, centralView, refreshPanelKind, setSelectedIds],
  );

  /** Select the source group behind a group token in a result title.
   *  Switches panels when the group lives in the inactive panel. */
  const navigateToGroup = useCallback(
    (gid: string) => {
      const entry = groupIndex.get(gid);
      if (!entry) return;
      const selectGroup = (t: PanelTree | null) => {
        const grp = t?.groups.find((g) => g.gid === gid);
        if (!grp) return;
        const ids = grp.objects.map((o) => o.id);
        if (centralView !== "plot") setCentralView("plot");
        setSelectedIds(ids);
        setCurrentId(ids[0] ?? null);
        setSelectedGroupIds([gid]);
      };
      if (entry.kind !== treeKind) {
        void refreshPanelKind(entry.kind).then(async () => {
          selectGroup((await runtime?.getPanelTree(entry.kind)) ?? null);
        });
      } else {
        selectGroup(tree);
      }
    },
    [
      groupIndex,
      treeKind,
      tree,
      centralView,
      refreshPanelKind,
      setSelectedIds,
      runtime,
    ],
  );

  /** Resolve the group id hosting the currently-selected object in the
   *  active panel, so newly-created objects land next to the user's
   *  current focus (mirrors DataLab desktop's behaviour). Returns
   *  ``undefined`` when no selection exists — the runtime then falls
   *  back to the default group. */
  const currentSelectionGroupId = useCallback((): string | undefined => {
    if (!tree) return undefined;
    const oid = currentId ?? selectedIds[0];
    if (!oid) return undefined;
    for (const g of tree.groups) {
      if (g.objects.some((o) => o.id === oid)) return g.gid;
    }
    return undefined;
  }, [tree, currentId, selectedIds]);

  const handleCreateTyped = useCallback(
    async (stype: string) => {
      if (!runtime) return;
      setBusy(true);
      try {
        const id = await runtime.createSignalTyped(
          stype,
          currentSelectionGroupId(),
        );
        setPreferredSideTab("creation");
        await refresh(id);
        setSideRefreshNonce((n) => n + 1);
      } finally {
        setBusy(false);
      }
    },
    [runtime, refresh, currentSelectionGroupId],
  );

  const handleCreateImageTyped = useCallback(
    async (stype: string) => {
      if (!runtime) return;
      setBusy(true);
      try {
        const id = await runtime.createImageTyped(
          stype,
          currentSelectionGroupId(),
        );
        setPreferredSideTab("creation");
        await refresh(id);
        setSideRefreshNonce((n) => n + 1);
      } finally {
        setBusy(false);
      }
    },
    [runtime, refresh, currentSelectionGroupId],
  );

  const handleSideObjectChanged = useCallback(
    async (oid: string) => {
      if (!runtime) return;
      // The Creation/Properties form just mutated the object — refresh
      // the plot data and the tree (title / size may have changed).
      try {
        if (treeKind === "image") {
          const updated = await runtime.getImageData(oid);
          setImageData(updated);
        } else {
          const updated = await runtime.getSignalData(oid);
          setData(updated);
        }
      } catch {
        /* ignore — object may have been deleted */
      }
      await refresh(oid);
      // Re-fetch the side panel's schema/values from the backend so the
      // form's "applied" baseline matches what was actually stored
      // (including any normalization), and so a subsequent object
      // selection cannot leak the previous draft.
      setSideRefreshNonce((n) => n + 1);
    },
    [runtime, refresh, treeKind],
  );

  /** Effective sources for *feature* given the current selection. */
  const sourcesFor = useCallback(
    (feature: FeatureDescriptor): string[] => {
      if (feature.pattern === "n_to_1") {
        return selectedIds.length > 0
          ? selectedIds
          : currentId
            ? [currentId]
            : [];
      }
      // 1_to_1 / 2_to_1: loop over all selected (fallback to current)
      return selectedIds.length > 0
        ? selectedIds
        : currentId
          ? [currentId]
          : [];
    },
    [selectedIds, currentId],
  );

  /** Group ids to process group-wise: the explicit group selection,
   *  filtered to groups still present in the active panel tree. Empty
   *  when the user selected individual objects (object-exclusive). */
  const effectiveGroupIds = useCallback((): string[] => {
    if (selectedGroupIds.length === 0 || !tree) return [];
    const present = new Set(tree.groups.map((g) => g.gid));
    return selectedGroupIds.filter((gid) => present.has(gid));
  }, [selectedGroupIds, tree]);

  const runFeature = useCallback(
    async (
      feature: FeatureDescriptor,
      sourceIds: string[],
      operandId: string | null,
      values: Record<string, unknown> | null,
      groupIds: string[] = [],
    ) => {
      if (!runtime) return;
      setBusy(true);
      try {
        // Cancellable path: a built-in feature (present in the compute
        // worker's catalogue) applied to *selected objects* runs in the
        // disposable worker so the user can interrupt it. The group-exclusive
        // path and plugin features (``plugin:`` prefix, not in the worker
        // catalogue) stay in-kernel via ``applyFeature``.
        const orch = orchestratorRef.current;
        const useWorker =
          orch !== null &&
          groupIds.length === 0 &&
          !feature.id.startsWith("plugin:");
        let newIds: string[];
        if (useWorker) {
          const { results, cancelled } = await runWithProgress<string[]>({
            title: t("Computing: {feature}", { feature: feature.label }),
            total: 1,
            step: async (_i, { signal }) => {
              // Wire the dialog's Cancel button (and Esc) to terminate the
              // compute worker; ``runFeature`` then rejects and the run is
              // reported as cancelled with the model left untouched.
              const onAbort = () => orch.cancel();
              signal.addEventListener("abort", onAbort, { once: true });
              try {
                return await orch.runFeature({
                  featureId: feature.id,
                  sourceIds,
                  operandId,
                  params: values,
                });
              } finally {
                signal.removeEventListener("abort", onAbort);
              }
            },
          });
          if (cancelled) return; // user aborted — nothing was committed
          newIds = results[0] ?? [];
        } else {
          newIds = await runtime.applyFeature(
            feature.id,
            sourceIds,
            operandId,
            values,
            groupIds,
          );
        }
        const lastId = newIds[newIds.length - 1] ?? null;
        if (feature.output_kind !== feature.object_kind) {
          // Cross-kind: result lands in a different panel — switch to it
          // and refresh that panel's tree explicitly (cannot rely on the
          // ``refresh`` closure that reads the stale ``treeKind``).
          await refreshPanelKind(feature.output_kind, lastId);
        } else {
          await refresh(lastId);
        }
      } catch (err) {
        // A computation raising in Sigima/Pyodide (e.g. gamma correction on
        // an image with negative values) is a *processing* problem, not a
        // crash: surface the full traceback in a copy-pasteable modal
        // (mirroring DataLab desktop) so the user understands their
        // request could not be honoured. The traceback is also logged to
        // the browser console by the runtime.
        await showProcessingError({
          context: t("Computing: {feature}", { feature: feature.label }),
          traceback: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(false);
      }
    },
    [runtime, refresh, refreshPanelKind, showProcessingError, runWithProgress],
  );

  const refreshPluginActions = useCallback(async () => {
    if (!runtime) return;
    setPluginActions(await runtime.listPluginMenuActions());
  }, [runtime]);

  const handleTriggerPluginAction = useCallback(
    async (actionId: string) => {
      if (!runtime) return;
      setBusy(true);
      try {
        const added = await runtime.triggerPluginAction(actionId);
        // Mirror desktop's implicit selection of newly-added objects.
        // Image takes precedence over signal when both panels grew
        // (rare but consistent with the desktop's last-touched panel).
        const newImage = added.image[added.image.length - 1] ?? null;
        const newSignal = added.signal[added.signal.length - 1] ?? null;
        if (newImage && treeKind !== "image") {
          await refreshPanelKind("image", newImage);
        } else if (newSignal && treeKind !== "signal") {
          await refreshPanelKind("signal", newSignal);
        } else {
          await refresh(
            treeKind === "image" ? newImage : (newSignal ?? newImage),
          );
        }
      } catch (err) {
        await showProcessingError({
          context: t("Plugin action: {action}", {
            action:
              pluginActions.find((a) => a.action_id === actionId)?.title ??
              actionId,
          }),
          traceback: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(false);
      }
    },
    [
      runtime,
      refresh,
      refreshPanelKind,
      treeKind,
      pluginActions,
      showProcessingError,
    ],
  );

  const handleReloadPlugins = useCallback(async () => {
    if (!runtime) return;
    setBusy(true);
    try {
      await runtime.reloadPlugins();
      await refreshPluginActions();
      await runtime.listFeatures().then(setFeatures);
    } finally {
      setBusy(false);
    }
  }, [runtime, refreshPluginActions]);

  const handleApplyFeature = useCallback(
    async (featureId: string) => {
      if (!runtime) return;
      const feature = features.find((f) => f.id === featureId);
      if (!feature) return;
      const sourceIds = sourcesFor(feature);
      if (sourceIds.length === 0) return;
      const groupIds = effectiveGroupIds();
      if (feature.pattern === "n_to_1" && sourceIds.length < 2) {
        // n_to_1 needs at least 2 sources to be meaningful; let it through
        // if Sigima accepts a single-element list, otherwise the error
        // surfaces in the console.
      }
      if (feature.pattern === "2_to_1") {
        setPendingOperand({ feature, sourceIds, groupIds });
        return;
      }
      if (feature.has_params) {
        const schema = await runtime.getFeatureSchema(featureId, sourceIds[0]);
        if (schema) {
          // Image → signal profile features get a richer dialog with an
          // interactive shape overlay on the source image, mirroring
          // DataLab desktop's ``ProfileExtractionDialog``.
          if (
            PROFILE_FEATURE_IDS.has(feature.id) &&
            sourceIds.length > 0 &&
            feature.object_kind === "image"
          ) {
            try {
              const imgData = await runtime.getImageData(sourceIds[0]);
              setPendingProfile({
                feature,
                sourceIds,
                schema,
                imageData: imgData,
                groupIds,
              });
              return;
            } catch (err) {
              console.error("[profile] failed to fetch image data", err);
              // Fall back to the regular dialog so the user can still
              // type values manually.
            }
          }
          setPending({ feature, sourceIds, operandId: null, schema, groupIds });
          return;
        }
      }
      await runFeature(feature, sourceIds, null, null, groupIds);
    },
    [runtime, features, sourcesFor, runFeature, effectiveGroupIds],
  );

  const handleOperandChosen = useCallback(
    async (operandId: string) => {
      if (!runtime || !pendingOperand) return;
      const { feature, sourceIds, groupIds } = pendingOperand;
      setPendingOperand(null);
      if (feature.has_params) {
        const schema = await runtime.getFeatureSchema(feature.id);
        if (schema) {
          setPending({ feature, sourceIds, operandId, schema, groupIds });
          return;
        }
      }
      await runFeature(feature, sourceIds, operandId, null, groupIds);
    },
    [runtime, pendingOperand, runFeature],
  );

  const handleSubmitParams = useCallback(
    async (values: Record<string, unknown>) => {
      if (!pending) return;
      const { feature, sourceIds, operandId, groupIds } = pending;
      setPending(null);
      await runFeature(feature, sourceIds, operandId, values, groupIds);
    },
    [pending, runFeature],
  );

  const handleSubmitProfile = useCallback(
    async (values: Record<string, unknown>) => {
      if (!pendingProfile) return;
      const { feature, sourceIds, groupIds } = pendingProfile;
      setPendingProfile(null);
      await runFeature(feature, sourceIds, null, values, groupIds);
    },
    [pendingProfile, runFeature],
  );

  // Extract a frozen cross-section profile from the image viewer as a new
  // signal, reusing the Sigima ``line_profile`` feature (mirrors DataLab
  // desktop's "Process signal" button next to the cross-section panels).
  const handleExtractProfile = useCallback(
    async (params: {
      direction: "horizontal" | "vertical";
      row: number;
      col: number;
    }) => {
      if (!runtime || !currentId) return;
      const feature = features.find((f) => f.id === "image:line_profile");
      if (!feature) return;
      // Start from the feature's default parameter values so any item we do
      // not set keeps its default, then override direction + position.
      const schema = await runtime.getFeatureSchema(feature.id, currentId);
      const values: Record<string, unknown> = {
        ...(schema?.values ?? {}),
        direction: params.direction,
        row: params.row,
        col: params.col,
      };
      await runFeature(feature, [currentId], null, values, effectiveGroupIds());
    },
    [runtime, currentId, features, runFeature, effectiveGroupIds],
  );

  const refreshResults = useCallback(
    async (oid: string) => {
      if (!runtime) return;
      const rs =
        treeKind === "image"
          ? await runtime.listImageResults(oid)
          : await runtime.listSignalResults(oid);
      setResults(rs);
    },
    [runtime, treeKind],
  );

  const runAnalysis = useCallback(
    async (
      funcId: string,
      params: Record<string, unknown> | null,
      oids: string[],
    ) => {
      if (!runtime || oids.length === 0) return;
      setBusy(true);
      try {
        let anyResult = false;
        let currentRoiModified = false;
        // Run the analysis on every selected object, not just the
        // displayed one, mirroring DataLab desktop's behaviour.
        for (const oid of oids) {
          const result =
            treeKind === "image"
              ? await runtime.runImageAnalysis(oid, funcId, params)
              : await runtime.runSignalAnalysis(oid, funcId, params);
          if (result !== null) {
            anyResult = true;
            if (
              oid === currentId &&
              (result as { roi_modified?: boolean }).roi_modified
            ) {
              currentRoiModified = true;
            }
          }
        }
        if (!anyResult) {
          await notify({
            kind: "info",
            message:
              "The analysis function returned no result " +
              "(e.g. FWHM on a flat curve, or no peak detected).",
          });
        }
        // Refresh the displayed object's results (right-hand panel) and,
        // for the signal panel, the overlay results of the other selected
        // signals so geometry markers are drawn for the whole selection.
        if (currentId) {
          await refreshResults(currentId);
          if (treeKind !== "image") {
            const extraIds = oids.filter((id) => id !== currentId);
            if (extraIds.length > 0) {
              try {
                const lists = await Promise.all(
                  extraIds.map((id) => runtime.listSignalResults(id)),
                );
                setExtraResults(lists.flat());
              } catch {
                /* non-fatal: overlays just won't refresh */
              }
            }
          }
        }
        setPreferredSideTab("results");
        setSideRefreshNonce((n) => n + 1);
        // Detection analyses (peak / blob / hough / contour) may have
        // attached new ROIs to the displayed image when ``create_rois``
        // is ticked.  Re-fetch the ROI list so the plot overlay updates
        // immediately, mirroring DataLab desktop's behaviour.
        if (treeKind === "image" && currentRoiModified && currentId) {
          try {
            const segs = await runtime.getImageRoi(currentId);
            setImageRoi(segs);
          } catch {
            /* non-fatal */
          }
        }
      } catch (err) {
        const catalog =
          treeKind === "image" ? imageAnalysisEntries : analysisEntries;
        const label = catalog.find((e) => e.id === funcId)?.label ?? funcId;
        await showProcessingError({
          context: t("Computing: {feature}", { feature: label }),
          traceback: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(false);
      }
    },
    [
      runtime,
      refreshResults,
      treeKind,
      notify,
      showProcessingError,
      currentId,
      analysisEntries,
      imageAnalysisEntries,
    ],
  );

  const handleFreeMemory = useCallback(async () => {
    if (!runtime) return;
    try {
      const result = await runtime.freeMemory();
      const after = formatBytes(result.wasmAfter);
      await notify({
        kind: "info",
        title: t("Free memory"),
        message: t(
          "Freed {collected} unused objects. The engine still reserves {after}; reload the page to return it to the browser.",
          { collected: result.collected, after },
        ),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await notify({
        kind: "error",
        message: t("Free memory failed: {message}", { message }),
      });
    }
  }, [runtime, notify]);

  // View > "Store data on disk" toggle. When on, the runtime spills
  // each object's heavy array to the browser's Origin Private File
  // System and keeps it resident only for the duration of a referencing
  // computation, so the WASM heap stays flat regardless of the number of
  // objects. Off by default (RAM mode); unavailable in insecure
  // contexts or engines without OPFS.
  const [storeOnDisk, setStoreOnDisk] = useState(false);
  const [storageBusy, setStorageBusy] = useState(false);
  const handleToggleStoreOnDisk = useCallback(async () => {
    if (!runtime || storageBusy) return;
    const next = !storeOnDisk;
    setStorageBusy(true);
    try {
      await runtime.setStorageMode(next ? "disk" : "ram");
      setStoreOnDisk(next);
      await notify({
        kind: "info",
        title: t("Data storage"),
        message: next
          ? t(
              "On-disk storage enabled. Object data is kept on disk and loaded only when needed, keeping memory usage low.",
            )
          : t("On-disk storage disabled. Object data is kept in memory."),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await notify({
        kind: "error",
        message: t("Could not switch data storage mode: {message}", {
          message,
        }),
      });
    } finally {
      setStorageBusy(false);
    }
  }, [runtime, storeOnDisk, storageBusy, notify]);

  const handleAnalysis = useCallback(
    async (funcId: string, hasParams: boolean) => {
      if (!runtime || !currentId) return;
      // Target every selected object (falling back to the current one),
      // so the analysis is computed for the whole selection.
      const targetIds = selectedIds.length > 0 ? selectedIds : [currentId];
      if (!hasParams) {
        await runAnalysis(funcId, null, targetIds);
        return;
      }
      const schema =
        treeKind === "image"
          ? await runtime.getImageAnalysisParamSchema(currentId, funcId)
          : await runtime.getSignalAnalysisParamSchema(currentId, funcId);
      if (!schema) {
        await runAnalysis(funcId, null, targetIds);
        return;
      }
      const catalog =
        treeKind === "image" ? imageAnalysisEntries : analysisEntries;
      const entry = catalog.find((e) => e.id === funcId);
      setPendingAnalysis({
        funcId,
        label: entry?.label ?? funcId,
        schema: schema as SchemaWithValues,
        kind: treeKind === "image" ? "image" : "signal",
      });
    },
    [
      runtime,
      currentId,
      selectedIds,
      analysisEntries,
      imageAnalysisEntries,
      treeKind,
      runAnalysis,
    ],
  );

  const handleSubmitAnalysisParams = useCallback(
    async (values: Record<string, unknown>) => {
      if (!pendingAnalysis || !currentId) return;
      const { funcId } = pendingAnalysis;
      setPendingAnalysis(null);
      const targetIds = selectedIds.length > 0 ? selectedIds : [currentId];
      await runAnalysis(funcId, values, targetIds);
    },
    [pendingAnalysis, currentId, selectedIds, runAnalysis],
  );

  // "Analysis ▸ Plot results": aggregate the numeric analysis results
  // stored on the selected objects into new result signals. Opens one
  // dialog per result category (mirrors DataLab desktop).
  const handlePlotResults = useCallback(async () => {
    if (!runtime) return;
    const ids = selectedIds.length ? selectedIds : currentId ? [currentId] : [];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const entries = await runtime.getPlotResultsSchemas(ids);
      if (entries.length === 0) {
        await notify({
          kind: "info",
          title: t("Plot results"),
          message: t(
            "No analysis results to plot. Run an Analysis feature first.",
          ),
        });
        return;
      }
      setPendingPlotResults({
        ids,
        groupName: t("Results"),
        entries,
        index: 0,
        createdIds: [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await notify({
        kind: "error",
        message: t("Plot results failed: {message}", { message }),
      });
    } finally {
      setBusy(false);
    }
  }, [runtime, selectedIds, currentId, notify]);

  // Close the dialog queue: when the last category is done, switch to the
  // signal panel and reveal the new result signals (if any were created).
  const finishOrAdvancePlotResults = useCallback(
    async (next: PendingPlotResults) => {
      if (next.index < next.entries.length) {
        setPendingPlotResults(next);
        return;
      }
      setPendingPlotResults(null);
      if (next.createdIds.length > 0) {
        await refreshPanelKind("signal", next.createdIds[0]);
        setPreferredSideTab("results");
        setSideRefreshNonce((n) => n + 1);
      }
    },
    [refreshPanelKind],
  );

  const handleSubmitPlotResults = useCallback(
    async (values: Record<string, unknown>) => {
      if (!runtime || !pendingPlotResults) return;
      const { ids, groupName, entries, index, createdIds } = pendingPlotResults;
      const entry = entries[index];
      setBusy(true);
      try {
        const newIds = await runtime.plotResults({
          ids,
          category: entry.category,
          kind: String(values.kind),
          xaxis: String(values.xaxis),
          yaxis: String(values.yaxis),
          groupName,
        });
        await finishOrAdvancePlotResults({
          ...pendingPlotResults,
          index: index + 1,
          createdIds: [...createdIds, ...newIds],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await notify({
          kind: "error",
          message: t("Plot results failed: {message}", { message }),
        });
        // Mirror desktop's warn-and-continue: skip this category.
        await finishOrAdvancePlotResults({
          ...pendingPlotResults,
          index: index + 1,
        });
      } finally {
        setBusy(false);
      }
    },
    [runtime, pendingPlotResults, finishOrAdvancePlotResults, notify],
  );

  const handleCancelPlotResults = useCallback(() => {
    if (!pendingPlotResults) return;
    void finishOrAdvancePlotResults({
      ...pendingPlotResults,
      index: pendingPlotResults.index + 1,
    });
  }, [pendingPlotResults, finishOrAdvancePlotResults]);

  const handleLaunchInteractiveFit = useCallback(
    (fit: InteractiveFitInfo) => {
      if (!currentId) return;
      setPendingFit({ fit, oid: currentId });
    },
    [currentId],
  );

  const handleInteractiveFitCommit = useCallback(
    async (newOid: string) => {
      setPendingFit(null);
      await refresh(newOid);
    },
    [refresh],
  );

  const handleClearResults = useCallback(
    async (key: string | null) => {
      if (!runtime || !currentId) return;
      // "Clear all" (key === null) clears results on every selected
      // object, mirroring DataLab desktop's ``delete_results``; removing
      // a single result (key !== null) stays on the displayed object,
      // like the desktop per-result entry.
      const ids =
        key === null
          ? selectedIds.length
            ? selectedIds
            : [currentId]
          : [currentId];
      setBusy(true);
      try {
        for (const oid of ids) {
          if (treeKind === "image") {
            await runtime.clearImageResults(oid, key ?? undefined);
          } else {
            await runtime.clearSignalResults(oid, key ?? undefined);
          }
        }
        await refreshResults(currentId);
        if (treeKind !== "image") {
          const extraIds = ids.filter((id) => id !== currentId);
          if (extraIds.length > 0) {
            try {
              const lists = await Promise.all(
                extraIds.map((id) => runtime.listSignalResults(id)),
              );
              setExtraResults(lists.flat());
            } catch {
              /* non-fatal: overlays just won't refresh */
            }
          }
        }
        setSideRefreshNonce((n) => n + 1);
      } finally {
        setBusy(false);
      }
    },
    [runtime, currentId, selectedIds, refreshResults, treeKind],
  );

  const deleteObjects = useCallback(
    async (ids: string[]) => {
      if (!runtime || ids.length === 0) return;
      setBusy(true);
      try {
        for (const oid of ids) {
          await runtime.deleteObject(oid);
        }
        setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
        setCurrentId((prev) => (prev && ids.includes(prev) ? null : prev));
        await refresh(null);
      } finally {
        setBusy(false);
      }
    },
    [runtime, refresh, setSelectedIds],
  );

  // ---- Guided tour helpers ---------------------------------------
  //
  // The tour seeds a demo signal + image so its "object tree / plot /
  // properties" steps are not empty. We snapshot the active panel +
  // central view when the tour opens and restore them on close, then
  // delete the seeded objects so the user's workspace returns to its
  // pre-tour state.
  const seedDemoSignal = useCallback(async () => {
    if (!runtime) return;
    try {
      const id = await runtime.createSignalTyped("gauss");
      tourDemoIdsRef.current.push(id);
      await refresh(id);
    } catch (err) {
      console.error("Tour: failed to seed demo signal", err);
    }
  }, [runtime, refresh]);

  const seedDemoImage = useCallback(async () => {
    if (!runtime) return;
    try {
      const id = await runtime.createImageTyped("gauss");
      tourDemoIdsRef.current.push(id);
      await refreshPanelKind("image", id);
    } catch (err) {
      console.error("Tour: failed to seed demo image", err);
    }
  }, [runtime, refreshPanelKind]);

  const openTopMenu = useCallback((label: string) => {
    // MenuBar's onClick toggles ``openTop`` between ``label`` and
    // ``null``.  Setting state to ``label`` *implicitly closes* any
    // other top-level menu (only one is open at a time), so we can
    // skip the previous "dispatch a fake mousedown to close first"
    // dance — that two-phase approach caused the dropdown to render
    // one frame later than the highlight, which the user saw as the
    // menu being "shown twice" (closed then opened).
    const el = document.querySelector(
      `[data-menu-top="${label}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    // If this exact menu is already open, leave it open — clicking it
    // again would close it.
    if (el.classList.contains("open")) return;
    el.click();
  }, []);

  const closeTopMenu = useCallback(() => {
    // Close the currently open menu (if any) by clicking it again.
    const open = document.querySelector(
      ".menubar-top.open",
    ) as HTMLElement | null;
    open?.click();
  }, []);

  const tourContext = useMemo<TourContext>(
    () => ({
      setTreeKind: handleTreeKindChange,
      setCentralView: handleCentralViewChange,
      openTopMenu,
      closeTopMenu,
      seedDemoSignal,
      seedDemoImage,
    }),
    [
      handleTreeKindChange,
      handleCentralViewChange,
      openTopMenu,
      closeTopMenu,
      seedDemoSignal,
      seedDemoImage,
    ],
  );

  const tourSteps = useMemo(
    () => buildDefaultTourSteps(tourContext),
    [tourContext],
  );

  const handleStartTour = useCallback(() => {
    tourSnapshotRef.current = { treeKind, centralView };
    tourDemoIdsRef.current = [];
    setTourOpen(true);
  }, [treeKind, centralView]);

  const handleCloseTour = useCallback(() => {
    setTourOpen(false);
    // Defer cleanup so React commits the close before we mutate the
    // runtime / restore the snapshotted UI state.
    const ids = tourDemoIdsRef.current;
    tourDemoIdsRef.current = [];
    const snapshot = tourSnapshotRef.current;
    tourSnapshotRef.current = null;
    setTimeout(() => {
      closeTopMenu();
      if (ids.length > 0) {
        void deleteObjects(ids);
      }
      if (snapshot) {
        handleTreeKindChange(snapshot.treeKind);
        handleCentralViewChange(snapshot.centralView);
      }
    }, 0);
  }, [
    closeTopMenu,
    deleteObjects,
    handleTreeKindChange,
    handleCentralViewChange,
  ]);

  const handleDelete = useCallback(async () => {
    if (selectedIds.length === 0) return;
    // Mirror the trash-icon workflow in ObjectTree: always ask for
    // confirmation before deleting (whether triggered from the Edit menu,
    // the keyboard shortcut, or any other entry point).
    let message = `Delete ${selectedIds.length} selected object(s)?`;
    if (selectedIds.length === 1 && tree) {
      for (const g of tree.groups) {
        const o = g.objects.find((o) => o.id === selectedIds[0]);
        if (o) {
          message = `Delete "${o.title}"?`;
          break;
        }
      }
    }
    const ok = await confirm({
      title: "Delete",
      message,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await deleteObjects(selectedIds);
  }, [confirm, deleteObjects, selectedIds, tree]);

  const handleDeleteAll = useCallback(async () => {
    if (!runtime) return;
    const ok = await confirm({
      title: t("Delete all groups and objects"),
      message:
        treeKind === "image"
          ? t("Delete all groups and images? This cannot be undone.")
          : t("Delete all groups and signals? This cannot be undone."),
      confirmLabel: t("Delete all"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await runtime.deleteAllObjects(treeKind);
      setSelectedIds([]);
      setCurrentId(null);
      await refresh(null);
    } finally {
      setBusy(false);
    }
  }, [runtime, confirm, treeKind, refresh, setSelectedIds]);

  const handleNewGroup = useCallback(async () => {
    if (!runtime) return;
    setBusy(true);
    try {
      await runtime.createGroup(treeKind);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [runtime, refresh, treeKind]);

  const handleRenameObject = useCallback(
    async (oid: string, name: string) => {
      if (!runtime) return;
      await runtime.renameObject(oid, name);
      await refresh();
    },
    [runtime, refresh],
  );

  const handleRenameGroup = useCallback(
    async (gid: string, name: string) => {
      if (!runtime) return;
      await runtime.renameGroup(gid, name);
      await refresh();
    },
    [runtime, refresh],
  );

  const handleDeleteGroup = useCallback(
    async (gid: string) => {
      if (!runtime) return;
      setBusy(true);
      try {
        await runtime.deleteGroup(gid, treeKind);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [runtime, refresh, treeKind],
  );

  const handleMoveObjects = useCallback(
    async (oids: string[], target: string, index: number) => {
      if (!runtime || oids.length === 0) return;
      await runtime.moveObjects(oids, target, index);
      await refresh();
    },
    [runtime, refresh],
  );

  const objectTreeRef = useRef<ObjectTreeHandle | null>(null);

  const handleRenameCurrent = useCallback(() => {
    if (!currentId) return;
    objectTreeRef.current?.startRenameObject(currentId);
  }, [currentId]);

  const handleDuplicateSelection = useCallback(async () => {
    if (!runtime || selectedIds.length === 0) return;
    setBusy(true);
    try {
      const newIds: string[] = [];
      for (const oid of selectedIds) {
        newIds.push(await runtime.duplicateObject(oid));
      }
      await refresh(newIds[newIds.length - 1] ?? null);
      setSelectedIds(newIds);
    } finally {
      setBusy(false);
    }
  }, [runtime, refresh, selectedIds, setSelectedIds]);

  const handleMoveSelectionUp = useCallback(async () => {
    if (!runtime || !currentId) return;
    await runtime.moveObjectInGroup(currentId, -1);
    await refresh(currentId);
  }, [runtime, refresh, currentId]);

  const handleMoveSelectionDown = useCallback(async () => {
    if (!runtime || !currentId) return;
    await runtime.moveObjectInGroup(currentId, 1);
    await refresh(currentId);
  }, [runtime, refresh, currentId]);

  // --- Edit > Metadata + Copy titles to clipboard ----------------------
  /** Resolve a friendly basename for an object's exported metadata. */
  const titleForId = useCallback(
    (oid: string): string => {
      if (tree) {
        for (const g of tree.groups) {
          for (const o of g.objects) {
            if (o.id === oid) return o.title || oid;
          }
        }
      }
      return oid;
    },
    [tree],
  );

  const handleCopyMetadata = useCallback(async () => {
    if (!runtime || selectedIds.length !== 1) return;
    await runtime.copyObjectMetadata(selectedIds[0]);
    setHasMetadataClipboard(await runtime.hasMetadataInClipboard());
  }, [runtime, selectedIds]);

  const handlePasteMetadata = useCallback(async () => {
    if (!runtime || selectedIds.length === 0) return;
    setBusy(true);
    try {
      const done = await runtime.pasteObjectMetadata(selectedIds);
      if (done) {
        await refresh(currentId);
        setSideRefreshNonce((n) => n + 1);
        setPlotRefreshNonce((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  }, [runtime, selectedIds, currentId, refresh]);

  const handleAddMetadata = useCallback(async () => {
    if (!runtime || selectedIds.length === 0) return;
    setBusy(true);
    try {
      const done = await runtime.addObjectMetadata(selectedIds);
      if (done) {
        await refresh(currentId);
        setSideRefreshNonce((n) => n + 1);
        setPlotRefreshNonce((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  }, [runtime, selectedIds, currentId, refresh]);

  const handleDeleteMetadata = useCallback(async () => {
    if (!runtime || selectedIds.length === 0) return;
    let keepRoi = false;
    if (await runtime.objectsHaveRoi(selectedIds)) {
      // Mirror DataLab desktop: when ROIs are present, ask whether they
      // should be removed too (the confirm button deletes them).
      keepRoi = !(await confirm({
        title: t("Delete metadata"),
        message: t(
          "Some selected objects have regions of interest. Do you want to delete them as well?",
        ),
        confirmLabel: t("Delete ROIs"),
        cancelLabel: t("Keep ROIs"),
        destructive: true,
      }));
    }
    setBusy(true);
    try {
      await runtime.deleteObjectMetadata(selectedIds, keepRoi);
      await refresh(currentId);
      setSideRefreshNonce((n) => n + 1);
      setPlotRefreshNonce((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }, [runtime, selectedIds, currentId, refresh, confirm]);

  const handleExportMetadata = useCallback(async () => {
    if (!runtime || selectedIds.length !== 1) return;
    const oid = selectedIds[0];
    setBusy(true);
    try {
      const bytes = await runtime.exportObjectMetadataBytes(oid);
      const blob = new Blob([new Uint8Array(bytes)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${titleForId(oid)}.dlabmeta`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }, [runtime, selectedIds, titleForId]);

  const handleImportMetadata = useCallback(async () => {
    if (!runtime || selectedIds.length !== 1) return;
    const oid = selectedIds[0];
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".dlabmeta,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await runtime.importObjectMetadataBytes(oid, bytes);
        await refresh(oid);
        setSideRefreshNonce((n) => n + 1);
        setPlotRefreshNonce((n) => n + 1);
      } catch (err) {
        await notify({
          kind: "error",
          title: t("Import metadata"),
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }, [runtime, selectedIds, refresh, notify]);

  const handleCopyTitles = useCallback(async () => {
    if (!runtime) return;
    const text = await runtime.getPanelTitlesText(treeKind);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API may be unavailable (insecure context); fall back
      // to a hidden textarea + execCommand.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    }
  }, [runtime, treeKind]);

  // Object-tree context menu state.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const handleObjectContextMenu = useCallback(
    (_oid: string, x: number, y: number) => {
      setContextMenu({ x, y });
    },
    [],
  );
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleEditProperties = useCallback(async () => {
    if (!runtime || !currentId) return;
    const meta = await runtime.getObjectMeta(currentId);
    setEditingMeta(meta);
  }, [runtime, currentId]);

  const handleSubmitMeta = useCallback(
    async (values: ObjectMeta) => {
      if (!runtime || !currentId) return;
      await runtime.setObjectMeta(currentId, values);
      setEditingMeta(null);
      if (treeKind === "image") {
        const updated = await runtime.getImageData(currentId);
        setImageData(updated);
      } else {
        const updated = await runtime.getSignalData(currentId);
        setData(updated);
      }
      await refresh(currentId);
    },
    [runtime, currentId, treeKind, refresh],
  );

  const handleAnnotationsChange = useCallback(
    async (payload: PlotlyAnnotations) => {
      if (!runtime || !currentId) return;
      setAnnotations(payload);
      await runtime.setPlotlyAnnotations(currentId, payload);
    },
    [runtime, currentId],
  );

  const handleToggleRoiEditMode = useCallback(async () => {
    if (roiEditMode) {
      // Leaving the editor: disarm drawing and clear the active selection.
      setRoiEditMode(false);
      setRoiDrawGeometry(null);
      setSelectedRoiIndex(null);
      return;
    }
    // Entering the unified ROI editor: load the current ROI, arm the
    // range-draw tool so a first ROI can be traced immediately, and
    // pre-select the first ROI (if any) so its coordinate form opens at once.
    const segs =
      runtime && currentId ? await runtime.getSignalRoi(currentId) : [];
    setRoi(segs);
    setRoiDrawGeometry("segment");
    setSelectedRoiIndex(segs.length > 0 ? 0 : null);
    setRoiEditMode(true);
  }, [roiEditMode, runtime, currentId]);

  // Live-edit callback fed by the plot when the user drags a ROI handle or
  // draws a brand-new rectangle in edit mode.  The backend is updated with
  // a short debounce to avoid one PyProxy call per pixel.
  const roiWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRoiChangeFromPlot = useCallback(
    (segments: SignalRoiSegment[]) => {
      setRoi((prev) => {
        // A freshly drawn ROI (count grew) becomes the active selection so
        // its form opens immediately in the docked panel.
        if (segments.length > prev.length) {
          queueMicrotask(() => setSelectedRoiIndex(segments.length - 1));
        }
        return segments;
      });
      if (!runtime || !currentId) return;
      if (roiWriteTimer.current) clearTimeout(roiWriteTimer.current);
      roiWriteTimer.current = setTimeout(() => {
        runtime.setSignalRoi(currentId, segments).catch((err) => {
          console.error("ROI persist failed", err);
        });
      }, 200);
    },
    [runtime, currentId],
  );

  /** Arm (or disarm with ``null``) a graphical draw tool on the active
   *  plot, fed by the ROI panel's draw buttons. */
  const handleRoiRequestDraw = useCallback(
    (geometry: RoiDrawGeometry | null) => {
      setRoiDrawGeometry(geometry);
    },
    [],
  );

  // Reset the active ROI selection whenever the displayed object changes
  // so the docked form never points at a stale index.
  useEffect(() => {
    setSelectedRoiIndex(null);
  }, [currentId]);

  // Clear the highlighted polygon vertex whenever the selected ROI changes
  // so a marker from a previous ROI never lingers on the plot.
  useEffect(() => {
    setActiveRoiVertex(null);
  }, [selectedRoiIndex]);

  const handleRoiRemoveAt = useCallback(
    async (index: number) => {
      if (!runtime || !currentId) return;
      await runtime.deleteSignalRoiAt(currentId, index);
      const segs = await runtime.getSignalRoi(currentId);
      setRoi(segs);
    },
    [runtime, currentId],
  );

  const handleRoiRemoveAll = useCallback(async () => {
    if (!runtime) return;
    // Clear ROIs on every selected signal (falling back to the current
    // one), mirroring DataLab desktop's ``delete_regions_of_interest``.
    const ids = selectedIds.length ? selectedIds : currentId ? [currentId] : [];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      for (const oid of ids) {
        await runtime.setSignalRoi(oid, []);
      }
      setRoi([]);
      setPlotRefreshNonce((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }, [runtime, selectedIds, currentId]);

  const handleRoiExtractEach = useCallback(async () => {
    if (!runtime || !currentId) return;
    setBusy(true);
    try {
      // Apply the current signal's ROI to every selected signal
      // (current first), mirroring DataLab desktop's
      // ``compute_roi_extraction``.
      const ids = [currentId, ...selectedIds.filter((id) => id !== currentId)];
      const newIds = await runtime.extractSignalRois(ids, false);
      await refresh();
      if (newIds.length > 0) setCurrentId(newIds[newIds.length - 1]);
    } finally {
      setBusy(false);
    }
  }, [runtime, currentId, selectedIds, refresh]);

  const handleRoiExtractMerged = useCallback(async () => {
    if (!runtime || !currentId) return;
    setBusy(true);
    try {
      const ids = [currentId, ...selectedIds.filter((id) => id !== currentId)];
      const newIds = await runtime.extractSignalRois(ids, true);
      await refresh();
      if (newIds.length > 0) setCurrentId(newIds[0]);
    } finally {
      setBusy(false);
    }
  }, [runtime, currentId, selectedIds, refresh]);

  const handleRoiCopy = useCallback(async () => {
    if (!runtime || !currentId) return;
    const ok = await runtime.copyObjectRoi(currentId);
    if (ok) setHasRoiClipboard(true);
  }, [runtime, currentId]);

  const handleRoiPaste = useCallback(async () => {
    if (!runtime) return;
    const ids = selectedIds.length ? selectedIds : currentId ? [currentId] : [];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await runtime.pasteObjectRoi(ids);
      if (currentId) setRoi(await runtime.getSignalRoi(currentId));
      setPlotRefreshNonce((n) => n + 1);
    } catch (err) {
      await notify({
        kind: "error",
        title: t("Paste ROI"),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [runtime, selectedIds, currentId, notify]);

  const handleRoiImport = useCallback(async () => {
    if (!runtime || !currentId) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".dlabroi,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await runtime.importObjectRoiBytes(currentId, bytes);
        setRoi(await runtime.getSignalRoi(currentId));
        setPlotRefreshNonce((n) => n + 1);
      } catch (err) {
        await notify({
          kind: "error",
          title: t("Import ROI…"),
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }, [runtime, currentId, notify]);

  const handleRoiExport = useCallback(async () => {
    if (!runtime || !currentId) return;
    const oid = currentId;
    setBusy(true);
    try {
      const bytes = await runtime.exportObjectRoiBytes(oid);
      const blob = new Blob([new Uint8Array(bytes)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${titleForId(oid)}.dlabroi`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      await notify({
        kind: "error",
        title: t("Export ROI…"),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [runtime, currentId, titleForId, notify]);

  // ------------------------------------------------------------------
  // Image ROI handlers (Phase 13)
  // ------------------------------------------------------------------

  const handleImageAddRectangle = useCallback(async () => {
    if (!runtime || !currentId || !imageData) return;
    const sx = (imageData.width * imageData.dx) / 4 || 1;
    const sy = (imageData.height * imageData.dy) / 4 || 1;
    const x0 = imageData.x0 + (imageData.width * imageData.dx) / 2 - sx / 2;
    const y0 = imageData.y0 + (imageData.height * imageData.dy) / 2 - sy / 2;
    const next: ImageRoiSegment[] = [
      ...imageRoi,
      {
        geometry: "rectangle",
        title: "",
        inverse: false,
        x0,
        y0,
        dx: sx,
        dy: sy,
      },
    ];
    setImageRoi(next);
    setRoiDrawGeometry(null);
    setSelectedRoiIndex(next.length - 1);
    setImageRoiEditMode(true);
    await runtime.setImageRoi(currentId, next);
  }, [runtime, currentId, imageRoi, imageData]);

  const handleImageAddCircle = useCallback(async () => {
    if (!runtime || !currentId || !imageData) return;
    const r =
      Math.min(
        imageData.width * imageData.dx,
        imageData.height * imageData.dy,
      ) / 4 || 1;
    const xc = imageData.x0 + (imageData.width * imageData.dx) / 2;
    const yc = imageData.y0 + (imageData.height * imageData.dy) / 2;
    const next: ImageRoiSegment[] = [
      ...imageRoi,
      { geometry: "circle", title: "", inverse: false, xc, yc, r },
    ];
    setImageRoi(next);
    setRoiDrawGeometry(null);
    setSelectedRoiIndex(next.length - 1);
    setImageRoiEditMode(true);
    await runtime.setImageRoi(currentId, next);
  }, [runtime, currentId, imageRoi, imageData]);

  const handleToggleImageRoiEditMode = useCallback(async () => {
    if (imageRoiEditMode) {
      setImageRoiEditMode(false);
      setRoiDrawGeometry(null);
      setSelectedRoiIndex(null);
      return;
    }
    // Entering the unified ROI editor: load the current ROI, arm the
    // rectangle-draw tool, and pre-select the first ROI (if any) so its
    // coordinate form opens at once.  ROI editing and the erase session are
    // mutually exclusive, so entering one leaves the other.
    const segs =
      runtime && currentId ? await runtime.getImageRoi(currentId) : [];
    setImageRoi(segs);
    setImageEraseMode(false);
    setEraseRegions([]);
    setRoiDrawGeometry("rectangle");
    setSelectedRoiIndex(segs.length > 0 ? 0 : null);
    setImageRoiEditMode(true);
  }, [imageRoiEditMode, runtime, currentId]);

  // Live-edit callback fed by the plot when the user drags a ROI handle
  // or draws a brand-new shape in edit mode.  The backend is updated with
  // a short debounce to avoid one PyProxy call per pixel.
  const imageRoiWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleImageRoiChangeFromPlot = useCallback(
    (segments: ImageRoiSegment[]) => {
      setImageRoi((prev) => {
        if (segments.length > prev.length) {
          queueMicrotask(() => setSelectedRoiIndex(segments.length - 1));
        }
        return segments;
      });
      if (!runtime || !currentId) return;
      if (imageRoiWriteTimer.current) clearTimeout(imageRoiWriteTimer.current);
      imageRoiWriteTimer.current = setTimeout(() => {
        runtime.setImageRoi(currentId, segments).catch((err) => {
          console.error("Image ROI persist failed", err);
        });
      }, 200);
    },
    [runtime, currentId],
  );

  const handleImageRoiRemoveAt = useCallback(
    async (index: number) => {
      if (!runtime || !currentId) return;
      await runtime.deleteImageRoiAt(currentId, index);
      const segs = await runtime.getImageRoi(currentId);
      setImageRoi(segs);
    },
    [runtime, currentId],
  );

  const handleImageRoiRemoveAll = useCallback(async () => {
    if (!runtime) return;
    // Clear ROIs on every selected image (falling back to the current
    // one), mirroring DataLab desktop's ``delete_regions_of_interest``.
    const ids = selectedIds.length ? selectedIds : currentId ? [currentId] : [];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      for (const oid of ids) {
        await runtime.setImageRoi(oid, []);
      }
      setImageRoi([]);
      setPlotRefreshNonce((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }, [runtime, selectedIds, currentId]);

  const handleImageRoiExtractEach = useCallback(async () => {
    if (!runtime || !currentId) return;
    setBusy(true);
    try {
      // Apply the current image's ROI to every selected image (current
      // first), mirroring DataLab desktop's ``compute_roi_extraction``.
      const ids = [currentId, ...selectedIds.filter((id) => id !== currentId)];
      const newIds = await runtime.extractImageRois(ids, false);
      await refresh();
      if (newIds.length > 0) setCurrentId(newIds[newIds.length - 1]);
    } finally {
      setBusy(false);
    }
  }, [runtime, currentId, selectedIds, refresh]);

  const handleImageRoiExtractMerged = useCallback(async () => {
    if (!runtime || !currentId) return;
    setBusy(true);
    try {
      const ids = [currentId, ...selectedIds.filter((id) => id !== currentId)];
      const newIds = await runtime.extractImageRois(ids, true);
      await refresh();
      if (newIds.length > 0) setCurrentId(newIds[0]);
    } finally {
      setBusy(false);
    }
  }, [runtime, currentId, selectedIds, refresh]);

  const handleImageRoiCopy = useCallback(async () => {
    if (!runtime || !currentId) return;
    const ok = await runtime.copyObjectRoi(currentId);
    if (ok) setHasRoiClipboard(true);
  }, [runtime, currentId]);

  const handleImageRoiPaste = useCallback(async () => {
    if (!runtime) return;
    const ids = selectedIds.length ? selectedIds : currentId ? [currentId] : [];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await runtime.pasteObjectRoi(ids);
      if (currentId) setImageRoi(await runtime.getImageRoi(currentId));
      setPlotRefreshNonce((n) => n + 1);
    } catch (err) {
      await notify({
        kind: "error",
        title: t("Paste ROI"),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [runtime, selectedIds, currentId, notify]);

  const handleImageRoiImport = useCallback(async () => {
    if (!runtime || !currentId) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".dlabroi,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await runtime.importObjectRoiBytes(currentId, bytes);
        setImageRoi(await runtime.getImageRoi(currentId));
        setPlotRefreshNonce((n) => n + 1);
      } catch (err) {
        await notify({
          kind: "error",
          title: t("Import ROI…"),
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }, [runtime, currentId, notify]);

  const handleImageRoiExport = useCallback(async () => {
    if (!runtime || !currentId) return;
    const oid = currentId;
    setBusy(true);
    try {
      const bytes = await runtime.exportObjectRoiBytes(oid);
      const blob = new Blob([new Uint8Array(bytes)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${titleForId(oid)}.dlabroi`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      await notify({
        kind: "error",
        title: t("Export ROI…"),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [runtime, currentId, titleForId, notify]);

  /** Start an "erase area" session: open the docked ROI panel on a transient
   *  region list (seeded with one centered rectangle) instead of a modal, so
   *  the user can draw / edit the area(s) to erase directly on the image.
   *  Mirrors DataLab desktop's ``compute_erase``. */
  const handleOpenErase = useCallback(() => {
    if (!runtime || !currentId || !imageData) return;
    const sx = (imageData.width * imageData.dx) / 4 || 1;
    const sy = (imageData.height * imageData.dy) / 4 || 1;
    const x0 = imageData.x0 + (imageData.width * imageData.dx) / 2 - sx / 2;
    const y0 = imageData.y0 + (imageData.height * imageData.dy) / 2 - sy / 2;
    setEraseRegions([
      {
        geometry: "rectangle",
        title: "",
        inverse: false,
        x0,
        y0,
        dx: sx,
        dy: sy,
      },
    ]);
    setSelectedRoiIndex(0);
    setActiveRoiVertex(null);
    setRoiDrawGeometry("rectangle");
    setImageRoiEditMode(false);
    setImageEraseMode(true);
  }, [runtime, currentId, imageData]);

  /** Live region updates from the plot during an erase session (draw / drag).
   *  Not persisted on the object — only the transient ``eraseRegions``. */
  const handleEraseChangeFromPlot = useCallback(
    (segments: ImageRoiSegment[]) => {
      setEraseRegions((prev) => {
        if (segments.length > prev.length) {
          queueMicrotask(() => setSelectedRoiIndex(segments.length - 1));
        }
        return segments;
      });
    },
    [],
  );

  /** Apply the erase computation on the transient regions, then leave the
   *  session and select the freshly created image. */
  const handleApplyErase = useCallback(async () => {
    if (!runtime || !currentId) return;
    const segments = eraseRegions;
    setImageEraseMode(false);
    setEraseRegions([]);
    setSelectedRoiIndex(null);
    setActiveRoiVertex(null);
    setRoiDrawGeometry(null);
    if (segments.length === 0) return;
    setBusy(true);
    try {
      const newOid = await runtime.eraseImageArea(currentId, segments);
      await refresh();
      setCurrentId(newOid);
    } finally {
      setBusy(false);
    }
  }, [runtime, currentId, eraseRegions, refresh]);

  /** Abandon an erase session without modifying the image. */
  const handleCancelErase = useCallback(() => {
    setImageEraseMode(false);
    setEraseRegions([]);
    setSelectedRoiIndex(null);
    setActiveRoiVertex(null);
    setRoiDrawGeometry(null);
  }, []);

  /** Refresh the displayed image of *oid* after an in-place layout
   *  change (distribute on a grid / reset positions). */
  const reloadCurrentImage = useCallback(async () => {
    if (!runtime || !currentId || treeKind !== "image") return;
    try {
      const updated = await runtime.getImageData(currentId);
      setImageData(updated);
    } catch {
      /* ignore — object may have been deleted */
    }
  }, [runtime, currentId, treeKind]);

  const imageLayoutSourceIds = useCallback((): string[] => {
    if (selectedIds.length > 0) return selectedIds;
    return currentId ? [currentId] : [];
  }, [selectedIds, currentId]);

  const handleDistributeOnGrid = useCallback(async () => {
    if (!runtime) return;
    const ids = imageLayoutSourceIds();
    if (ids.length === 0) return;
    const schema = await runtime.getImageGridParamSchema();
    setPendingImageGrid({ sourceIds: ids, schema });
  }, [runtime, imageLayoutSourceIds]);

  const handleSubmitImageGrid = useCallback(
    async (values: Record<string, unknown>) => {
      if (!runtime || !pendingImageGrid) return;
      const { sourceIds } = pendingImageGrid;
      setPendingImageGrid(null);
      setBusy(true);
      try {
        await runtime.distributeImagesOnGrid(sourceIds, values);
        // The geometry tools only move images in the shared coordinate
        // space; that is invisible in the thumbnail grid, so surface the
        // result by switching the multi-image view to spatial overlay.
        if (sourceIds.length > 1) setSpatialMultiImage(true);
        await reloadCurrentImage();
        // Refresh WITHOUT a preferred id so the existing multi-selection
        // is preserved (passing ``currentId`` would collapse it to a
        // single image and hide the spatial overlay we just enabled).
        await refresh();
        // The op moves the *other* selected images in place (same UIDs),
        // so neither ``currentId`` nor ``selectedIds`` change and the
        // central fetch effect would keep stale ``extraImages`` (old
        // x0/y0). Bump the plot nonce to force a re-fetch so the spatial
        // overlay shows the new positions without a deselect/reselect.
        setPlotRefreshNonce((n) => n + 1);
      } finally {
        setBusy(false);
      }
    },
    [
      runtime,
      pendingImageGrid,
      reloadCurrentImage,
      refresh,
      setSpatialMultiImage,
    ],
  );

  const handleResetImagePositions = useCallback(async () => {
    if (!runtime) return;
    const ids = imageLayoutSourceIds();
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await runtime.resetImagePositions(ids);
      // Make the repositioning observable (see handleSubmitImageGrid).
      if (ids.length > 1) setSpatialMultiImage(true);
      await reloadCurrentImage();
      // Preserve the multi-selection (see handleSubmitImageGrid).
      await refresh();
      // Force a re-fetch of the other selected images' coordinates
      // (see handleSubmitImageGrid for the rationale).
      setPlotRefreshNonce((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }, [
    runtime,
    imageLayoutSourceIds,
    reloadCurrentImage,
    refresh,
    setSpatialMultiImage,
  ]);

  const handleCreateRoiGrid = useCallback(async () => {
    if (!runtime || !currentId) return;
    if (
      imageRoi.length > 0 &&
      !(await confirm({
        title: "Overwrite ROI?",
        message:
          "Creating a ROI grid will overwrite any existing ROI.\n\nDo you want to continue?",
        confirmLabel: "Continue",
      }))
    ) {
      return;
    }
    const schema = await runtime.getRoiGridParamSchema();
    setPendingRoiGrid({ oid: currentId, schema });
  }, [runtime, currentId, imageRoi, confirm]);

  const handleSubmitRoiGrid = useCallback(
    async (values: Record<string, unknown>) => {
      if (!runtime || !pendingRoiGrid) return;
      const { oid } = pendingRoiGrid;
      setPendingRoiGrid(null);
      setBusy(true);
      try {
        const segments = await runtime.createImageRoiGrid(oid, values);
        setImageRoi(segments);
        await refresh(oid);
        if (
          await confirm({
            title: "Extract ROI",
            message: "Do you want to extract images from the defined ROI?",
            confirmLabel: "Extract",
          })
        ) {
          const ids = await runtime.extractImageRois(oid, false);
          await refresh();
          if (ids.length > 0) setCurrentId(ids[ids.length - 1]);
        }
      } finally {
        setBusy(false);
      }
    },
    [runtime, pendingRoiGrid, refresh, confirm],
  );

  const handleSaveWorkspaceHdf5 = useCallback(async () => {
    if (!runtime) return;
    setBusy(true);
    try {
      const bytes = await runtime.saveWorkspaceHdf5();
      const blob = new Blob([new Uint8Array(bytes)], {
        type: "application/x-hdf",
      });
      const url = URL.createObjectURL(blob);
      // When no filename has been associated with the session yet
      // ("Untitled"), suggest a timestamped one. Otherwise keep the
      // last known name, mirroring desktop "Save" semantics — the
      // browser still drops the file in the user's Downloads folder.
      const downloadName =
        workspaceFilename ??
        `workspace-${new Date()
          .toISOString()
          .replace(/[-:T]/g, "")
          .replace(/\..+$/, "")}.h5`;
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      // Clean transition — the HDF5 file now contains the durable
      // image of the in-memory state.
      setWorkspaceFilename(downloadName);
      markClean();
    } finally {
      setBusy(false);
    }
  }, [runtime, workspaceFilename, setWorkspaceFilename, markClean]);

  const handleOpenWorkspaceHdf5 = useCallback(async () => {
    if (!runtime) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".h5,.hdf5,.hdf,.he5";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        try {
          await runtime.openWorkspaceHdf5(file.name, bytes, true, {
            silent: true,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Qt parity: when the file is a regular HDF5 file (not a
          // DataLab workspace), import every supported dataset directly
          // (matches Qt's ``File > Open HDF5 files...`` with import_all=True).
          // The H5 browser remains available via ``File > Import from
          // HDF5...`` (handleImportHdf5).
          if (msg.includes("Not a DataLab HDF5 workspace")) {
            let opened: H5BrowserFile | null = null;
            try {
              opened = await runtime.openH5Browser(file.name, bytes);
              const supported = new Set<string>();
              collectSupportedH5NodeIds(opened.root, supported);
              if (supported.size === 0) {
                await notify({
                  kind: "warning",
                  title: "Open HDF5",
                  message: "No supported data available in HDF5 file.",
                });
                return;
              }
              const result = await runtime.importH5BrowserNodes(
                opened.file_id,
                Array.from(supported),
                null,
              );
              if (result.uint32_clipped) {
                await notify({
                  kind: "warning",
                  message:
                    "Some uint32 image data was clipped to int32 range during import.",
                });
              }
              setSelectedIds([]);
              setCurrentId(result.oids[result.oids.length - 1] ?? null);
              setWorkspaceVersion((v) => v + 1);
              await refresh(result.oids[result.oids.length - 1] ?? null);
            } catch (err2) {
              await notify({
                kind: "error",
                title: "Open HDF5",
                message: `Failed to open HDF5 file:\n${
                  err2 instanceof Error ? err2.message : String(err2)
                }`,
              });
            } finally {
              if (opened) {
                await runtime.closeH5Browser(opened.file_id).catch(() => {});
              }
            }
            return;
          }
          await notify({
            kind: "error",
            title: "Open workspace",
            message: `Failed to open HDF5 workspace:\n${msg}`,
          });
          return;
        }
        setSelectedIds([]);
        setCurrentId(null);
        setWorkspaceVersion((v) => v + 1);
        // Clean transition — the loaded workspace *is* the source of
        // truth, so clear any prior dirty/recovered flags and remember
        // the filename for subsequent Save operations.
        setWorkspaceFilename(file.name);
        markClean();
        await refresh(null);
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }, [
    runtime,
    refresh,
    setWorkspaceFilename,
    markClean,
    notify,
    setSelectedIds,
  ]);

  const handleImportHdf5 = useCallback(() => {
    // Open the H5 browser dialog with no preloaded file; the user picks
    // a file from inside the dialog (matches Qt's File > Import HDF5).
    setH5BrowserFiles([]);
  }, []);

  const handleImportTextWizard = useCallback(() => {
    setTextImportOpen(true);
  }, []);

  const handleTextImportFinished = useCallback(
    async (oids: string[]) => {
      setTextImportOpen(false);
      if (oids.length === 0) return;
      setSelectedIds([]);
      setCurrentId(oids[oids.length - 1] ?? null);
      await refresh(oids[oids.length - 1] ?? null);
    },
    [refresh, setSelectedIds],
  );

  const handleH5BrowserImport = useCallback(
    async (oids: string[], uint32Clipped: boolean) => {
      setH5BrowserFiles(null);
      if (uint32Clipped) {
        await notify({
          kind: "warning",
          message:
            "Some uint32 image data was clipped to int32 range during import.",
        });
      }
      setSelectedIds([]);
      setCurrentId(oids[oids.length - 1] ?? null);
      await refresh(oids[oids.length - 1] ?? null);
    },
    [refresh, notify, setSelectedIds],
  );

  const handleSaveFile = useCallback(async () => {
    if (!runtime || !currentId) return;
    // Default to CSV (signals) or TIFF (images); users can pick another
    // extension by editing the filename in the prompt dialog.
    const isImage = treeKind === "image";
    const formats = isImage
      ? await runtime.listImageIoFormats()
      : await runtime.listSignalIoFormats();
    const writeExts = formats.all_write_extensions;
    const fallbackExt = isImage ? "tif" : "csv";
    const titleSource = isImage ? imageData?.title : data?.title;
    const stem = (titleSource || (isImage ? "image" : "signal")).replace(
      /[^\w.-]+/g,
      "_",
    );
    // Browsers can't really show an extension picker on a synthetic <a>
    // download; we offer a one-line prompt with the catalog of supported
    // extensions for parity with DataLab's "Save signal…" dialog.
    const ext = await prompt({
      title: "Save file",
      message: `File extension (one of: ${writeExts.join(", ")})`,
      defaultValue: fallbackExt,
    });
    if (!ext) return;
    const cleanExt = ext.replace(/^\./, "").trim();
    if (!writeExts.includes(cleanExt)) {
      await notify({
        kind: "error",
        title: "Save file",
        message: `Unsupported extension ".${cleanExt}".\nSupported: ${writeExts.join(", ")}`,
      });
      return;
    }
    const filename = `${stem}.${cleanExt}`;
    const bytes = isImage
      ? await runtime.saveImageToBytes(currentId, filename)
      : await runtime.saveSignalToBytes(currentId, filename);
    const blob = new Blob([new Uint8Array(bytes)], {
      type: "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [runtime, currentId, data, imageData, treeKind, notify, prompt]);

  /** Open the "Save to directory…" dialog with the current selection
   *  (falls back to the whole panel when nothing is explicitly selected,
   *  matching the desktop ``include_groups=True`` behaviour). */
  const handleSaveToDirectory = useCallback(async () => {
    if (!runtime || !tree) return;
    const ids =
      selectedIds.length > 0 ? selectedIds : currentId ? [currentId] : [];
    if (ids.length === 0) return;
    // Build human-readable labels (group / title) for the preview list.
    const labelById = new Map<string, string>();
    for (const g of tree.groups) {
      for (const o of g.objects) {
        labelById.set(o.id, `[${g.name}] ${o.title}`);
      }
    }
    const sources: SaveToDirectorySource[] = ids
      .filter((id) => labelById.has(id))
      .map((id) => ({ id, displayLabel: labelById.get(id)! }));
    if (sources.length === 0) return;
    const formats =
      treeKind === "image"
        ? await runtime.listImageIoFormats()
        : await runtime.listSignalIoFormats();
    setPendingSaveToDir({
      sources,
      extensions: formats.all_write_extensions,
    });
  }, [runtime, tree, selectedIds, currentId, treeKind]);

  /** Persist the dialog payload, then write every object to disk using
   *  the File System Access API when available (Chromium-based browsers)
   *  and falling back to one-by-one downloads otherwise. */
  const handleSubmitSaveToDir = useCallback(
    async (result: SaveToDirectoryResult) => {
      if (!runtime || !pendingSaveToDir) return;
      const { sources } = pendingSaveToDir;
      const { basenames, overwrite } = result;
      setPendingSaveToDir(null);
      setBusy(true);
      try {
        // Pre-compute the bytes for every object so we keep a single
        // try/catch around the long-running serialisation step.
        // NOTE: ``saveSignalToBytes`` may hand back a ``Uint8Array``
        // backed by Pyodide's WASM memory; that buffer can be reclaimed
        // or overwritten by the next Python call.  We therefore copy
        // each payload into a fresh ``Uint8Array`` immediately, so the
        // accumulated ``payloads`` array stays valid across iterations.
        const payloads: Array<{ name: string; bytes: Uint8Array }> = [];
        for (let i = 0; i < sources.length; i++) {
          const name = basenames[i];
          const raw =
            treeKind === "image"
              ? await runtime.saveImageToBytes(sources[i].id, name)
              : await runtime.saveSignalToBytes(sources[i].id, name);
          // ``slice()`` allocates a fresh, independent ``Uint8Array``
          // (``new Uint8Array(other)`` would share ``other.buffer``).
          payloads.push({ name, bytes: raw.slice() });
        }

        // Prefer the File System Access API: real on-disk write, with
        // optional overwrite handling.
        const picker = (
          window as unknown as {
            showDirectoryPicker?: (options?: {
              mode?: "read" | "readwrite";
            }) => Promise<FileSystemDirectoryHandle>;
          }
        ).showDirectoryPicker;
        let usedPicker = false;
        if (typeof picker === "function") {
          let dirHandle: FileSystemDirectoryHandle | null = null;
          try {
            dirHandle = await picker({ mode: "readwrite" });
          } catch (err) {
            // User cancelled the directory picker — silently abort.
            if (err instanceof DOMException && err.name === "AbortError") {
              return;
            }
            // Other errors (e.g. SecurityError on non-HTTPS) → fall back
            // to per-file downloads below.
            console.warn("[save_to_directory] picker failed", err);
            dirHandle = null;
          }
          if (dirHandle) {
            // Some browsers grant the picker but still require an
            // explicit ``readwrite`` permission before write operations.
            // Chromium also denies permission outright for system folders
            // (Desktop, Documents, Downloads, OneDrive-synced paths…).
            const handleWithPerm = dirHandle as unknown as {
              queryPermission?: (opts: {
                mode: "readwrite";
              }) => Promise<PermissionState>;
              requestPermission?: (opts: {
                mode: "readwrite";
              }) => Promise<PermissionState>;
            };
            let permissionDenied = false;
            if (typeof handleWithPerm.queryPermission === "function") {
              let state = await handleWithPerm.queryPermission({
                mode: "readwrite",
              });
              if (
                state !== "granted" &&
                typeof handleWithPerm.requestPermission === "function"
              ) {
                try {
                  state = await handleWithPerm.requestPermission({
                    mode: "readwrite",
                  });
                } catch {
                  state = "denied";
                }
              }
              if (state !== "granted") {
                permissionDenied = true;
              }
            }
            if (permissionDenied) {
              const explanation =
                "The browser refused write access to the selected " +
                "directory.\n\nThis usually happens with system folders " +
                "(Desktop, Documents, Downloads or OneDrive-synced " +
                "paths), which Chromium blocks regardless of their " +
                "content.\n\nClick OK to download each file individually " +
                "instead, or Cancel to abort and pick a different " +
                "folder.";
              if (
                !(await confirm({
                  title: "Write blocked",
                  message: explanation,
                  confirmLabel: "Download instead",
                }))
              )
                return;
              // Fall through to the download fallback below.
            } else {
              try {
                for (const { name, bytes } of payloads) {
                  let finalName = name;
                  if (!overwrite) {
                    // Probe for an existing file and append `_N` when needed.
                    let k = 1;
                    const dot = name.lastIndexOf(".");
                    const stem = dot > 0 ? name.slice(0, dot) : name;
                    const ext = dot > 0 ? name.slice(dot) : "";
                    while (
                      await dirHandle
                        .getFileHandle(finalName)
                        .then(() => true)
                        .catch(() => false)
                    ) {
                      finalName = `${stem}_${k}${ext}`;
                      k += 1;
                    }
                  }
                  const fileHandle = await dirHandle.getFileHandle(finalName, {
                    create: true,
                  });
                  const writable = await fileHandle.createWritable();
                  await writable.write(new Blob([new Uint8Array(bytes)]));
                  await writable.close();
                }
                usedPicker = true;
              } catch (err) {
                // Late refusal (e.g. ``NotAllowedError`` raised by
                // ``getFileHandle`` itself when the path turns out to be
                // protected): offer the download fallback rather than
                // surfacing a raw browser error.
                const msg = err instanceof Error ? err.message : String(err);
                const isBlocked =
                  err instanceof DOMException &&
                  (err.name === "NotAllowedError" ||
                    err.name === "SecurityError");
                const explanation = isBlocked
                  ? "The browser refused to write into this directory " +
                    "(system folders such as Desktop, Documents, " +
                    "Downloads or OneDrive-synced paths are blocked).\n\n" +
                    "Click OK to download each file individually instead, " +
                    "or Cancel to abort."
                  : `Write failed:\n${msg}\n\nClick OK to download each ` +
                    `file individually instead.`;
                if (
                  !(await confirm({
                    title: "Write failed",
                    message: explanation,
                    confirmLabel: "Download instead",
                  }))
                )
                  return;
                // Fall through to download-fallback below.
              }
            }
          }
        }
        if (usedPicker) return;

        // Fallback: trigger one download per file. Browsers may prompt
        // the user to allow multiple downloads from this site.
        for (const { name, bytes } of payloads) {
          const blob = new Blob([new Uint8Array(bytes)], {
            type: "application/octet-stream",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await notify({
          kind: "error",
          title: "Save to directory",
          message: `Save to directory failed:\n${msg}`,
        });
      } finally {
        setBusy(false);
      }
    },
    [runtime, pendingSaveToDir, treeKind, confirm, notify],
  );

  const handleOpenFile = useCallback(async () => {
    if (!runtime) return;
    const isImage = treeKind === "image";
    const formats = isImage
      ? await runtime.listImageIoFormats()
      : await runtime.listSignalIoFormats();
    const accept = formats.all_read_extensions.map((e) => `.${e}`).join(",");
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    input.onchange = async () => {
      const files = input.files;
      if (!files || files.length === 0) return;
      setBusy(true);
      let lastId: string | null = null;
      try {
        const fileList = Array.from(files);
        await runWithProgress({
          title: isImage ? t("Opening images…") : t("Opening signals…"),
          total: fileList.length,
          step: async (i, { setLabel }) => {
            const file = fileList[i];
            setLabel(`${i + 1} / ${fileList.length} — ${file.name}`);
            const buf = new Uint8Array(await file.arrayBuffer());
            const ids = isImage
              ? await runtime.openImageFromBytes(file.name, buf)
              : await runtime.openSignalFromBytes(file.name, buf);
            if (ids.length > 0) lastId = ids[ids.length - 1];
          },
        });
        await refresh(lastId);
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }, [runtime, refresh, treeKind, runWithProgress]);

  /** Mirror DataLab Qt's "Open from directory…": pick a folder, then for
   *  every non-empty subfolder import its files as a new group. Read
   *  failures are silently ignored (parity with ``ignore_errors=True``);
   *  a summary toast reports the totals at the end. */
  const handleOpenFromDirectory = useCallback(async () => {
    if (!runtime) return;
    const isImage = treeKind === "image";
    let picked;
    try {
      picked = await pickDirectoryRecursive();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await notify({
        kind: "error",
        title: "Open from directory",
        message: `Directory picker failed:\n${msg}`,
      });
      return;
    }
    if (!picked) return;
    if (picked.files.length === 0) {
      await notify({
        kind: "info",
        title: "Open from directory",
        message:
          "The selected folder contains no files (or browser denied " +
          "access). Pick a folder that contains files directly or in " +
          "sub-folders.",
      });
      return;
    }
    const folders = groupByFolder(picked.files);
    if (folders.length === 0) return;
    // Files sitting directly in the picked root have an empty
    // ``relativeDir``; name their group after the picked folder, mirroring
    // DataLab Qt's ``osp.basename(path)`` fallback in load_from_directory.
    const rootLabel = picked.rootName || t("(root)");
    setBusy(true);
    let lastId: string | null = null;
    let totalObjects = 0;
    let totalGroups = 0;
    let totalErrors = 0;
    try {
      const { cancelled } = await runWithProgress({
        title: isImage
          ? t("Opening images from directory…")
          : t("Opening signals from directory…"),
        total: folders.length,
        step: async (i, { setLabel, signal }) => {
          if (signal.aborted) return;
          const folder = folders[i];
          const label = folder.relativeDir || rootLabel;
          setLabel(`${i + 1} / ${folders.length} — ${label}`);
          // Read every file's bytes before crossing the Pyodide bridge:
          // ``File.arrayBuffer()`` is async and cheap, the Python call
          // is the expensive part.
          const payload: Array<{ name: string; data: Uint8Array }> = [];
          for (const pf of folder.files) {
            payload.push({
              name: pf.name,
              data: new Uint8Array(await pf.file.arrayBuffer()),
            });
          }
          const result = await runtime.openFromDirectoryChunk(
            isImage ? "image" : "signal",
            label,
            payload,
          );
          totalErrors += result.errors;
          if (result.oids.length > 0) {
            totalGroups += 1;
            totalObjects += result.oids.length;
            lastId = result.oids[result.oids.length - 1] ?? lastId;
          }
        },
      });
      await refresh(lastId);
      if (totalObjects === 0) {
        await notify({
          kind: "info",
          title: cancelled ? "Open cancelled" : "Open from directory",
          message: cancelled
            ? "No objects were loaded before cancellation."
            : `No ${isImage ? "image" : "signal"} could be read from ` +
              `the selected directory (${totalErrors} file(s) skipped).`,
        });
      } else if (totalErrors > 0 || cancelled) {
        await notify({
          kind: "info",
          title: "Open from directory",
          message:
            `${totalObjects} object(s) loaded in ${totalGroups} group(s)` +
            (totalErrors > 0 ? ` — ${totalErrors} file(s) skipped` : "") +
            (cancelled ? " — cancelled" : ""),
        });
      } else {
        await notify({
          kind: "info",
          title: "Open from directory",
          message: `${totalObjects} object(s) loaded in ${totalGroups} group(s).`,
        });
      }
    } finally {
      setBusy(false);
    }
  }, [runtime, refresh, treeKind, runWithProgress, notify]);

  const hasObjects = useMemo(() => {
    if (!tree) return false;
    for (const g of tree.groups) {
      if (g.objects.length > 0) return true;
    }
    return false;
  }, [tree]);

  const actionState = useMemo(
    () => ({
      status,
      busy,
      selectedIds,
      currentId,
      hasObjects,
      hasMacros: macroCount > 0,
      hasNotebooks: notebookCount > 0,
      hasMetadataClipboard,
      selectionHasRoi,
      selectedGroupCount: selectedGroupIds.length,
    }),
    [
      status,
      busy,
      selectedIds,
      currentId,
      hasObjects,
      macroCount,
      notebookCount,
      hasMetadataClipboard,
      selectionHasRoi,
      selectedGroupIds,
    ],
  );

  // Restrict feature actions, creation menu and signal-only menus
  // (Analysis / ROI) to the currently active panel.
  const visibleFeatures = useMemo(
    () => features.filter((f) => f.object_kind === treeKind),
    [features, treeKind],
  );

  // Locale state powering the View › Language submenu.
  const { locale, setLocale, availableLocales } = useTranslation();

  const actions = useMemo(
    () => [
      ...buildStaticActions({
        onNewGroup: handleNewGroup,
        onDeleteSelection: handleDelete,
        onDeleteAllObjects: handleDeleteAll,
        onEditProperties: handleEditProperties,
        onOpenFile: handleOpenFile,
        onOpenDirectory: handleOpenFromDirectory,
        onSaveFile: handleSaveFile,
        onSaveToDirectory: handleSaveToDirectory,
        onOpenWorkspaceHdf5: handleOpenWorkspaceHdf5,
        onSaveWorkspaceHdf5: handleSaveWorkspaceHdf5,
        onImportHdf5: handleImportHdf5,
        onImportTextWizard: handleImportTextWizard,
        onRenameCurrent: handleRenameCurrent,
        onDuplicateSelection: handleDuplicateSelection,
        onMoveSelectionUp: handleMoveSelectionUp,
        onMoveSelectionDown: handleMoveSelectionDown,
        onCopyTitles: handleCopyTitles,
        onCopyMetadata: handleCopyMetadata,
        onPasteMetadata: handlePasteMetadata,
        onAddMetadata: handleAddMetadata,
        onImportMetadata: handleImportMetadata,
        onExportMetadata: handleExportMetadata,
        onDeleteMetadata: handleDeleteMetadata,
        panel: treeKind,
      }),
      ...buildHelpActions({
        onShowAbout: () => setHelpView("about"),
        onShowShortcuts: () => setHelpView("shortcuts"),
        onShowConsole: () => setHelpView("console"),
        onOpenUserGuide: () => setUserGuideOpen(true),
        onOpenWelcome: () => {
          setWelcomeDismissed(false);
          setWelcomeForced(true);
        },
        onStartTour: handleStartTour,
        onShowReleaseNotes: () => setReleaseNotesOpen(true),
      }),
      ...buildViewActions({
        showToolbar,
        onToggleToolbar: toggleToolbar,
        showResultsOverlay,
        onToggleResultsOverlay: toggleResultsOverlay,
        showGraphicalTitles,
        onToggleGraphicalTitles: toggleGraphicalTitles,
        onOpenSeparateView: openSeparateView,
        hasSelection: selectedIds.length > 0 || currentId !== null,
        notebookFloating,
        onToggleNotebookFloating: toggleNotebookFloating,
        macroFloating,
        onToggleMacroFloating: toggleMacroFloating,
        locale,
        availableLocales,
        onSetLocale: setLocale,
      }),
      ...buildAIAssistantActions({
        visible: aiPanelVisible,
        onTogglePanel: toggleAIPanel,
        onOpenSettings: () => setShowAISettings(true),
      }),
      ...(treeKind === "signal"
        ? buildSignalCreationActions(signalTypes, handleCreateTyped)
        : buildImageCreationActions(imageTypes, handleCreateImageTyped)),
      ...buildFeatureActions(visibleFeatures, handleApplyFeature),
      ...(treeKind === "image"
        ? buildImageGridActions({
            onDistributeOnGrid: handleDistributeOnGrid,
            onResetPositions: handleResetImagePositions,
          })
        : []),
      ...(treeKind === "image"
        ? buildImageEraseActions({ onErase: handleOpenErase })
        : []),
      ...(treeKind === "signal"
        ? buildInteractiveFitActions(
            interactiveFits,
            handleLaunchInteractiveFit,
          )
        : []),
      ...(treeKind === "signal"
        ? buildSignalAnalysisActions(analysisEntries, handleAnalysis)
        : buildImageAnalysisActions(imageAnalysisEntries, handleAnalysis)),
      buildPlotResultsAction(treeKind, handlePlotResults),
      ...(treeKind === "signal"
        ? buildRoiActions(roi, roiEditMode, hasRoiClipboard, {
            onToggleEditMode: handleToggleRoiEditMode,
            onExtractEach: handleRoiExtractEach,
            onExtractMerged: handleRoiExtractMerged,
            onCopy: handleRoiCopy,
            onPaste: handleRoiPaste,
            onImport: handleRoiImport,
            onExport: handleRoiExport,
            onRemoveAt: handleRoiRemoveAt,
            onRemoveAll: handleRoiRemoveAll,
          })
        : buildImageRoiActions(imageRoi, imageRoiEditMode, hasRoiClipboard, {
            onToggleEditMode: handleToggleImageRoiEditMode,
            onAddRectangle: handleImageAddRectangle,
            onAddCircle: handleImageAddCircle,
            onCreateGrid: handleCreateRoiGrid,
            onExtractEach: handleImageRoiExtractEach,
            onExtractMerged: handleImageRoiExtractMerged,
            onCopy: handleImageRoiCopy,
            onPaste: handleImageRoiPaste,
            onImport: handleImageRoiImport,
            onExport: handleImageRoiExport,
            onRemoveAt: handleImageRoiRemoveAt,
            onRemoveAll: handleImageRoiRemoveAll,
          })),
      ...buildPluginActions(pluginActions, treeKind, {
        onTrigger: handleTriggerPluginAction,
        onOpenManager: () => setPluginManagerOpen(true),
        onReloadAll: handleReloadPlugins,
      }),
    ],
    [
      treeKind,
      visibleFeatures,
      signalTypes,
      imageTypes,
      analysisEntries,
      imageAnalysisEntries,
      roi,
      roiEditMode,
      imageRoi,
      imageRoiEditMode,
      hasRoiClipboard,
      handleCreateTyped,
      handleCreateImageTyped,
      handleAnalysis,
      handlePlotResults,
      handleNewGroup,
      handleDelete,
      handleDeleteAll,
      handleApplyFeature,
      handleEditProperties,
      handleToggleRoiEditMode,
      handleRoiExtractEach,
      handleRoiExtractMerged,
      handleRoiCopy,
      handleRoiPaste,
      handleRoiImport,
      handleRoiExport,
      handleRoiRemoveAt,
      handleRoiRemoveAll,
      handleImageAddRectangle,
      handleImageAddCircle,
      handleCreateRoiGrid,
      handleImageRoiExtractEach,
      handleToggleImageRoiEditMode,
      handleImageRoiExtractMerged,
      handleImageRoiCopy,
      handleImageRoiPaste,
      handleImageRoiImport,
      handleImageRoiExport,
      handleImageRoiRemoveAt,
      handleImageRoiRemoveAll,
      handleDistributeOnGrid,
      handleResetImagePositions,
      handleOpenErase,
      handleOpenFile,
      handleSaveFile,
      handleSaveToDirectory,
      handleOpenWorkspaceHdf5,
      handleSaveWorkspaceHdf5,
      handleImportHdf5,
      handleImportTextWizard,
      pluginActions,
      handleTriggerPluginAction,
      handleReloadPlugins,
      interactiveFits,
      handleLaunchInteractiveFit,
      showToolbar,
      toggleToolbar,
      showResultsOverlay,
      toggleResultsOverlay,
      showGraphicalTitles,
      toggleGraphicalTitles,
      openSeparateView,
      aiPanelVisible,
      toggleAIPanel,
      selectedIds.length,
      currentId,
      handleDuplicateSelection,
      handleMoveSelectionDown,
      handleMoveSelectionUp,
      handleRenameCurrent,
      handleCopyTitles,
      handleCopyMetadata,
      handlePasteMetadata,
      handleAddMetadata,
      handleImportMetadata,
      handleExportMetadata,
      handleDeleteMetadata,
      notebookFloating,
      toggleNotebookFloating,
      macroFloating,
      toggleMacroFloating,
      handleStartTour,
      locale,
      setLocale,
      availableLocales,
    ],
  );

  return (
    <ObjectNavigationProvider
      oidIndex={oidIndex}
      navigateToOid={navigateToOid}
      groupIndex={groupIndex}
      navigateToGroup={navigateToGroup}
    >
      <div className="app" data-runtime-status={status}>
        {/*
          Notebook and Macro panels are mounted exactly once (when the
          runtime becomes available) and rendered into a stable
          ``div`` via ``createPortal``.  The host divs that actually
          *display* them — central tab slot or floating overlay slot —
          appendChild the stable element imperatively in the
          placement effect.  That keeps the panels' React state and
          (critically) their Pyodide worker alive across every
          tab/floating toggle, where a naive conditional render would
          remount and lose everything.
        */}
        {runtime &&
          notebookPortalEl &&
          createPortal(
            <Suspense fallback={null}>
              <NotebookPanel
                key={`nb-${workspaceVersion}`}
                ref={notebookPanelRef}
                runtime={runtime}
                theme={theme}
                onCountChanged={setNotebookCount}
                placement={notebookFloating ? "floating" : "tab"}
                onTogglePlacement={toggleNotebookFloating}
                onSetCurrentPanel={(panel) => {
                  if (panel === "signal" || panel === "image") {
                    handleTreeKindChange(panel);
                    setCentralView("plot");
                  }
                }}
                getSelection={() => selectedIds}
                getCurrentPanel={() => treeKind}
                selectObjects={(ids, panel) => {
                  if (panel === "signal" || panel === "image") {
                    handleTreeKindChange(panel);
                    setCentralView("plot");
                  }
                  setSelectedIds(ids);
                  setCurrentId(ids[0] ?? null);
                }}
                onModelChanged={(panel) => {
                  if (!runtime) return;
                  if (panel && panel !== treeKind) return;
                  void refresh();
                }}
                onConvertToMacro={(title, code) => {
                  // Make sure the macro panel is visible (re-dock it if
                  // it was floating, then focus the central tab).
                  if (macroFloating) setMacroFloating(false);
                  setCentralView("macro");
                  void macroPanelRef.current?.importMacro(title, code);
                }}
              />
            </Suspense>,
            notebookPortalEl,
          )}
        {runtime &&
          macroPortalEl &&
          createPortal(
            <Suspense fallback={null}>
              <MacroPanel
                key={`macro-${workspaceVersion}`}
                ref={macroPanelRef}
                runtime={runtime}
                onCountChanged={setMacroCount}
                placement={macroFloating ? "floating" : "tab"}
                onTogglePlacement={toggleMacroFloating}
                onSetCurrentPanel={(panel) => {
                  if (panel === "signal" || panel === "image") {
                    handleTreeKindChange(panel);
                    setCentralView("plot");
                  }
                }}
                getSelection={() => selectedIds}
                getCurrentPanel={() => treeKind}
                selectObjects={(ids, panel) => {
                  if (panel === "signal" || panel === "image") {
                    handleTreeKindChange(panel);
                    setCentralView("plot");
                  }
                  setSelectedIds(ids);
                  setCurrentId(ids[0] ?? null);
                }}
                onModelChanged={(panel) => {
                  if (!runtime) return;
                  if (panel && panel !== treeKind) return;
                  void refresh();
                }}
                onConvertToNotebook={(title, code) => {
                  if (notebookFloating) setNotebookFloating(false);
                  setCentralView("notebook");
                  notebookPanelRef.current?.importMacroAsNotebook(title, code);
                }}
                theme={theme}
              />
            </Suspense>,
            macroPortalEl,
          )}
        <div data-tour="menubar">
          <MenuBar
            status={status === "ready" ? t("Ready") : message}
            statusKind={status}
            state={actionState}
            actions={actions}
            onShowExperimentalInfo={() => setHelpView("about")}
            onOpenConsole={() => setHelpView("console")}
            runtime={runtime}
            onFreeMemory={handleFreeMemory}
            storeOnDisk={storeOnDisk}
            storageBusy={storageBusy}
            diskStorageSupported={DataLabRuntime.isDiskStorageSupported()}
            onToggleStoreOnDisk={() => {
              void handleToggleStoreOnDisk();
            }}
            aiPanelVisible={aiPanelVisible}
            onToggleAIPanel={toggleAIPanel}
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          />
        </div>
        <CommandPalette
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          actions={actions}
          state={actionState}
        />
        {showToolbar && <Toolbar actions={actions} state={actionState} />}
        {recoveryBanner && (
          <RecoveryBanner
            macroCount={recoveryBanner.macros}
            notebookCount={recoveryBanner.notebooks}
            onDismiss={() => setRecoveryBanner(null)}
          />
        )}
        <div className="workspace">
          <aside className="panel" style={{ width: leftPanelWidth }}>
            <div data-tour="tree-kind-switcher">
              <TreeKindSwitcher
                active={treeKind}
                onChange={handleTreeKindChange}
                disabled={status !== "ready" || busy}
              />
            </div>
            <div className="panel-body" data-tour="object-tree">
              <ObjectTree
                ref={objectTreeRef}
                tree={tree}
                selectedIds={selectedIds}
                selectedGroupIds={selectedGroupIds}
                currentId={currentId}
                onSelectionChange={handleSelectionChange}
                onRenameObject={handleRenameObject}
                onRenameGroup={handleRenameGroup}
                onDeleteGroup={handleDeleteGroup}
                onDeleteObjects={deleteObjects}
                onMoveObjects={handleMoveObjects}
                onObjectContextMenu={handleObjectContextMenu}
              />
            </div>
          </aside>
          <Splitter
            side="left"
            value={leftPanelWidth}
            min={180}
            max={500}
            onChange={setLeftPanelWidth}
            ariaLabel={t("Resize left panel")}
          />
          <main className="plot-area" data-tour="plot-host">
            <div data-tour="central-view-switcher">
              <CentralViewSwitcher
                active={centralView}
                onChange={handleCentralViewChange}
                disabled={status !== "ready" || busy}
                detached={{
                  notebook: notebookFloating,
                  macro: macroFloating,
                }}
              />
            </div>
            {/*
              Stable host divs for the Notebook / Macro panels.  They
              are *targets* for the panels' portal element (managed
              imperatively in the placement effect above), not direct
              parents in the React tree — that's how we preserve cell
              state, kernel workers and editor selection across
              tab/floating placement toggles.  The hosts are always
              mounted; visibility is controlled with ``display`` so
              the layout collapses cleanly.
            */}
            {runtime && (
              <div
                ref={setNotebookCentralHost}
                className="nb-panel-host"
                data-tour="central-notebooks"
                style={{
                  display:
                    !notebookFloating && centralView === "notebook"
                      ? "flex"
                      : "none",
                  flex: "1 1 auto",
                  minWidth: 0,
                  minHeight: 0,
                }}
              />
            )}
            {runtime && (
              <div
                ref={setMacroCentralHost}
                className="macro-panel-host"
                data-tour="central-macros"
                style={{
                  display:
                    !macroFloating && centralView === "macro" ? "flex" : "none",
                  flex: "1 1 auto",
                  minWidth: 0,
                  minHeight: 0,
                }}
              />
            )}
            {centralView === "plot" && status === "error" && (
              <div
                className="plot-empty"
                style={{ color: "#c4302b", padding: 16, textAlign: "center" }}
              >
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    {t("Failed to initialise Sigima")}
                  </div>
                  <div style={{ fontSize: 12 }}>{error}</div>
                  <div
                    style={{
                      fontSize: 11,
                      marginTop: 10,
                      color: "var(--text-dim)",
                    }}
                  >
                    {t("See the browser console for the full traceback.")}
                  </div>
                </div>
              </div>
            )}
            {centralView === "plot" &&
              status === "loading" &&
              !data &&
              !imageData && (
                <div className="plot-empty plot-loading">
                  <img
                    src={
                      new URL("./assets/DataLab-Splash.svg", import.meta.url)
                        .href
                    }
                    alt="DataLab"
                    className="plot-loading-logo"
                  />
                  <div className="plot-loading-message">{message}</div>
                  <EdgeSlowLoadHint />
                </div>
              )}
            {centralView === "plot" &&
              status === "ready" &&
              !data &&
              !imageData &&
              (() => {
                const treeEmpty = (t: typeof tree) =>
                  !t || t.groups.every((g) => g.objects.length === 0);
                const workspaceEmpty =
                  treeEmpty(tree) && treeEmpty(inactiveTree);
                const emptyEverywhere = workspaceEmpty;
                const showWelcome =
                  welcomeForced ||
                  (!welcomeDismissed &&
                    emptyEverywhere &&
                    readShowWelcomeOnStartup());
                if (showWelcome) {
                  return (
                    <WelcomeView
                      appVersion={
                        (import.meta.env.VITE_APP_VERSION as string) ?? "dev"
                      }
                      workspaceEmpty={emptyEverywhere}
                      onDismiss={
                        emptyEverywhere
                          ? undefined
                          : () => {
                              setWelcomeForced(false);
                              setWelcomeDismissed(true);
                            }
                      }
                      onOpenWorkspaceHdf5={handleOpenWorkspaceHdf5}
                      onImportTextWizard={handleImportTextWizard}
                      onBrowseHdf5={handleImportHdf5}
                      onCreateKind={(kind) => {
                        if (treeKind !== kind) handleTreeKindChange(kind);
                        requestAnimationFrame(() => {
                          const el = document.querySelector(
                            '[data-menu-top="Create"]',
                          ) as HTMLElement | null;
                          el?.click();
                        });
                      }}
                      onOpenFileKind={(kind) => {
                        if (treeKind !== kind) handleTreeKindChange(kind);
                        requestAnimationFrame(() => {
                          void handleOpenFile();
                        });
                      }}
                      onStartTour={() => {
                        handleStartTour();
                      }}
                      onOpenUserGuide={() => setUserGuideOpen(true)}
                      onOpenReleaseNotes={() => setReleaseNotesOpen(true)}
                      onOpenAIAssistant={openAIPanel}
                    />
                  );
                }
                return (
                  <div className="plot-empty">
                    {treeKind === "signal"
                      ? t("Create a signal to get started.")
                      : t("Create an image to get started.")}
                  </div>
                );
              })()}
            {centralView === "plot" && treeKind === "signal" && data && (
              <SignalPlot
                data={data}
                oid={currentId}
                annotations={annotations}
                onAnnotationsChange={handleAnnotationsChange}
                roi={roi}
                roiEditMode={roiEditMode}
                onRoiChange={handleRoiChangeFromPlot}
                drawGeometry={roiEditMode ? roiDrawGeometry : null}
                results={results}
                showResultsOverlay={showResultsOverlay}
                showGraphicalTitles={showGraphicalTitles}
                extraSignals={extraSignals}
                extraResults={extraResults}
              />
            )}
            {centralView === "plot" &&
              treeKind === "image" &&
              imageData &&
              extraImages.length > 0 && (
                <div className="multi-image-host">
                  <div className="multi-image-modebar">
                    <button
                      type="button"
                      className={`multi-image-modebtn${spatialMultiImage ? "" : " active"}`}
                      onClick={() => setSpatialMultiImage(false)}
                      title={t("Thumbnail grid (each image independent)")}
                    >
                      {t("Grid")}
                    </button>
                    <button
                      type="button"
                      className={`multi-image-modebtn${spatialMultiImage ? " active" : ""}`}
                      onClick={() => setSpatialMultiImage(true)}
                      title={t(
                        "Spatial overlay (honours image positions and the grid distribution tools)",
                      )}
                    >
                      {t("Spatial")}
                    </button>
                  </div>
                  {spatialMultiImage ? (
                    <MultiImageSpatialPlot
                      images={[imageData, ...extraImages]}
                      totalSelected={selectedIds.length}
                    />
                  ) : (
                    <MultiImagePlot
                      images={[imageData, ...extraImages]}
                      totalSelected={selectedIds.length}
                    />
                  )}
                </div>
              )}
            {centralView === "plot" &&
              treeKind === "image" &&
              imageData &&
              extraImages.length === 0 && (
                <ImagePlot
                  data={imageData}
                  roi={imageEraseMode ? eraseRegions : imageRoi}
                  roiEditMode={imageEraseMode || imageRoiEditMode}
                  onRoiChange={
                    imageEraseMode
                      ? handleEraseChangeFromPlot
                      : handleImageRoiChangeFromPlot
                  }
                  drawGeometry={
                    imageEraseMode || imageRoiEditMode ? roiDrawGeometry : null
                  }
                  highlightedVertex={
                    (imageEraseMode || imageRoiEditMode) &&
                    selectedRoiIndex !== null &&
                    activeRoiVertex !== null
                      ? {
                          roiIndex: selectedRoiIndex,
                          vertexIndex: activeRoiVertex,
                        }
                      : null
                  }
                  results={results}
                  showResultsOverlay={showResultsOverlay}
                  showGraphicalTitles={showGraphicalTitles}
                  lutRange={imageLutRange}
                  onLutRangeChange={(r) => {
                    setImageLutRange(r);
                    if (runtime && currentId) {
                      runtime
                        .setLutRange(currentId, r)
                        .catch((e) =>
                          console.error("Failed to persist LUT range:", e),
                        );
                    }
                  }}
                  onColormapChange={(name, inverted) => {
                    if (runtime && currentId) {
                      runtime
                        .setColormap(currentId, name, inverted)
                        .catch((e) =>
                          console.error("Failed to persist colormap:", e),
                        );
                    }
                  }}
                  onResampleChange={(method) => {
                    if (runtime && currentId) {
                      runtime
                        .setResampleMethod(currentId, method)
                        .catch((e) =>
                          console.error(
                            "Failed to persist resample method:",
                            e,
                          ),
                        );
                    }
                  }}
                  onExtractProfile={handleExtractProfile}
                />
              )}
          </main>
          {runtime && centralView === "plot" && (
            <>
              <Splitter
                side="right"
                value={sidePanelWidth}
                min={260}
                max={900}
                onChange={setSidePanelWidth}
                ariaLabel="Resize results panel"
              />
              <SidePanel
                runtime={runtime}
                currentId={currentId}
                panelKind={treeKind === "image" ? "image" : "signal"}
                refreshNonce={sideRefreshNonce}
                onObjectChanged={handleSideObjectChanged}
                preferredTab={preferredSideTab}
                results={results}
                onClearResults={handleClearResults}
                width={sidePanelWidth}
              />
            </>
          )}
          {runtime &&
            centralView === "plot" &&
            ((treeKind === "signal" && data && roiEditMode) ||
              (treeKind === "image" &&
                imageData &&
                extraImages.length === 0 &&
                (imageRoiEditMode || imageEraseMode))) && (
              <DraggableFloating
                storageKey="datalab-web.roiPanelFloating"
                defaultWidth={300}
                defaultHeight={460}
                minWidth={260}
                minHeight={220}
                dragHandleSelector=".roi-panel-header"
                className="floating-dock-host roi-floating"
              >
                <RoiPanel
                  kind={treeKind === "image" ? "image" : "signal"}
                  signalRoi={roi}
                  imageRoi={imageEraseMode ? eraseRegions : imageRoi}
                  bounds={
                    treeKind === "image" && imageData
                      ? {
                          xMin: imageData.x0,
                          xMax: imageData.x0 + imageData.width * imageData.dx,
                          yMin: imageData.y0,
                          yMax: imageData.y0 + imageData.height * imageData.dy,
                        }
                      : {
                          xMin: data?.x[0] ?? 0,
                          xMax: data?.x[(data?.x.length ?? 1) - 1] ?? 1,
                          yMin: 0,
                          yMax: 1,
                        }
                  }
                  selectedIndex={selectedRoiIndex}
                  onSelect={setSelectedRoiIndex}
                  onSignalChange={handleRoiChangeFromPlot}
                  onImageChange={
                    imageEraseMode
                      ? setEraseRegions
                      : handleImageRoiChangeFromPlot
                  }
                  onRequestDraw={handleRoiRequestDraw}
                  activeDraw={roiDrawGeometry}
                  onActiveVertexChange={setActiveRoiVertex}
                  title={imageEraseMode ? t("Erase area") : undefined}
                  primaryAction={
                    imageEraseMode
                      ? { label: t("Apply"), onClick: handleApplyErase }
                      : undefined
                  }
                  onRemoveAll={
                    imageEraseMode
                      ? () => setEraseRegions([])
                      : treeKind === "image"
                        ? handleImageRoiRemoveAll
                        : handleRoiRemoveAll
                  }
                  onClose={
                    imageEraseMode
                      ? handleCancelErase
                      : treeKind === "image"
                        ? handleToggleImageRoiEditMode
                        : handleToggleRoiEditMode
                  }
                />
              </DraggableFloating>
            )}
          {runtime && aiPanelVisible && aiPanelCollapsed && (
            <button
              type="button"
              className="ai-floating-pill"
              data-tour="ai-assistant"
              onClick={() => setAIPanelCollapsed(false)}
              title={t("Expand AI Assistant")}
              aria-label={t("Expand AI Assistant")}
            >
              AI
            </button>
          )}
          {runtime && aiPanelVisible && !aiPanelCollapsed && (
            <DraggableFloating
              storageKey="datalab-web.aiPanelFloating"
              defaultWidth={400}
              minWidth={300}
              minHeight={260}
              className="floating-dock-host"
            >
              <div
                data-tour="ai-assistant"
                style={{ width: "100%", height: "100%" }}
              >
                <AIAssistantPanel
                  runtime={runtime}
                  onMinimize={() => setAIPanelCollapsed(true)}
                  onClose={() => setAIPanelVisible(false)}
                />
              </div>
            </DraggableFloating>
          )}
          {runtime && (notebookFloating || macroFloating) && (
            <FloatingDockStack>
              {notebookFloating && (
                <div
                  ref={setNotebookFloatingHost}
                  className="floating-dock-host floating-dock-host--notebook"
                />
              )}
              {macroFloating && (
                <div
                  ref={setMacroFloatingHost}
                  className="floating-dock-host floating-dock-host--macro"
                />
              )}
            </FloatingDockStack>
          )}
          {userGuideOpen && (
            <div className="userguide-floating-host">
              <UserGuidePanel onClose={() => setUserGuideOpen(false)} />
            </div>
          )}
        </div>
        <GuidedTour
          open={tourOpen}
          steps={tourSteps}
          onClose={handleCloseTour}
        />
        {showAISettings && (
          <AISettingsDialog onClose={() => setShowAISettings(false)} />
        )}
        {pendingOperand && (
          <OperandPicker
            title={pendingOperand.feature.label.replace(/\u2026$/, "")}
            operandLabel={pendingOperand.feature.operand_label}
            tree={tree}
            excludeIds={pendingOperand.sourceIds}
            onSubmit={handleOperandChosen}
            onCancel={() => setPendingOperand(null)}
          />
        )}
        {pending && runtime && (
          <DataSetDialog
            title={pending.feature.label.replace(/\u2026$/, "")}
            payload={pending.schema!}
            resolveChoices={(itemName, currentValues) =>
              runtime.resolveFeatureChoices(
                pending.feature.id,
                itemName,
                currentValues,
                pending.sourceIds[0],
              )
            }
            resolveCallbacks={(itemName, currentValues) =>
              runtime.resolveFeatureCallbacks(
                pending.feature.id,
                itemName,
                currentValues,
                pending.sourceIds[0],
              )
            }
            resolveActive={(currentValues) =>
              runtime.resolveFeatureActive(pending.feature.id, currentValues)
            }
            onSubmit={handleSubmitParams}
            onCancel={() => setPending(null)}
          />
        )}
        {pendingProfile && runtime && (
          <ProfileDefinitionDialog
            title={pendingProfile.feature.label.replace(/\u2026$/, "")}
            featureId={
              pendingProfile.feature.id.replace(
                /^image:/,
                "",
              ) as ProfileFeatureId
            }
            payload={pendingProfile.schema}
            imageData={pendingProfile.imageData}
            resolveChoices={(itemName, currentValues) =>
              runtime.resolveFeatureChoices(
                pendingProfile.feature.id,
                itemName,
                currentValues,
              )
            }
            resolveCallbacks={(itemName, currentValues) =>
              runtime.resolveFeatureCallbacks(
                pendingProfile.feature.id,
                itemName,
                currentValues,
              )
            }
            resolveActive={(currentValues) =>
              runtime.resolveFeatureActive(
                pendingProfile.feature.id,
                currentValues,
              )
            }
            onSubmit={handleSubmitProfile}
            onCancel={() => setPendingProfile(null)}
          />
        )}
        {pendingAnalysis && (
          <DataSetDialog
            title={pendingAnalysis.label}
            payload={pendingAnalysis.schema}
            onSubmit={handleSubmitAnalysisParams}
            onCancel={() => setPendingAnalysis(null)}
            resolveActive={
              runtime
                ? (currentValues) =>
                    runtime.resolveAnalysisActive(
                      pendingAnalysis.kind,
                      pendingAnalysis.funcId,
                      currentValues,
                    )
                : undefined
            }
          />
        )}
        {pendingPlotResults &&
          (() => {
            const entry = pendingPlotResults.entries[pendingPlotResults.index];
            return (
              <DataSetDialog
                // Remount per category so the form resets its internal
                // values when advancing through the dialog queue.
                key={entry.category}
                title={`${t("Plot results")} — ${entry.label}`}
                payload={buildPlotResultsSchema(entry)}
                onSubmit={handleSubmitPlotResults}
                onCancel={handleCancelPlotResults}
              />
            );
          })()}
        {pendingImageGrid && (
          <DataSetDialog
            title={t("Distribute on a grid")}
            payload={pendingImageGrid.schema}
            onSubmit={handleSubmitImageGrid}
            onCancel={() => setPendingImageGrid(null)}
            resolveActive={
              runtime
                ? (currentValues) =>
                    runtime.resolveImageGridActive(currentValues)
                : undefined
            }
          />
        )}
        {pendingRoiGrid && imageData && (
          <RoiGridDialog
            imageData={imageData}
            payload={pendingRoiGrid.schema}
            onSubmit={handleSubmitRoiGrid}
            onCancel={() => setPendingRoiGrid(null)}
          />
        )}
        {pendingFit && (
          <InteractiveFitDialog
            oid={pendingFit.oid}
            fit={pendingFit.fit}
            onCommit={handleInteractiveFitCommit}
            onCancel={() => setPendingFit(null)}
          />
        )}
        {editingMeta && (
          <ObjectPropertiesDialog
            initial={editingMeta}
            onSubmit={handleSubmitMeta}
            onCancel={() => setEditingMeta(null)}
          />
        )}
        {helpView && (
          <HelpDialog
            view={helpView}
            onClose={() => setHelpView(null)}
            appVersion={import.meta.env.VITE_APP_VERSION}
          />
        )}
        {releaseNotesOpen && (
          <ReleaseNotesDialog
            appVersion={(import.meta.env.VITE_APP_VERSION as string) ?? "dev"}
            onClose={() => setReleaseNotesOpen(false)}
          />
        )}
        {h5BrowserFiles !== null && (
          <H5BrowserDialog
            initial={h5BrowserFiles}
            onImport={handleH5BrowserImport}
            onCancel={() => setH5BrowserFiles(null)}
          />
        )}
        {textImportOpen && (
          <TextImportWizard
            onImport={handleTextImportFinished}
            onCancel={() => setTextImportOpen(false)}
          />
        )}
        {pendingSaveToDir && runtime && (
          <SaveToDirectoryDialog
            sources={pendingSaveToDir.sources}
            extensions={pendingSaveToDir.extensions}
            formatBasenames={(pattern) =>
              runtime.formatSignalBasenames(
                pendingSaveToDir.sources.map((s) => s.id),
                pattern,
              )
            }
            onSubmit={handleSubmitSaveToDir}
            onCancel={() => setPendingSaveToDir(null)}
          />
        )}
        {pluginManagerOpen && (
          <PluginManagerDialog
            onClose={() => {
              setPluginManagerOpen(false);
              void refreshPluginActions();
              if (runtime) void runtime.listFeatures().then(setFeatures);
            }}
          />
        )}
        {separateViewOpen &&
          (() => {
            // Build the popout payload lazily so we don't allocate the
            // (potentially large) signal/image content on every render of
            // the main App.
            let content: SeparateViewContent | null = null;
            if (treeKind === "signal" && data) {
              content = {
                kind: "signal",
                data,
                oid: currentId,
                annotations,
                roi,
                results,
                extraSignals,
              };
            } else if (treeKind === "image" && imageData) {
              content = {
                kind: "image",
                data: imageData,
                roi: imageRoi,
                results,
                lutRange: imageLutRange,
              };
            }
            if (!content) return null;
            return (
              <SeparateViewDialog
                content={content}
                showResultsOverlay={showResultsOverlay}
                showGraphicalTitles={showGraphicalTitles}
                onClose={closeSeparateView}
              />
            );
          })()}
        <DialogBridge />
        {contextMenu && (
          <ContextMenu
            nodes={buildObjectContextMenu(actions, treeKind)}
            state={actionState}
            position={contextMenu}
            onClose={closeContextMenu}
          />
        )}
      </div>
    </ObjectNavigationProvider>
  );
}
