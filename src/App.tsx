import { useCallback, useEffect, useState } from "react";
import { useSigima } from "./sigima/SigimaContext";
import type {
  ProcessingDescriptor,
  SchemaWithValues,
  SignalData,
  SignalMeta,
} from "./sigima/runtime";
import { MenuBar } from "./components/MenuBar";
import { SignalList } from "./components/SignalList";
import { SignalPlot } from "./components/SignalPlot";
import { NewSignalDialog } from "./components/NewSignalDialog";
import { DataSetDialog } from "./components/DataSetDialog";
import type { SignalCreationParams } from "./sigima/runtime";

export default function App() {
  const { runtime, status, message, error } = useSigima();
  const [signals, setSignals] = useState<SignalMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [data, setData] = useState<SignalData | null>(null);
  const [processings, setProcessings] = useState<ProcessingDescriptor[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingProcessing, setPendingProcessing] = useState<{
    id: string;
    label: string;
    payload: SchemaWithValues;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!runtime) return;
    const list = await runtime.listSignals();
    setSignals(list);
    if (list.length === 0) {
      setSelectedId(null);
      setData(null);
    } else if (!selectedId || !list.some((s) => s.id === selectedId)) {
      setSelectedId(list[0].id);
    }
  }, [runtime, selectedId]);

  useEffect(() => {
    if (status !== "ready" || !runtime) return;
    runtime.listProcessings().then(setProcessings);
    refresh();
  }, [status, runtime, refresh]);

  useEffect(() => {
    if (!runtime || !selectedId) {
      setData(null);
      return;
    }
    let cancelled = false;
    runtime.getSignalData(selectedId).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, selectedId]);

  const handleCreate = useCallback(
    async (params: SignalCreationParams) => {
      if (!runtime) return;
      setBusy(true);
      try {
        const id = await runtime.createSignal(params);
        await refresh();
        setSelectedId(id);
      } finally {
        setBusy(false);
        setShowNew(false);
      }
    },
    [runtime, refresh],
  );

  const handleApply = useCallback(
    async (processingId: string) => {
      if (!runtime || !selectedId) return;
      const descriptor = processings.find((p) => p.id === processingId);
      if (descriptor?.has_params) {
        const payload = await runtime.getProcessingSchema(processingId);
        if (payload) {
          setPendingProcessing({
            id: processingId,
            label: descriptor.label.replace(/\u2026$/, ""),
            payload,
          });
          return;
        }
      }
      setBusy(true);
      try {
        const newId = await runtime.applyProcessing(selectedId, processingId);
        await refresh();
        setSelectedId(newId);
      } finally {
        setBusy(false);
      }
    },
    [runtime, selectedId, processings, refresh],
  );

  const handleSubmitProcessing = useCallback(
    async (values: Record<string, unknown>) => {
      if (!runtime || !selectedId || !pendingProcessing) return;
      setBusy(true);
      try {
        const newId = await runtime.applyProcessing(
          selectedId,
          pendingProcessing.id,
          values,
        );
        await refresh();
        setSelectedId(newId);
        setPendingProcessing(null);
      } finally {
        setBusy(false);
      }
    },
    [runtime, selectedId, pendingProcessing, refresh],
  );

  const handleDelete = useCallback(async () => {
    if (!runtime || !selectedId) return;
    setBusy(true);
    try {
      await runtime.deleteSignal(selectedId);
      setSelectedId(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [runtime, selectedId, refresh]);

  return (
    <div className="app">
      <MenuBar
        status={status === "ready" ? "Ready" : message}
        statusKind={status}
        canAct={status === "ready" && !busy}
        canDelete={!!selectedId}
        canProcess={!!selectedId}
        processings={processings}
        onNewSignal={() => setShowNew(true)}
        onApplyProcessing={handleApply}
        onDeleteSignal={handleDelete}
      />
      <div className="workspace">
        <aside className="panel">
          <div className="panel-header">Signals</div>
          <div className="panel-body">
            <SignalList
              signals={signals}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        </aside>
        <main className="plot-area">
          {status === "error" && (
            <div className="plot-empty" style={{ color: "#c4302b", padding: 16, textAlign: "center" }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  Failed to initialise Sigima
                </div>
                <div style={{ fontSize: 12 }}>{error}</div>
                <div style={{ fontSize: 11, marginTop: 10, color: "var(--text-dim)" }}>
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
          {data && <SignalPlot data={data} />}
        </main>
      </div>
      {showNew && (
        <NewSignalDialog
          onCreate={handleCreate}
          onCancel={() => setShowNew(false)}
        />
      )}
      {pendingProcessing && runtime && (
        <DataSetDialog
          title={pendingProcessing.label}
          payload={pendingProcessing.payload}
          resolveChoices={(itemName, currentValues) =>
            runtime.resolveProcessingChoices(
              pendingProcessing.id,
              itemName,
              currentValues,
            )
          }
          onSubmit={handleSubmitProcessing}
          onCancel={() => setPendingProcessing(null)}
        />
      )}
    </div>
  );
}
