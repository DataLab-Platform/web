import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSigima } from "./sigima/SigimaContext";
import type {
  FeatureDescriptor,
  H5BrowserFile,
  ImageData,
  PanelTree,
  PluginMenuAction,
  SchemaWithValues,
  SignalData,
} from "./sigima/runtime";
import { MenuBar } from "./components/MenuBar";
import {
  buildFeatureActions,
  buildHelpActions,
  buildImageAnalysisActions,
  buildImageCreationActions,
  buildImageRoiActions,
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
import { OperandPicker } from "./components/OperandPicker";
import { HelpDialog, type HelpView } from "./components/HelpDialog";
import { DialogBridge } from "./components/DialogBridge";
import { PluginManagerDialog } from "./components/PluginManagerDialog";
import { MetadataDialog } from "./components/MetadataDialog";
import { RoiDialog } from "./components/RoiDialog";
import { ImageRoiDialog } from "./components/ImageRoiDialog";
import { H5BrowserDialog } from "./components/H5BrowserDialog";
import { SidePanel } from "./components/SidePanel";
import { Splitter } from "./components/Splitter";
import type {
  AnalysisResult,
  ImageCreationType,
  ImageRoiSegment,
  ObjectMeta,
  PlotlyAnnotations,
  SignalAnalysisDescriptor,
  SignalCreationType,
  SignalRoiSegment,
} from "./sigima/runtime";

interface PendingFeature {
  feature: FeatureDescriptor;
  sourceIds: string[];
  operandId: string | null;
  schema: SchemaWithValues | null;
}

/** Pending parametric analysis waiting for the user's parameter input. */
interface PendingAnalysis {
  funcId: string;
  label: string;
  schema: SchemaWithValues;
}

/** Persist a numeric layout dimension to localStorage so it survives a
 *  page reload. */
function usePersistedSize(key: string, defaultValue: number): [
  number,
  (next: number) => void,
] {
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
  const { runtime, status, message, error } = useSigima();
  const [activePanel, setActivePanel] = useState<PanelKind>("signal");
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
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [features, setFeatures] = useState<FeatureDescriptor[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingFeature | null>(null);
  const [pendingOperand, setPendingOperand] = useState<{
    feature: FeatureDescriptor;
    sourceIds: string[];
  } | null>(null);
  const [editingMeta, setEditingMeta] = useState<ObjectMeta | null>(null);
  const [helpView, setHelpView] = useState<HelpView | null>(null);
  const [h5BrowserFiles, setH5BrowserFiles] = useState<H5BrowserFile[] | null>(
    null,
  );
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
  const [editingImageRoi, setEditingImageRoi] = useState<
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
  const [preferredSideTab, setPreferredSideTab] = useState<
    "creation" | "properties" | "results"
  >("properties");

  const refresh = useCallback(
    async (preferredCurrentId?: string | null) => {
      if (!runtime) return;
      const newTree = await runtime.getPanelTree(activePanel);
      setTree(newTree);
      const allIds: string[] = [];
      for (const g of newTree.groups) for (const o of g.objects) allIds.push(o.id);
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

  useEffect(() => {
    if (status !== "ready" || !runtime) return;
    runtime.listFeatures().then(setFeatures);
    runtime.listSignalCreationTypes().then(setSignalTypes);
    runtime.listImageCreationTypes().then(setImageTypes);
    runtime.listSignalAnalysis().then(setAnalysisEntries);
    runtime.listImageAnalysis().then(setImageAnalysisEntries);
    runtime.listPluginMenuActions().then(setPluginActions);
    refresh();
  }, [status, runtime, refresh]);

  useEffect(() => {
    if (!runtime || !currentId) {
      setData(null);
      setImageData(null);
      setAnnotations({ shapes: [], annotations: [] });
      setRoi([]);
      setImageRoi([]);
      setResults([]);
      return;
    }
    let cancelled = false;
    if (activePanel === "image") {
      // Image panel: viewer + ROI + analysis results.
      setData(null);
      setAnnotations({ shapes: [], annotations: [] });
      setRoi([]);
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
  }, [runtime, currentId, activePanel]);

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
        await refresh(newIds[newIds.length - 1] ?? null);
      } finally {
        setBusy(false);
      }
    },
    [runtime, refresh],
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
    [runtime, currentId, analysisEntries, imageAnalysisEntries, activePanel, runAnalysis],
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
      await runtime.createGroup(activePanel);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [runtime, refresh, activePanel]);

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
    const x0 =
      imageData.x0 + (imageData.width * imageData.dx) / 2 - sx / 2;
    const y0 =
      imageData.y0 + (imageData.height * imageData.dy) / 2 - sy / 2;
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
      Math.min(imageData.width * imageData.dx, imageData.height * imageData.dy) /
        4 || 1;
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

  const handleSaveProject = useCallback(async () => {
    if (!runtime) return;
    const text = await runtime.saveProject();
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "project.dlw";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [runtime]);

  const handleSaveWorkspaceHdf5 = useCallback(async () => {
    if (!runtime) return;
    setBusy(true);
    try {
      const bytes = await runtime.saveWorkspaceHdf5();
      const blob = new Blob([bytes], { type: "application/x-hdf" });
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

  const handleLoadProject = useCallback(async () => {
    if (!runtime) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".dlw,application/json,.json,.txt";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      try {
        const text = await file.text();
        await runtime.loadProject(text);
        setSelectedIds([]);
        setCurrentId(null);
        await refresh(null);
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }, [runtime, refresh]);

  const handleSaveFile = useCallback(async () => {
    if (!runtime || !currentId) return;
    // Default to CSV for backward-compat with the previous "Export CSV…"
    // action; users can pick another extension by editing the filename
    // before the download dialog is committed by the browser.
    const formats = await runtime.listSignalIoFormats();
    const writeExts = formats.all_write_extensions;
    const stem = (data?.title || "signal").replace(/[^\w.-]+/g, "_");
    // Browsers can't really show an extension picker on a synthetic <a>
    // download; we offer a one-line prompt with the catalog of supported
    // extensions for parity with DataLab's "Save signal…" dialog.
    const ext = window.prompt(
      `File extension (one of: ${writeExts.join(", ")})`,
      "csv",
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
    const bytes = await runtime.saveSignalToBytes(currentId, filename);
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [runtime, currentId, data]);

  const handleOpenFile = useCallback(async () => {
    if (!runtime) return;
    const formats = await runtime.listSignalIoFormats();
    const accept = formats.all_read_extensions
      .map((e) => `.${e}`)
      .join(",");
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
          const ids = await runtime.openSignalFromBytes(file.name, buf);
          if (ids.length > 0) lastId = ids[ids.length - 1];
        }
        await refresh(lastId);
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }, [runtime, refresh]);

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
        onSaveProject: handleSaveProject,
        onLoadProject: handleLoadProject,
        onOpenFile: handleOpenFile,
        onSaveFile: handleSaveFile,
        onOpenWorkspaceHdf5: handleOpenWorkspaceHdf5,
        onSaveWorkspaceHdf5: handleSaveWorkspaceHdf5,
        onImportHdf5: handleImportHdf5,
      }),
      ...buildHelpActions({
        onShowAbout: () => setHelpView("about"),
        onShowShortcuts: () => setHelpView("shortcuts"),
        onShowConsole: () => setHelpView("console"),
      }),
      ...(activePanel === "signal"
        ? buildSignalCreationActions(signalTypes, handleCreateTyped)
        : buildImageCreationActions(imageTypes, handleCreateImageTyped)),
      ...buildFeatureActions(visibleFeatures, handleApplyFeature),
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
        : buildImageRoiActions(imageRoi, {
            onAddRectangle: handleImageAddRectangle,
            onAddCircle: handleImageAddCircle,
            onEditNumerically: handleImageEditRoi,
            onExtractEach: handleImageRoiExtractEach,
            onExtractMerged: handleImageRoiExtractMerged,
            onRemoveAt: handleImageRoiRemoveAt,
            onRemoveAll: handleImageRoiRemoveAll,
          })),
      ...buildPluginActions(pluginActions, activePanel, {
        onTrigger: handleTriggerPluginAction,
        onOpenManager: () => setPluginManagerOpen(true),
        onReloadAll: handleReloadPlugins,
      }),
    ],
    [
      activePanel,
      visibleFeatures,
      signalTypes,
      imageTypes,
      analysisEntries,
      imageAnalysisEntries,
      roi,
      roiEditMode,
      imageRoi,
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
      handleImageEditRoi,
      handleImageRoiExtractEach,
      handleImageRoiExtractMerged,
      handleImageRoiRemoveAt,
      handleImageRoiRemoveAll,
      handleSaveProject,
      handleLoadProject,
      handleOpenFile,
      handleSaveFile,
      handleOpenWorkspaceHdf5,
      handleSaveWorkspaceHdf5,
      handleImportHdf5,
      pluginActions,
      handleTriggerPluginAction,
      handleReloadPlugins,
    ],
  );

  return (
    <div className="app">
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
            {activePanel === "signal" ? "Signals" : "Images"}
          </div>
          <div className="panel-body">
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
          {status === "error" && (
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
          {status === "loading" && !data && !imageData && (
            <div className="plot-empty">{message}</div>
          )}
          {status === "ready" && !data && !imageData && (
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
            />
          )}
          {activePanel === "image" && imageData && (
            <ImagePlot data={imageData} roi={imageRoi} results={results} />
          )}
        </main>
        {runtime && (
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
      {pendingAnalysis && (
        <DataSetDialog
          title={pendingAnalysis.label}
          payload={pendingAnalysis.schema}
          onSubmit={handleSubmitAnalysisParams}
          onCancel={() => setPendingAnalysis(null)}
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
      {helpView && (
        <HelpDialog view={helpView} onClose={() => setHelpView(null)} />
      )}
      {h5BrowserFiles !== null && (
        <H5BrowserDialog
          initial={h5BrowserFiles}
          onImport={handleH5BrowserImport}
          onCancel={() => setH5BrowserFiles(null)}
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
