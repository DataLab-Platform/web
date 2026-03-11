import { useCallback, useEffect, useMemo, useState } from "react";
import { useSigima } from "./sigima/SigimaContext";
import type {
  FeatureDescriptor,
  PanelTree,
  SchemaWithValues,
  SignalData,
} from "./sigima/runtime";
import { MenuBar } from "./components/MenuBar";
import {
  buildFeatureActions,
  buildSignalCreationActions,
  buildStaticActions,
} from "./actions/registry";
import { ObjectTree } from "./components/ObjectTree";
import { SignalPlot } from "./components/SignalPlot";
import { DataSetDialog } from "./components/DataSetDialog";
import { OperandPicker } from "./components/OperandPicker";
import { MetadataDialog } from "./components/MetadataDialog";
import { RoiDialog } from "./components/RoiDialog";
import { SidePanel } from "./components/SidePanel";
import type {
  ObjectMeta,
  PlotlyAnnotations,
  SignalCreationType,
  SignalRoiSegment,
} from "./sigima/runtime";

interface PendingFeature {
  feature: FeatureDescriptor;
  sourceIds: string[];
  operandId: string | null;
  schema: SchemaWithValues | null;
}

export default function App() {
  const { runtime, status, message, error } = useSigima();
  const [tree, setTree] = useState<PanelTree | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [data, setData] = useState<SignalData | null>(null);
  const [features, setFeatures] = useState<FeatureDescriptor[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingFeature | null>(null);
  const [pendingOperand, setPendingOperand] = useState<{
    feature: FeatureDescriptor;
    sourceIds: string[];
  } | null>(null);
  const [editingMeta, setEditingMeta] = useState<ObjectMeta | null>(null);
  const [annotations, setAnnotations] = useState<PlotlyAnnotations>({
    shapes: [],
    annotations: [],
  });
  const [roi, setRoi] = useState<SignalRoiSegment[]>([]);
  const [editingRoi, setEditingRoi] = useState<SignalRoiSegment[] | null>(null);
  const [signalTypes, setSignalTypes] = useState<SignalCreationType[]>([]);
  const [sideRefreshNonce, setSideRefreshNonce] = useState(0);
  const [preferredSideTab, setPreferredSideTab] = useState<
    "creation" | "properties"
  >("properties");

  const refresh = useCallback(
    async (preferredCurrentId?: string | null) => {
      if (!runtime) return;
      const newTree = await runtime.getPanelTree("signal");
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
    [runtime],
  );

  useEffect(() => {
    if (status !== "ready" || !runtime) return;
    runtime.listFeatures().then(setFeatures);
    runtime.listSignalCreationTypes().then(setSignalTypes);
    refresh();
  }, [status, runtime, refresh]);

  useEffect(() => {
    if (!runtime || !currentId) {
      setData(null);
      setAnnotations({ shapes: [], annotations: [] });
      setRoi([]);
      return;
    }
    let cancelled = false;
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
    return () => {
      cancelled = true;
    };
  }, [runtime, currentId]);

  const handleSelectionChange = useCallback(
    (ids: string[], current: string | null) => {
      setSelectedIds(ids);
      setCurrentId(current);
    },
    [],
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

  const handleSideObjectChanged = useCallback(
    async (oid: string) => {
      if (!runtime) return;
      // The Creation/Properties form just mutated the object — refresh
      // the plot data and the tree (title / size may have changed).
      try {
        const updated = await runtime.getSignalData(oid);
        setData(updated);
      } catch {
        /* ignore — object may have been deleted */
      }
      await refresh(oid);
    },
    [runtime, refresh],
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
      await runtime.createGroup("signal");
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [runtime, refresh]);

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

  const handleExportCsv = useCallback(async () => {
    if (!runtime || !currentId) return;
    const text = await runtime.exportSignalCsv(currentId);
    const blob = new Blob([text], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(data?.title || "signal").replace(/[^\w.-]+/g, "_")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [runtime, currentId, data]);

  const handleImportCsv = useCallback(async () => {
    if (!runtime) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.txt,text/csv,text/plain";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      try {
        const text = await file.text();
        const stem = file.name.replace(/\.[^.]+$/, "");
        const id = await runtime.importSignalCsv(text, stem);
        await refresh(id);
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }, [runtime, refresh]);

  const handleNewImage = useCallback(async () => {
    if (!runtime) return;
    setBusy(true);
    try {
      // Spike action: skip the dialog and create a default Gaussian image so
      // the abstraction is exercised end-to-end without dragging in a 2D
      // viewer in the MVP.
      const id = await runtime.createImage({
        kind: "gauss",
        title: "Image",
        width: 256,
        height: 256,
        a: 1.0,
        sigma: 50.0,
      });
      await refresh(id);
    } finally {
      setBusy(false);
    }
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

  const actions = useMemo(
    () => [
      ...buildStaticActions({
        onNewGroup: handleNewGroup,
        onDeleteSelection: handleDelete,
        onEditProperties: handleEditProperties,
        onEditRoi: handleEditRoi,
        onSaveProject: handleSaveProject,
        onLoadProject: handleLoadProject,
        onImportCsv: handleImportCsv,
        onExportCsv: handleExportCsv,
        onNewImage: handleNewImage,
      }),
      ...buildSignalCreationActions(signalTypes, handleCreateTyped),
      ...buildFeatureActions(features, handleApplyFeature),
    ],
    [
      features,
      signalTypes,
      handleCreateTyped,
      handleNewGroup,
      handleDelete,
      handleApplyFeature,
      handleEditProperties,
      handleEditRoi,
      handleSaveProject,
      handleLoadProject,
      handleImportCsv,
      handleExportCsv,
      handleNewImage,
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
        <aside className="panel">
          <div className="panel-header">Signals</div>
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
          {status === "loading" && !data && (
            <div className="plot-empty">{message}</div>
          )}
          {status === "ready" && !data && (
            <div className="plot-empty">Create a signal to get started.</div>
          )}
          {data && (
            <SignalPlot
              data={data}
              oid={currentId}
              annotations={annotations}
              onAnnotationsChange={handleAnnotationsChange}
              roi={roi}
            />
          )}
        </main>
        {runtime && (
          <SidePanel
            runtime={runtime}
            currentId={currentId}
            refreshNonce={sideRefreshNonce}
            onObjectChanged={handleSideObjectChanged}
            preferredTab={preferredSideTab}
          />
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
    </div>
  );
}
