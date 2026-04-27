import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRuntime } from "./runtime/RuntimeContext";
import type {
  FeatureDescriptor,
  H5BrowserFile,
  ImageData,
  InteractiveFitInfo,
  PanelTree,
  PluginMenuAction,
  SchemaWithValues,
  SignalData,
} from "./runtime/runtime";
import { MenuBar } from "./components/MenuBar";
import {
  buildFeatureActions,
  buildHelpActions,
  buildNotebookActions,
  buildImageAnalysisActions,
  buildImageCreationActions,
  buildImageGridActions,
  buildImageRoiActions,
  buildImageEraseActions,
  buildInteractiveFitActions,
  buildPluginActions,
  buildRoiActions,
  buildSignalAnalysisActions,
  buildSignalCreationActions,
  buildStaticActions,
} from "./actions/registry";
import { ObjectTree } from "./components/ObjectTree";
import { PanelSwitcher, type PanelKind } from "./components/PanelSwitcher";
import { SignalPlot } from "./components/SignalPlot";
import { ImagePlot } from "./components/ImagePlot";
import { DataSetDialog } from "./components/DataSetDialog";
import {
  ProfileDefinitionDialog,
  type ProfileFeatureId,
} from "./components/ProfileDefinitionDialog";
import { OperandPicker } from "./components/OperandPicker";
import { HelpDialog, type HelpView } from "./components/HelpDialog";
import { DialogBridge } from "./components/DialogBridge";
import { InteractiveFitDialog } from "./components/InteractiveFitDialog";
import { PluginManagerDialog } from "./components/PluginManagerDialog";
import { MetadataDialog } from "./components/MetadataDialog";
import { RoiDialog } from "./components/RoiDialog";
import { ImageRoiDialog } from "./components/ImageRoiDialog";
import { RoiGridDialog } from "./components/RoiGridDialog";
import { H5BrowserDialog } from "./components/H5BrowserDialog";
import {
  SaveToDirectoryDialog,
  type SaveToDirectoryResult,
  type SaveToDirectorySource,
} from "./components/SaveToDirectoryDialog";
import { TextImportWizard } from "./components/TextImportWizard";
import { SidePanel } from "./components/SidePanel";
import { Splitter } from "./components/Splitter";
import { MacroPanel, type MacroPanelHandle } from "./components/MacroPanel";
import {
  NotebookPanel,
  type NotebookPanelHandle,
} from "./components/notebook/NotebookPanel";
import { useTheme } from "./utils/theme";
import type {
  AnalysisResult,
  ImageCreationType,
  ImageRoiSegment,
  ObjectMeta,
  PlotlyAnnotations,
  SignalAnalysisDescriptor,
  SignalCreationType,
  SignalRoiSegment,
} from "./runtime/runtime";

interface PendingFeature {
  feature: FeatureDescriptor;
  sourceIds: string[];
  operandId: string | null;
  schema: SchemaWithValues | null;
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
  "image:radial_profile",
]);

/** Pending parametric analysis waiting for the user's parameter input. */
interface PendingAnalysis {
  funcId: string;
  label: string;
  schema: SchemaWithValues;
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

export default function App() {
  const { runtime, status, message, error } = useRuntime();
  const [activePanel, setActivePanel] = useState<PanelKind>("signal");
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
  const [tree, setTree] = useState<PanelTree | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [data, setData] = useState<SignalData | null>(null);
  /** Other signals selected alongside ``currentId`` — overlaid on top
   *  of ``data`` in :class:`SignalPlot` to mirror DataLab desktop's
   *  multi-curve plot. */
  const [extraSignals, setExtraSignals] = useState<SignalData[]>([]);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [features, setFeatures] = useState<FeatureDescriptor[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingFeature | null>(null);
  const [pendingProfile, setPendingProfile] = useState<{
    feature: FeatureDescriptor;
    sourceIds: string[];
    schema: SchemaWithValues;
    imageData: ImageData;
  } | null>(null);
  const [pendingOperand, setPendingOperand] = useState<{
    feature: FeatureDescriptor;
    sourceIds: string[];
  } | null>(null);
  const [editingMeta, setEditingMeta] = useState<ObjectMeta | null>(null);
  const [helpView, setHelpView] = useState<HelpView | null>(null);
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
  const [editingRoi, setEditingRoi] = useState<SignalRoiSegment[] | null>(null);
  const [roiEditMode, setRoiEditMode] = useState<boolean>(false);
  const [imageRoi, setImageRoi] = useState<ImageRoiSegment[]>([]);
  const [imageRoiEditMode, setImageRoiEditMode] = useState<boolean>(false);
  const [editingImageRoi, setEditingImageRoi] = useState<
    ImageRoiSegment[] | null
  >(null);
  /** Persisted LUT range override for the current image (``null`` ⇒
   *  fall back to the image's intrinsic ``data_min``/``data_max``).
   *  Driven by the contrast tool inside :class:`ImagePlot`. */
  const [imageLutRange, setImageLutRange] = useState<[number, number] | null>(
    null,
  );
  /** ROI segments shown by the ad-hoc dialog used by ``Erase area…``.
   *  Distinct from ``editingImageRoi`` so submission triggers the erase
   *  computation instead of overwriting the image's own ROI list. */
  const [erasingImageRoi, setErasingImageRoi] = useState<
    ImageRoiSegment[] | null
  >(null);
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
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [sideRefreshNonce, setSideRefreshNonce] = useState(0);
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

  /** ``activePanel`` narrowed to the runtime's PanelKind ("signal" |
   *  "image").  When the user is on the macro or notebook panel we
   *  still need a "real" panel kind for the proxy bridge, so we fall
   *  back to the last object panel they used (defaults to "signal"). */
  const lastObjectPanelRef = useRef<"signal" | "image">("signal");
  const isObjectPanel = activePanel === "signal" || activePanel === "image";
  const objectPanel: "signal" | "image" = isObjectPanel
    ? (activePanel as "signal" | "image")
    : lastObjectPanelRef.current;
  useEffect(() => {
    if (isObjectPanel) {
      lastObjectPanelRef.current = activePanel as "signal" | "image";
    }
  }, [activePanel, isObjectPanel]);
  const theme = useTheme().theme;

  const refresh = useCallback(
    async (preferredCurrentId?: string | null) => {
      if (!runtime) return;
      if (activePanel !== "signal" && activePanel !== "image") return;
      const newTree = await runtime.getPanelTree(activePanel);
      setTree(newTree);
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
    [runtime, activePanel],
  );

  /** Refresh a panel that may differ from the current ``activePanel``,
   *  switching panels in the process.  Used by cross-kind processings
   *  whose result lands in a different panel than the source. */
  const refreshPanelKind = useCallback(
    async (kind: PanelKind, preferredCurrentId?: string | null) => {
      if (!runtime) return;
      setActivePanel(kind);
      if (kind !== "signal" && kind !== "image") return;
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
    [runtime],
  );

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
      setAnnotations({ shapes: [], annotations: [] });
      setRoi([]);
      setImageRoi([]);
      setImageLutRange(null);
      setResults([]);
      return;
    }
    let cancelled = false;
    if (activePanel === "image") {
      // Image panel: viewer + ROI + analysis results.
      setData(null);
      setExtraSignals([]);
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
    } else {
      runtime
        .getSignalsData(extraIds)
        .then((sigs) => {
          if (!cancelled) setExtraSignals(sigs);
        })
        .catch(() => {
          if (!cancelled) setExtraSignals([]);
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
  }, [runtime, currentId, activePanel, selectedIds]);

  const handleSelectionChange = useCallback(
    (ids: string[], current: string | null) => {
      setSelectedIds(ids);
      setCurrentId(current);
    },
    [],
  );

  const handleSwitchPanel = useCallback(
    (kind: PanelKind) => {
      if (kind === activePanel) return;
      setActivePanel(kind);
      setSelectedIds([]);
      setCurrentId(null);
      setData(null);
      setExtraSignals([]);
      setImageData(null);
      setRoi([]);
      setImageRoi([]);
      setResults([]);
    },
    [activePanel],
  );

  const handleCreateTyped = useCallback(
    async (stype: string) => {
      if (!runtime) return;
      setBusy(true);
      try {
        const id = await runtime.createSignalTyped(stype);
        setPreferredSideTab("creation");
        await refresh(id);
        setSideRefreshNonce((n) => n + 1);
      } finally {
        setBusy(false);
      }
    },
    [runtime, refresh],
  );

  const handleCreateImageTyped = useCallback(
    async (stype: string) => {
      if (!runtime) return;
      setBusy(true);
      try {
        const id = await runtime.createImageTyped(stype);
        setPreferredSideTab("creation");
        await refresh(id);
        setSideRefreshNonce((n) => n + 1);
      } finally {
        setBusy(false);
      }
    },
    [runtime, refresh],
  );

  const handleSideObjectChanged = useCallback(
    async (oid: string) => {
      if (!runtime) return;
      // The Creation/Properties form just mutated the object — refresh
      // the plot data and the tree (title / size may have changed).
      try {
        if (activePanel === "image") {
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
    },
    [runtime, refresh, activePanel],
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

  const runFeature = useCallback(
    async (
      feature: FeatureDescriptor,
      sourceIds: string[],
      operandId: string | null,
      values: Record<string, unknown> | null,
    ) => {
      if (!runtime) return;
      setBusy(true);
      try {
        const newIds = await runtime.applyFeature(
          feature.id,
          sourceIds,
          operandId,
          values,
        );
        const lastId = newIds[newIds.length - 1] ?? null;
        if (feature.output_kind !== feature.object_kind) {
          // Cross-kind: result lands in a different panel — switch to it
          // and refresh that panel's tree explicitly (cannot rely on the
          // ``refresh`` closure that reads the stale ``activePanel``).
          await refreshPanelKind(feature.output_kind, lastId);
        } else {
          await refresh(lastId);
        }
      } finally {
        setBusy(false);
      }
    },
    [runtime, refresh, refreshPanelKind],
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
        await runtime.triggerPluginAction(actionId);
        await refresh();
      } catch (err) {
        console.error("[plugins] action failed", err);
      } finally {
        setBusy(false);
      }
    },
    [runtime, refresh],
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
      if (feature.pattern === "n_to_1" && sourceIds.length < 2) {
        // n_to_1 needs at least 2 sources to be meaningful; let it through
        // if Sigima accepts a single-element list, otherwise the error
        // surfaces in the console.
      }
      if (feature.pattern === "2_to_1") {
        setPendingOperand({ feature, sourceIds });
        return;
      }
      if (feature.has_params) {
        const schema = await runtime.getFeatureSchema(featureId);
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
              });
              return;
            } catch (err) {
              console.error("[profile] failed to fetch image data", err);
              // Fall back to the regular dialog so the user can still
              // type values manually.
            }
          }
          setPending({ feature, sourceIds, operandId: null, schema });
          return;
        }
      }
      await runFeature(feature, sourceIds, null, null);
    },
    [runtime, features, sourcesFor, runFeature],
  );

  const handleOperandChosen = useCallback(
    async (operandId: string) => {
      if (!runtime || !pendingOperand) return;
      const { feature, sourceIds } = pendingOperand;
      setPendingOperand(null);
      if (feature.has_params) {
        const schema = await runtime.getFeatureSchema(feature.id);
        if (schema) {
          setPending({ feature, sourceIds, operandId, schema });
          return;
        }
      }
      await runFeature(feature, sourceIds, operandId, null);
    },
    [runtime, pendingOperand, runFeature],
  );

  const handleSubmitParams = useCallback(
    async (values: Record<string, unknown>) => {
      if (!pending) return;
      const { feature, sourceIds, operandId } = pending;
      setPending(null);
      await runFeature(feature, sourceIds, operandId, values);
    },
    [pending, runFeature],
  );

  const handleSubmitProfile = useCallback(
    async (values: Record<string, unknown>) => {
      if (!pendingProfile) return;
      const { feature, sourceIds } = pendingProfile;
      setPendingProfile(null);
      await runFeature(feature, sourceIds, null, values);
    },
    [pendingProfile, runFeature],
  );

  const refreshResults = useCallback(
    async (oid: string) => {
      if (!runtime) return;
      const rs =
        activePanel === "image"
          ? await runtime.listImageResults(oid)
          : await runtime.listSignalResults(oid);
      setResults(rs);
    },
    [runtime, activePanel],
  );

  const runAnalysis = useCallback(
    async (
      funcId: string,
      params: Record<string, unknown> | null,
      oid: string,
    ) => {
      if (!runtime) return;
      setBusy(true);
      try {
        const result =
          activePanel === "image"
            ? await runtime.runImageAnalysis(oid, funcId, params)
            : await runtime.runSignalAnalysis(oid, funcId, params);
        if (result === null) {
          window.alert(
            "The analysis function returned no result " +
              "(e.g. FWHM on a flat curve, or no peak detected).",
          );
        }
        await refreshResults(oid);
        setPreferredSideTab("results");
        setSideRefreshNonce((n) => n + 1);
      } finally {
        setBusy(false);
      }
    },
    [runtime, refreshResults, activePanel],
  );

  const handleAnalysis = useCallback(
    async (funcId: string, hasParams: boolean) => {
      if (!runtime || !currentId) return;
      if (!hasParams) {
        await runAnalysis(funcId, null, currentId);
        return;
      }
      const schema =
        activePanel === "image"
          ? await runtime.getImageAnalysisParamSchema(currentId, funcId)
          : await runtime.getSignalAnalysisParamSchema(currentId, funcId);
      if (!schema) {
        await runAnalysis(funcId, null, currentId);
        return;
      }
      const catalog =
        activePanel === "image" ? imageAnalysisEntries : analysisEntries;
      const entry = catalog.find((e) => e.id === funcId);
      setPendingAnalysis({
        funcId,
        label: entry?.label ?? funcId,
        schema: schema as SchemaWithValues,
      });
    },
    [
      runtime,
      currentId,
      analysisEntries,
      imageAnalysisEntries,
      activePanel,
      runAnalysis,
    ],
  );

  const handleSubmitAnalysisParams = useCallback(
    async (values: Record<string, unknown>) => {
      if (!pendingAnalysis || !currentId) return;
      const { funcId } = pendingAnalysis;
      setPendingAnalysis(null);
      await runAnalysis(funcId, values, currentId);
    },
    [pendingAnalysis, currentId, runAnalysis],
  );

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
      if (activePanel === "image") {
        await runtime.clearImageResults(currentId, key ?? undefined);
      } else {
        await runtime.clearSignalResults(currentId, key ?? undefined);
      }
      await refreshResults(currentId);
    },
    [runtime, currentId, refreshResults, activePanel],
  );

  const handleDelete = useCallback(async () => {
    if (!runtime || selectedIds.length === 0) return;
    setBusy(true);
    try {
      for (const oid of selectedIds) {
        await runtime.deleteObject(oid);
      }
      setSelectedIds([]);
      setCurrentId(null);
      await refresh(null);
    } finally {
      setBusy(false);
    }
  }, [runtime, selectedIds, refresh]);

  const handleNewGroup = useCallback(async () => {
    if (!runtime) return;
    setBusy(true);
    try {
      await runtime.createGroup(objectPanel);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [runtime, refresh, objectPanel]);

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
        await runtime.deleteGroup(gid);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [runtime, refresh],
  );

  const handleMoveObject = useCallback(
    async (oid: string, target: string) => {
      if (!runtime) return;
      await runtime.moveObject(oid, target);
      await refresh();
    },
    [runtime, refresh],
  );

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
      const updated = await runtime.getSignalData(currentId);
      setData(updated);
      await refresh(currentId);
    },
    [runtime, currentId, refresh],
  );

  const handleAnnotationsChange = useCallback(
    async (payload: PlotlyAnnotations) => {
      if (!runtime || !currentId) return;
      setAnnotations(payload);
      await runtime.setPlotlyAnnotations(currentId, payload);
    },
    [runtime, currentId],
  );

  const handleEditRoi = useCallback(async () => {
    if (!runtime || !currentId) return;
    const segs = await runtime.getSignalRoi(currentId);
    setEditingRoi(segs);
  }, [runtime, currentId]);

  const handleSubmitRoi = useCallback(
    async (segments: SignalRoiSegment[]) => {
      if (!runtime || !currentId) return;
      await runtime.setSignalRoi(currentId, segments);
      setEditingRoi(null);
      setRoi(segments);
    },
    [runtime, currentId],
  );

  const handleToggleRoiEditMode = useCallback(() => {
    setRoiEditMode((m) => !m);
  }, []);

  // Live-edit callback fed by the plot when the user drags a ROI handle or
  // draws a brand-new rectangle in edit mode.  The backend is updated with
  // a short debounce to avoid one PyProxy call per pixel.
  const roiWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRoiChangeFromPlot = useCallback(
    (segments: SignalRoiSegment[]) => {
      setRoi(segments);
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
    if (!runtime || !currentId) return;
    await runtime.setSignalRoi(currentId, []);
    setRoi([]);
  }, [runtime, currentId]);

  const handleRoiExtractEach = useCallback(async () => {
    if (!runtime || !currentId) return;
    setBusy(true);
    try {
      const ids = await runtime.extractSignalRois(currentId, false);
      await refresh();
      if (ids.length > 0) setCurrentId(ids[ids.length - 1]);
    } finally {
      setBusy(false);
    }
  }, [runtime, currentId, refresh]);

  const handleRoiExtractMerged = useCallback(async () => {
    if (!runtime || !currentId) return;
    setBusy(true);
    try {
      const ids = await runtime.extractSignalRois(currentId, true);
      await refresh();
      if (ids.length > 0) setCurrentId(ids[0]);
    } finally {
      setBusy(false);
    }
  }, [runtime, currentId, refresh]);

  // ------------------------------------------------------------------
  // Image ROI handlers (Phase 13)
  // ------------------------------------------------------------------

  const handleImageEditRoi = useCallback(async () => {
    if (!runtime || !currentId) return;
    const segs = await runtime.getImageRoi(currentId);
    setEditingImageRoi(segs);
  }, [runtime, currentId]);

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
    setEditingImageRoi(next);
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
    setEditingImageRoi(next);
  }, [runtime, currentId, imageRoi, imageData]);

  const handleSubmitImageRoi = useCallback(
    async (segments: ImageRoiSegment[]) => {
      if (!runtime || !currentId) return;
      await runtime.setImageRoi(currentId, segments);
      setEditingImageRoi(null);
      setImageRoi(segments);
    },
    [runtime, currentId],
  );

  const handleToggleImageRoiEditMode = useCallback(() => {
    setImageRoiEditMode((m) => !m);
  }, []);

  // Live-edit callback fed by the plot when the user drags a ROI handle
  // or draws a brand-new shape in edit mode.  The backend is updated with
  // a short debounce to avoid one PyProxy call per pixel.
  const imageRoiWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleImageRoiChangeFromPlot = useCallback(
    (segments: ImageRoiSegment[]) => {
      setImageRoi(segments);
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
    if (!runtime || !currentId) return;
    await runtime.setImageRoi(currentId, []);
    setImageRoi([]);
  }, [runtime, currentId]);

  const handleImageRoiExtractEach = useCallback(async () => {
    if (!runtime || !currentId) return;
    setBusy(true);
    try {
      const ids = await runtime.extractImageRois(currentId, false);
      await refresh();
      if (ids.length > 0) setCurrentId(ids[ids.length - 1]);
    } finally {
      setBusy(false);
    }
  }, [runtime, currentId, refresh]);

  const handleImageRoiExtractMerged = useCallback(async () => {
    if (!runtime || !currentId) return;
    setBusy(true);
    try {
      const ids = await runtime.extractImageRois(currentId, true);
      await refresh();
      if (ids.length > 0) setCurrentId(ids[0]);
    } finally {
      setBusy(false);
    }
  }, [runtime, currentId, refresh]);

  /** Open the ROI dialog pre-filled with a single centered rectangle, to
   *  let the user define the area to erase. Mirrors DataLab desktop's
   *  ``compute_erase`` which prompts the user for a ROI. */
  const handleOpenEraseDialog = useCallback(() => {
    if (!runtime || !currentId || !imageData) return;
    const sx = (imageData.width * imageData.dx) / 4 || 1;
    const sy = (imageData.height * imageData.dy) / 4 || 1;
    const x0 = imageData.x0 + (imageData.width * imageData.dx) / 2 - sx / 2;
    const y0 = imageData.y0 + (imageData.height * imageData.dy) / 2 - sy / 2;
    setErasingImageRoi([
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
  }, [runtime, currentId, imageData]);

  const handleSubmitErase = useCallback(
    async (segments: ImageRoiSegment[]) => {
      if (!runtime || !currentId) return;
      setErasingImageRoi(null);
      if (segments.length === 0) return;
      setBusy(true);
      try {
        const newOid = await runtime.eraseImageArea(currentId, segments);
        await refresh();
        setCurrentId(newOid);
      } finally {
        setBusy(false);
      }
    },
    [runtime, currentId, refresh],
  );

  /** Refresh the displayed image of *oid* after an in-place layout
   *  change (distribute on a grid / reset positions). */
  const reloadCurrentImage = useCallback(async () => {
    if (!runtime || !currentId || activePanel !== "image") return;
    try {
      const updated = await runtime.getImageData(currentId);
      setImageData(updated);
    } catch {
      /* ignore — object may have been deleted */
    }
  }, [runtime, currentId, activePanel]);

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
        await reloadCurrentImage();
        await refresh(currentId);
      } finally {
        setBusy(false);
      }
    },
    [runtime, pendingImageGrid, reloadCurrentImage, refresh, currentId],
  );

  const handleResetImagePositions = useCallback(async () => {
    if (!runtime) return;
    const ids = imageLayoutSourceIds();
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await runtime.resetImagePositions(ids);
      await reloadCurrentImage();
      await refresh(currentId);
    } finally {
      setBusy(false);
    }
  }, [runtime, imageLayoutSourceIds, reloadCurrentImage, refresh, currentId]);

  const handleCreateRoiGrid = useCallback(async () => {
    if (!runtime || !currentId) return;
    if (
      imageRoi.length > 0 &&
      !window.confirm(
        "Creating a ROI grid will overwrite any existing ROI.\n\nDo you want to continue?",
      )
    ) {
      return;
    }
    const schema = await runtime.getRoiGridParamSchema();
    setPendingRoiGrid({ oid: currentId, schema });
  }, [runtime, currentId, imageRoi]);

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
          window.confirm("Do you want to extract images from the defined ROI?")
        ) {
          const ids = await runtime.extractImageRois(oid, false);
          await refresh();
          if (ids.length > 0) setCurrentId(ids[ids.length - 1]);
        }
      } finally {
        setBusy(false);
      }
    },
    [runtime, pendingRoiGrid, refresh],
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
      const a = document.createElement("a");
      a.href = url;
      a.download = "workspace.h5";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }, [runtime]);

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
          await runtime.openWorkspaceHdf5(file.name, bytes, true);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Qt parity: when the file is a regular HDF5 file (not a
          // DataLab workspace), fall through to the H5 browser dialog.
          if (msg.includes("Not a DataLab HDF5 workspace")) {
            try {
              const opened = await runtime.openH5Browser(file.name, bytes);
              setH5BrowserFiles([opened]);
            } catch (err2) {
              window.alert(
                `Failed to open HDF5 file:\n${
                  err2 instanceof Error ? err2.message : String(err2)
                }`,
              );
            }
            return;
          }
          window.alert(`Failed to open HDF5 workspace:\n${msg}`);
          return;
        }
        setSelectedIds([]);
        setCurrentId(null);
        await refresh(null);
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }, [runtime, refresh]);

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
    [refresh],
  );

  const handleH5BrowserImport = useCallback(
    async (oids: string[], uint32Clipped: boolean) => {
      setH5BrowserFiles(null);
      if (uint32Clipped) {
        window.alert(
          "Some uint32 image data was clipped to int32 range during import.",
        );
      }
      setSelectedIds([]);
      setCurrentId(oids[oids.length - 1] ?? null);
      await refresh(oids[oids.length - 1] ?? null);
    },
    [refresh],
  );

  const handleSaveFile = useCallback(async () => {
    if (!runtime || !currentId) return;
    // Default to CSV (signals) or TIFF (images); users can pick another
    // extension by editing the filename in the prompt dialog.
    const isImage = activePanel === "image";
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
    const ext = window.prompt(
      `File extension (one of: ${writeExts.join(", ")})`,
      fallbackExt,
    );
    if (!ext) return;
    const cleanExt = ext.replace(/^\./, "").trim();
    if (!writeExts.includes(cleanExt)) {
      window.alert(
        `Unsupported extension ".${cleanExt}".\nSupported: ${writeExts.join(", ")}`,
      );
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
  }, [runtime, currentId, data, imageData, activePanel]);

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
      activePanel === "image"
        ? await runtime.listImageIoFormats()
        : await runtime.listSignalIoFormats();
    setPendingSaveToDir({
      sources,
      extensions: formats.all_write_extensions,
    });
  }, [runtime, tree, selectedIds, currentId, activePanel]);

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
            activePanel === "image"
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
              if (!window.confirm(explanation)) return;
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
                if (!window.confirm(explanation)) return;
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
        window.alert(`Save to directory failed:\n${msg}`);
      } finally {
        setBusy(false);
      }
    },
    [runtime, pendingSaveToDir, activePanel],
  );

  const handleOpenFile = useCallback(async () => {
    if (!runtime) return;
    const isImage = activePanel === "image";
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
        for (const file of Array.from(files)) {
          const buf = new Uint8Array(await file.arrayBuffer());
          const ids = isImage
            ? await runtime.openImageFromBytes(file.name, buf)
            : await runtime.openSignalFromBytes(file.name, buf);
          if (ids.length > 0) lastId = ids[ids.length - 1];
        }
        await refresh(lastId);
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }, [runtime, refresh, activePanel]);

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
    }),
    [status, busy, selectedIds, currentId, hasObjects],
  );

  // Restrict feature actions, creation menu and signal-only menus
  // (Analysis / ROI) to the currently active panel.
  const visibleFeatures = useMemo(
    () => features.filter((f) => f.object_kind === activePanel),
    [features, activePanel],
  );

  const actions = useMemo(
    () => [
      ...buildStaticActions({
        onNewGroup: handleNewGroup,
        onDeleteSelection: handleDelete,
        onEditProperties: handleEditProperties,
        onOpenFile: handleOpenFile,
        onSaveFile: handleSaveFile,
        onSaveToDirectory: handleSaveToDirectory,
        onOpenWorkspaceHdf5: handleOpenWorkspaceHdf5,
        onSaveWorkspaceHdf5: handleSaveWorkspaceHdf5,
        onImportHdf5: handleImportHdf5,
        onImportTextWizard: handleImportTextWizard,
        panel: objectPanel,
      }),
      ...buildHelpActions({
        onShowAbout: () => setHelpView("about"),
        onShowShortcuts: () => setHelpView("shortcuts"),
        onShowConsole: () => setHelpView("console"),
      }),
      ...buildNotebookActions({
        onNew: () => {
          handleSwitchPanel("notebook");
          notebookPanelRef.current?.newNotebook();
        },
        onNewFromQuickstart: () => {
          handleSwitchPanel("notebook");
          notebookPanelRef.current?.newFromQuickstart();
        },
        onOpen: () => {
          handleSwitchPanel("notebook");
          notebookPanelRef.current?.openFromDisk();
        },
        onSaveAs: () => notebookPanelRef.current?.saveActiveAsIpynb(),
        onRename: () => {
          handleSwitchPanel("notebook");
          notebookPanelRef.current?.renameActive();
        },
        hasActiveNotebook: () =>
          notebookPanelRef.current?.hasActiveNotebook() ?? false,
      }),
      ...(activePanel === "signal"
        ? buildSignalCreationActions(signalTypes, handleCreateTyped)
        : buildImageCreationActions(imageTypes, handleCreateImageTyped)),
      ...buildFeatureActions(visibleFeatures, handleApplyFeature),
      ...(activePanel === "image"
        ? buildImageGridActions({
            onDistributeOnGrid: handleDistributeOnGrid,
            onResetPositions: handleResetImagePositions,
          })
        : []),
      ...(activePanel === "image"
        ? buildImageEraseActions({ onErase: handleOpenEraseDialog })
        : []),
      ...(activePanel === "signal"
        ? buildInteractiveFitActions(
            interactiveFits,
            handleLaunchInteractiveFit,
          )
        : []),
      ...(activePanel === "signal"
        ? buildSignalAnalysisActions(analysisEntries, handleAnalysis)
        : buildImageAnalysisActions(imageAnalysisEntries, handleAnalysis)),
      ...(activePanel === "signal"
        ? buildRoiActions(roi, roiEditMode, {
            onToggleEditMode: handleToggleRoiEditMode,
            onEditNumerically: handleEditRoi,
            onExtractEach: handleRoiExtractEach,
            onExtractMerged: handleRoiExtractMerged,
            onRemoveAt: handleRoiRemoveAt,
            onRemoveAll: handleRoiRemoveAll,
          })
        : buildImageRoiActions(imageRoi, imageRoiEditMode, {
            onToggleEditMode: handleToggleImageRoiEditMode,
            onAddRectangle: handleImageAddRectangle,
            onAddCircle: handleImageAddCircle,
            onCreateGrid: handleCreateRoiGrid,
            onEditNumerically: handleImageEditRoi,
            onExtractEach: handleImageRoiExtractEach,
            onExtractMerged: handleImageRoiExtractMerged,
            onRemoveAt: handleImageRoiRemoveAt,
            onRemoveAll: handleImageRoiRemoveAll,
          })),
      ...buildPluginActions(pluginActions, objectPanel, {
        onTrigger: handleTriggerPluginAction,
        onOpenManager: () => setPluginManagerOpen(true),
        onReloadAll: handleReloadPlugins,
      }),
    ],
    [
      activePanel,
      objectPanel,
      handleSwitchPanel,
      visibleFeatures,
      signalTypes,
      imageTypes,
      analysisEntries,
      imageAnalysisEntries,
      roi,
      roiEditMode,
      imageRoi,
      imageRoiEditMode,
      handleCreateTyped,
      handleCreateImageTyped,
      handleAnalysis,
      handleNewGroup,
      handleDelete,
      handleApplyFeature,
      handleEditProperties,
      handleEditRoi,
      handleToggleRoiEditMode,
      handleRoiExtractEach,
      handleRoiExtractMerged,
      handleRoiRemoveAt,
      handleRoiRemoveAll,
      handleImageAddRectangle,
      handleImageAddCircle,
      handleCreateRoiGrid,
      handleImageEditRoi,
      handleImageRoiExtractEach,
      handleToggleImageRoiEditMode,
      handleImageRoiExtractMerged,
      handleImageRoiRemoveAt,
      handleImageRoiRemoveAll,
      handleDistributeOnGrid,
      handleResetImagePositions,
      handleOpenEraseDialog,
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
    ],
  );

  return (
    <div className="app" data-runtime-status={status}>
      <MenuBar
        status={status === "ready" ? "Ready" : message}
        statusKind={status}
        state={actionState}
        actions={actions}
      />
      <div className="workspace">
        <aside className="panel" style={{ width: leftPanelWidth }}>
          <PanelSwitcher
            active={activePanel}
            onChange={handleSwitchPanel}
            disabled={status !== "ready" || busy}
          />
          <div className="panel-header">
            {activePanel === "signal"
              ? "Signals"
              : activePanel === "image"
                ? "Images"
                : activePanel === "notebook"
                  ? "Notebooks"
                  : "Macros"}
          </div>
          <div className="panel-body">
            {!isObjectPanel ? (
              <div
                style={{
                  padding: 12,
                  fontSize: 12,
                  color: "var(--text-dim)",
                }}
              >
                {activePanel === "notebook"
                  ? "Notebook cells are shown on the right. Use the Signals or Images tabs to manage workspace objects."
                  : "Macros are managed in the editor on the right."}
              </div>
            ) : (
              <ObjectTree
                tree={tree}
                selectedIds={selectedIds}
                currentId={currentId}
                onSelectionChange={handleSelectionChange}
                onRenameObject={handleRenameObject}
                onRenameGroup={handleRenameGroup}
                onDeleteGroup={handleDeleteGroup}
                onMoveObject={handleMoveObject}
              />
            )}
          </div>
        </aside>
        <Splitter
          side="left"
          value={leftPanelWidth}
          min={180}
          max={500}
          onChange={setLeftPanelWidth}
          ariaLabel="Resize left panel"
        />
        <main className="plot-area">
          {/*
            NotebookPanel is mounted as soon as the runtime is ready and
            kept mounted while switching panels — its in-memory cell
            state (sources, outputs, execution counters) and the kernel
            worker would otherwise be discarded on every tab switch.
            Visibility is controlled with ``hidden`` so the layout
            collapses cleanly when another panel is active.
          */}
          {runtime && (
            <div
              className="nb-panel-host"
              hidden={activePanel !== "notebook"}
              style={{
                display: activePanel === "notebook" ? "flex" : "none",
                flex: "1 1 auto",
                minWidth: 0,
                minHeight: 0,
              }}
            >
              <NotebookPanel
                ref={notebookPanelRef}
                runtime={runtime}
                theme={theme}
                onSetCurrentPanel={(panel) => {
                  if (panel === "signal" || panel === "image") {
                    handleSwitchPanel(panel);
                  }
                }}
                getSelection={() => selectedIds}
                getCurrentPanel={() => objectPanel}
                selectObjects={(ids, panel) => {
                  if (panel === "signal" || panel === "image") {
                    handleSwitchPanel(panel);
                  }
                  setSelectedIds(ids);
                  setCurrentId(ids[0] ?? null);
                }}
                onModelChanged={() => {
                  // Same rationale as MacroPanel: don't yank the user away.
                }}
                onConvertToMacro={(title, code) => {
                  handleSwitchPanel("macro");
                  void macroPanelRef.current?.importMacro(title, code);
                }}
              />
            </div>
          )}
          {runtime && (
            <div
              className="macro-panel-host"
              hidden={activePanel !== "macro"}
              style={{
                display: activePanel === "macro" ? "flex" : "none",
                flex: "1 1 auto",
                minWidth: 0,
                minHeight: 0,
              }}
            >
              <MacroPanel
                ref={macroPanelRef}
                runtime={runtime}
                onSetCurrentPanel={(panel) => {
                  if (panel === "signal" || panel === "image") {
                    handleSwitchPanel(panel);
                  }
                }}
                getSelection={() => selectedIds}
                getCurrentPanel={() => objectPanel}
                selectObjects={(ids, panel) => {
                  if (panel === "signal" || panel === "image") {
                    handleSwitchPanel(panel);
                  }
                  setSelectedIds(ids);
                  setCurrentId(ids[0] ?? null);
                }}
                onModelChanged={() => {
                  // The user is on the Macros panel; don't yank them away
                  // and don't waste a network round-trip refreshing a tree
                  // they can't see.  When they switch back to Signals /
                  // Images, ``handleSwitchPanel`` will refresh.
                }}
                onConvertToNotebook={(title, code) => {
                  handleSwitchPanel("notebook");
                  notebookPanelRef.current?.importMacroAsNotebook(title, code);
                }}
                theme={theme}
              />
            </div>
          )}
          {isObjectPanel && status === "error" && (
            <div
              className="plot-empty"
              style={{ color: "#c4302b", padding: 16, textAlign: "center" }}
            >
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  Failed to initialise Sigima
                </div>
                <div style={{ fontSize: 12 }}>{error}</div>
                <div
                  style={{
                    fontSize: 11,
                    marginTop: 10,
                    color: "var(--text-dim)",
                  }}
                >
                  See the browser console for the full traceback.
                </div>
              </div>
            </div>
          )}
          {isObjectPanel && status === "loading" && !data && !imageData && (
            <div className="plot-empty plot-loading">
              <img
                src={
                  new URL("./assets/DataLab-Splash.svg", import.meta.url).href
                }
                alt="DataLab"
                className="plot-loading-logo"
              />
              <div className="plot-loading-message">{message}</div>
            </div>
          )}
          {isObjectPanel && status === "ready" && !data && !imageData && (
            <div className="plot-empty">
              {activePanel === "signal"
                ? "Create a signal to get started."
                : "Create an image to get started."}
            </div>
          )}
          {activePanel === "signal" && data && (
            <SignalPlot
              data={data}
              oid={currentId}
              annotations={annotations}
              onAnnotationsChange={handleAnnotationsChange}
              roi={roi}
              roiEditMode={roiEditMode}
              onRoiChange={handleRoiChangeFromPlot}
              results={results}
              extraSignals={extraSignals}
            />
          )}
          {activePanel === "image" && imageData && (
            <ImagePlot
              data={imageData}
              roi={imageRoi}
              roiEditMode={imageRoiEditMode}
              onRoiChange={handleImageRoiChangeFromPlot}
              results={results}
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
            />
          )}
        </main>
        {runtime && isObjectPanel && (
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
              refreshNonce={sideRefreshNonce}
              onObjectChanged={handleSideObjectChanged}
              preferredTab={preferredSideTab}
              results={results}
              onClearResults={handleClearResults}
              width={sidePanelWidth}
            />
          </>
        )}
      </div>
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
            )
          }
          onSubmit={handleSubmitParams}
          onCancel={() => setPending(null)}
        />
      )}
      {pendingProfile && runtime && (
        <ProfileDefinitionDialog
          title={pendingProfile.feature.label.replace(/\u2026$/, "")}
          featureId={
            pendingProfile.feature.id.replace(/^image:/, "") as ProfileFeatureId
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
        />
      )}
      {pendingImageGrid && (
        <DataSetDialog
          title="Distribute on a grid"
          payload={pendingImageGrid.schema}
          onSubmit={handleSubmitImageGrid}
          onCancel={() => setPendingImageGrid(null)}
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
        <MetadataDialog
          initial={editingMeta}
          onSubmit={handleSubmitMeta}
          onCancel={() => setEditingMeta(null)}
        />
      )}
      {editingRoi !== null && data && (
        <RoiDialog
          initial={editingRoi}
          xMin={data.x[0] ?? 0}
          xMax={data.x[data.x.length - 1] ?? 1}
          onSubmit={handleSubmitRoi}
          onCancel={() => setEditingRoi(null)}
        />
      )}
      {editingImageRoi !== null && imageData && (
        <ImageRoiDialog
          initial={editingImageRoi}
          xMin={imageData.x0}
          xMax={imageData.x0 + imageData.width * imageData.dx}
          yMin={imageData.y0}
          yMax={imageData.y0 + imageData.height * imageData.dy}
          onSubmit={handleSubmitImageRoi}
          onCancel={() => setEditingImageRoi(null)}
        />
      )}
      {erasingImageRoi !== null && imageData && (
        <ImageRoiDialog
          initial={erasingImageRoi}
          xMin={imageData.x0}
          xMax={imageData.x0 + imageData.width * imageData.dx}
          yMin={imageData.y0}
          yMax={imageData.y0 + imageData.height * imageData.dy}
          onSubmit={handleSubmitErase}
          onCancel={() => setErasingImageRoi(null)}
        />
      )}
      {helpView && (
        <HelpDialog
          view={helpView}
          onClose={() => setHelpView(null)}
          appVersion={import.meta.env.VITE_APP_VERSION}
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
      <DialogBridge />
    </div>
  );
}
