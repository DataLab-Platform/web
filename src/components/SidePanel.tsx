/**
 * SidePanel — DataLab-style "Creation parameters" / "Properties" tabs.
 *
 * Mirrors the bottom-left tabbed dock from the desktop app: each tab
 * embeds a :class:`DataSetForm` rendering a guidata DataSet sent over
 * by the Python side.  Edits are staged locally; an explicit "Apply"
 * button (or Ctrl+Enter) commits them to Sigima.  An "unsaved
 * changes" indicator + "Reset" button flag pending edits.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AnalysisResult,
  LastProcessingInfo,
  ObjectStats,
  SchemaWithValues,
  SigimaRuntime,
} from "../runtime/runtime";
import { DataSetForm } from "./DataSetForm";
import { ObjectStatsCard } from "./ObjectStatsCard";
import { MetadataEditor } from "./MetadataEditor";
import { ArrayPreview } from "./ArrayPreview";

type TabId = "creation" | "properties" | "processing" | "results";

interface Props {
  runtime: SigimaRuntime;
  currentId: string | null;
  /** Bumped by the parent whenever the underlying object changed (e.g.
   *  a feature was applied), to force a re-fetch. */
  refreshNonce: number;
  /** Notifies the parent that the current object's data may have
   *  changed so it can refresh the plot / tree. */
  onObjectChanged: (oid: string) => void;
  /** Tab to focus when ``currentId`` becomes non-null.  The parent
   *  bumps it after :meth:`createSignalTyped` to surface the Creation
   *  tab automatically. */
  preferredTab: TabId;
  /** Cached analysis results for the current object (drives the
   *  "Results" tab content). */
  results: AnalysisResult[];
  /** Drop one (or all when ``key`` is null) result(s) from the current
   *  object's metadata. */
  onClearResults: (key: string | null) => void;
  /** Width in pixels assigned by the host (drag-to-resize). */
  width?: number;
}

/** Browser detection for the Document Picture-in-Picture API
 *  (Chromium-based browsers, ``window.documentPictureInPicture``). */
function pipApiSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "documentPictureInPicture" in window &&
    typeof (window as unknown as { documentPictureInPicture: unknown })
      .documentPictureInPicture === "object"
  );
}

/** Copy the parent document's stylesheets into the PiP window so the
 *  detached panel keeps the dark DataLab theme.  We clone ``<style>``
 *  elements directly and re-create ``<link rel="stylesheet">`` ones to
 *  side-step CORS issues. */
function copyStylesheets(target: Document): void {
  for (const node of Array.from(
    document.querySelectorAll('style, link[rel="stylesheet"]'),
  )) {
    const clone = node.cloneNode(true);
    target.head.appendChild(clone);
  }
}

export function SidePanel(props: Props) {
  const {
    runtime,
    currentId,
    refreshNonce,
    onObjectChanged,
    preferredTab,
    results,
    onClearResults,
    width,
  } = props;
  const [active, setActive] = useState<TabId>(preferredTab);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  // Cached "last processing" payload for the current object.  Fetched
  // here (not just inside the Processing tab) so the tab header can be
  // shown / hidden without mounting the panel first.
  const [lastProcessing, setLastProcessing] =
    useState<LastProcessingInfo | null>(null);
  const hasProcessing = lastProcessing !== null;

  useEffect(() => {
    let cancelled = false;
    if (!currentId) {
      setLastProcessing(null);
      return;
    }
    runtime
      .getLastProcessing(currentId)
      .then((p) => {
        if (!cancelled) setLastProcessing(p);
      })
      .catch(() => {
        if (!cancelled) setLastProcessing(null);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, currentId, refreshNonce]);

  // If the active tab disappears (e.g. user selected a fresh object
  // without a processing record), fall back to Properties.
  useEffect(() => {
    if (active === "processing" && !hasProcessing) {
      setActive("properties");
    }
  }, [active, hasProcessing]);

  // Re-honour the parent's preferred tab when it bumps after a Create
  // action (the parent flips ``preferredTab`` to "creation" then).
  useEffect(() => {
    setActive(preferredTab);
  }, [preferredTab, currentId]);

  // Cleanup the PiP window when the side panel unmounts.
  useEffect(() => {
    return () => {
      if (pipWindow && !pipWindow.closed) {
        pipWindow.close();
      }
    };
    // ``pipWindow`` capture is intentional — we only want this to fire
    // on unmount, not whenever the window changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePopOut = useCallback(async () => {
    if (!pipApiSupported()) {
      window.alert(
        "Pop-out requires the Document Picture-in-Picture API " +
          "(Chrome / Edge 116+).",
      );
      return;
    }
    try {
      const win = await (
        window as unknown as {
          documentPictureInPicture: {
            requestWindow: (opts: {
              width: number;
              height: number;
            }) => Promise<Window>;
          };
        }
      ).documentPictureInPicture.requestWindow({
        width: Math.max(width ?? 360, 480),
        height: 720,
      });
      copyStylesheets(win.document);
      win.document.title = "DataLab Web — Object panel";
      win.document.body.style.margin = "0";
      win.document.body.style.background = "var(--panel)";
      win.addEventListener("pagehide", () => setPipWindow(null));
      setPipWindow(win);
    } catch (err) {
      // User dismissed the picker, or browser denied — silently ignore.
      // eslint-disable-next-line no-console
      console.warn("Pop-out failed:", err);
    }
  }, [width]);

  const handleDock = useCallback(() => {
    if (pipWindow && !pipWindow.closed) pipWindow.close();
    setPipWindow(null);
  }, [pipWindow]);

  const popped = pipWindow !== null && !pipWindow.closed;

  const body = (
    <>
      <div className="side-panel-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={active === "creation"}
          className={
            "side-panel-tab" + (active === "creation" ? " active" : "")
          }
          onClick={() => setActive("creation")}
        >
          Creation
        </button>
        <button
          role="tab"
          aria-selected={active === "properties"}
          className={
            "side-panel-tab" + (active === "properties" ? " active" : "")
          }
          onClick={() => setActive("properties")}
        >
          Properties
        </button>
        {hasProcessing && (
          <button
            role="tab"
            aria-selected={active === "processing"}
            className={
              "side-panel-tab" + (active === "processing" ? " active" : "")
            }
            onClick={() => setActive("processing")}
            title={
              lastProcessing
                ? `Edit parameters of: ${lastProcessing.label}`
                : undefined
            }
          >
            Processing
          </button>
        )}
        <button
          role="tab"
          aria-selected={active === "results"}
          className={"side-panel-tab" + (active === "results" ? " active" : "")}
          onClick={() => setActive("results")}
        >
          Results{results.length > 0 ? ` (${results.length})` : ""}
        </button>
        <button
          type="button"
          className="side-panel-popout"
          title={
            popped
              ? "Dock the panel back into the main window"
              : "Open the panel in a separate floating window"
          }
          onClick={popped ? handleDock : handlePopOut}
          aria-label={popped ? "Dock panel" : "Pop out panel"}
        >
          {popped ? "⇲" : "⇱"}
        </button>
      </div>
      <div className="side-panel-body">
        {!currentId && (
          <div className="side-panel-empty">No object selected.</div>
        )}
        {currentId && active === "creation" && (
          <CreationPanel
            runtime={runtime}
            oid={currentId}
            refreshNonce={refreshNonce}
            onApplied={() => onObjectChanged(currentId)}
          />
        )}
        {currentId && active === "properties" && (
          <PropertiesPanel
            runtime={runtime}
            oid={currentId}
            refreshNonce={refreshNonce}
            onApplied={() => onObjectChanged(currentId)}
          />
        )}
        {currentId && active === "processing" && lastProcessing && (
          <ProcessingPanel
            runtime={runtime}
            oid={currentId}
            refreshNonce={refreshNonce}
            info={lastProcessing}
            onApplied={() => onObjectChanged(currentId)}
          />
        )}
        {currentId && active === "results" && (
          <ResultsPanel results={results} onClear={onClearResults} />
        )}
      </div>
    </>
  );

  if (popped && pipWindow) {
    // Render a placeholder in the docked slot so users know where the
    // panel went, and portal the real content into the PiP window.
    return (
      <>
        <aside
          className="side-panel side-panel-popped-placeholder"
          aria-label="Object panel (popped out)"
          style={width !== undefined ? { width } : undefined}
        >
          <div className="side-panel-placeholder">
            <p>Object panel is in a separate window.</p>
            <button
              type="button"
              className="results-clear-all"
              onClick={handleDock}
            >
              Dock back here
            </button>
          </div>
        </aside>
        {createPortal(
          <aside
            className="side-panel side-panel-popped"
            aria-label="Object panel"
          >
            {body}
          </aside>,
          pipWindow.document.body,
        )}
      </>
    );
  }

  return (
    <aside
      className="side-panel"
      aria-label="Object panel"
      style={width !== undefined ? { width } : undefined}
    >
      {body}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Creation tab (NewSignalParam editor)
// ---------------------------------------------------------------------------

interface SubProps {
  runtime: SigimaRuntime;
  oid: string;
  refreshNonce: number;
  onApplied: () => void;
}

function CreationPanel({ runtime, oid, refreshNonce, onApplied }: SubProps) {
  const [payload, setPayload] = useState<
    (SchemaWithValues & { stype: string }) | null
  >(null);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    runtime
      .getCreationParamSchema(oid)
      .then((p) => {
        if (cancelled) return;
        if (!p) {
          setAvailable(false);
          setPayload(null);
        } else {
          setAvailable(true);
          setPayload(p);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, oid, refreshNonce]);

  const apply = useCallback(
    async (values: Record<string, unknown>) => {
      await runtime.updateSignalCreationParams(oid, values);
      onApplied();
    },
    [runtime, oid, onApplied],
  );

  if (loading) return <div className="side-panel-info">Loading…</div>;
  if (!available) {
    return (
      <div className="side-panel-info">
        This object has no editable creation parameters (it was loaded from a
        file or created via a processing step).
      </div>
    );
  }
  if (!payload) return null;
  return (
    <EditableForm
      key={`creation:${oid}:${refreshNonce}`}
      schema={payload.schema}
      values={payload.values}
      onApply={apply}
      initialError={error}
    />
  );
}

// ---------------------------------------------------------------------------
// Properties tab (full SignalObj DataSet editor)
// ---------------------------------------------------------------------------

function PropertiesPanel({ runtime, oid, refreshNonce, onApplied }: SubProps) {
  const [payload, setPayload] = useState<SchemaWithValues | null>(null);
  const [stats, setStats] = useState<ObjectStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    runtime
      .getObjectPropertySchema(oid)
      .then((p) => {
        if (!cancelled) setPayload(p);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, oid, refreshNonce]);

  useEffect(() => {
    let cancelled = false;
    setStatsError(null);
    runtime
      .getObjectStats(oid)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((err) => {
        if (!cancelled)
          setStatsError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, oid, refreshNonce]);

  const apply = useCallback(
    async (values: Record<string, unknown>) => {
      await runtime.setObjectPropertyValues(oid, values);
      onApplied();
    },
    [runtime, oid, onApplied],
  );

  // Hide the raw array / dict fields from the generic DataSet form:
  // dedicated rich widgets (StatsCard, MetadataEditor) cover them
  // outside the form, and the CSV-string fallback is unusable for
  // 1000-point arrays.
  const filteredSchema = useMemo(
    () => (payload ? hideArrayAndDictFields(payload.schema) : null),
    [payload],
  );

  if (loading) return <div className="side-panel-info">Loading…</div>;
  if (error && !payload) return <div className="error">{error}</div>;
  if (!payload || !filteredSchema) return null;
  return (
    <div className="properties-panel">
      <ObjectStatsCard stats={stats} error={statsError} />
      {stats && (
        <ArrayPreview
          runtime={runtime}
          oid={oid}
          stats={stats}
          refreshNonce={refreshNonce}
        />
      )}
      <EditableForm
        key={`properties:${oid}:${refreshNonce}`}
        schema={filteredSchema}
        values={payload.values}
        onApply={apply}
        initialError={error}
      />
      <MetadataEditor
        runtime={runtime}
        oid={oid}
        refreshNonce={refreshNonce}
        onChanged={() => onApplied()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Processing tab — re-edit the parameters of the last applied feature
// and re-run it on the same source(s), replacing the current object's
// data in place.  Mirrors DataLab desktop's "Processing" dock tab.
// ---------------------------------------------------------------------------

interface ProcessingPanelProps extends SubProps {
  info: LastProcessingInfo;
}

function ProcessingPanel({
  runtime,
  oid,
  refreshNonce,
  info,
  onApplied,
}: ProcessingPanelProps) {
  const apply = useCallback(
    async (values: Record<string, unknown>) => {
      await runtime.reapplyLastProcessing(oid, values);
      onApplied();
    },
    [runtime, oid, onApplied],
  );

  // Parameterless features: nothing to edit, just expose a "Re-apply"
  // button so the user can still trigger the recomputation.
  if (!info.has_params || !info.schema) {
    return (
      <div className="processing-panel">
        <ProcessingHeader info={info} />
        <div className="side-panel-info">
          This processing has no parameters.
        </div>
        <div className="editable-form-footer">
          <span className="editable-form-status">&nbsp;</span>
          <div className="editable-form-buttons">
            <button
              type="button"
              className="editable-form-apply"
              onClick={() => void apply({})}
              title="Re-apply this processing"
            >
              Re-apply
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="processing-panel">
      <ProcessingHeader info={info} />
      <EditableForm
        key={`processing:${oid}:${refreshNonce}`}
        schema={info.schema}
        values={info.values ?? {}}
        onApply={apply}
      />
    </div>
  );
}

function ProcessingHeader({ info }: { info: LastProcessingInfo }) {
  return (
    <div className="processing-panel-header">
      <div className="processing-panel-title">{info.label}</div>
      {info.menu_path && (
        <div className="processing-panel-path">{info.menu_path}</div>
      )}
    </div>
  );
}

/**
 * Return a shallow-cloned schema with every ``float_array`` /
 * ``dict`` property tagged ``x-guidata-hide: true`` so the generic
 * :class:`DataSetForm` skips them.  The Properties panel renders
 * dedicated rich widgets for those instead.
 */
function hideArrayAndDictFields(
  schema: SchemaWithValues["schema"],
): SchemaWithValues["schema"] {
  const props = schema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!props) return schema;
  const newProps: Record<string, Record<string, unknown>> = {};
  for (const [name, prop] of Object.entries(props)) {
    const kind = prop["x-guidata-kind"];
    if (kind === "float_array" || kind === "dict") {
      newProps[name] = { ...prop, "x-guidata-hide": true };
    } else {
      newProps[name] = prop;
    }
  }
  return { ...schema, properties: newProps };
}

// ---------------------------------------------------------------------------
// EditableForm — shared wrapper adding "Apply" / "Reset" + dirty
// indicator on top of :class:`DataSetForm`.  Mirrors guidata's
// "DataSetEditDialog" Apply/Reset behaviour without modal blocking.
// ---------------------------------------------------------------------------

interface EditableFormProps {
  schema: SchemaWithValues["schema"];
  values: Record<string, unknown>;
  onApply: (values: Record<string, unknown>) => Promise<void>;
  initialError?: string | null;
}

function EditableForm({
  schema,
  values,
  onApply,
  initialError = null,
}: EditableFormProps) {
  // Snapshot of the values that are currently committed in Python.
  // Anything different from this counts as "unsaved".
  const [appliedValues, setAppliedValues] = useState(values);
  const [draft, setDraft] = useState(values);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLDivElement | null>(null);

  const dirty = useMemo(
    () => !valuesEqual(draft, appliedValues),
    [draft, appliedValues],
  );

  const handleApply = useCallback(async () => {
    if (!dirty || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onApply(draft);
      setAppliedValues(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [dirty, busy, draft, onApply]);

  const handleReset = useCallback(() => {
    setDraft(appliedValues);
    setError(null);
  }, [appliedValues]);

  // Ctrl+Enter / Cmd+Enter inside the form triggers Apply.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void handleApply();
      }
    },
    [handleApply],
  );

  return (
    <div className="side-panel-form" ref={formRef} onKeyDown={handleKeyDown}>
      {error && <div className="error">{error}</div>}
      <DataSetForm schema={schema} values={draft} onChange={setDraft} />
      <div
        className={
          "editable-form-footer" + (dirty ? " editable-form-dirty" : "")
        }
      >
        <span className="editable-form-status" aria-live="polite">
          {busy
            ? "Applying…"
            : dirty
              ? "● Unsaved changes"
              : "All changes applied"}
        </span>
        <div className="editable-form-buttons">
          <button
            type="button"
            className="editable-form-reset"
            onClick={handleReset}
            disabled={!dirty || busy}
            title="Discard unapplied changes"
          >
            Reset
          </button>
          <button
            type="button"
            className="editable-form-apply"
            onClick={() => void handleApply()}
            disabled={!dirty || busy}
            title="Apply changes (Ctrl+Enter)"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

/** Cheap deep-equality for plain JSON values — schema values are
 *  always serialisable so :func:`JSON.stringify` is sufficient and
 *  avoids pulling a third-party comparator. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Results tab (TableResult / GeometryResult viewer)
// ---------------------------------------------------------------------------

interface ResultsPanelProps {
  results: AnalysisResult[];
  onClear: (key: string | null) => void;
}

function ResultsPanel({ results, onClear }: ResultsPanelProps) {
  if (results.length === 0) {
    return (
      <div className="side-panel-empty">
        No analysis result yet. Use the <em>Analysis</em> menu to compute one.
      </div>
    );
  }
  return (
    <div className="results-panel">
      <div className="results-panel-toolbar">
        <button
          className="results-clear-all"
          type="button"
          onClick={() => onClear(null)}
          title="Remove every analysis result from this signal"
        >
          Clear all results
        </button>
      </div>
      {results.map((r) => (
        <ResultCard
          key={r.metadata_key}
          result={r}
          onRemove={() => onClear(r.metadata_key)}
        />
      ))}
    </div>
  );
}

function ResultCard({
  result,
  onRemove,
}: {
  result: AnalysisResult;
  onRemove: () => void;
}) {
  return (
    <div className="result-card">
      <div className="result-card-header">
        <span className="result-card-title">{result.title}</span>
        <button
          type="button"
          className="result-card-remove"
          onClick={onRemove}
          title="Remove this result"
          aria-label="Remove this result"
        >
          ×
        </button>
      </div>
      <table className="result-card-table">
        <thead>
          <tr>
            {result.category === "table" && result.roi_indices && <th>ROI</th>}
            {result.headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.category === "table"
            ? result.data.map((row, ri) => (
                <tr key={ri}>
                  {result.roi_indices && (
                    <td>
                      {result.roi_indices[ri] === -1
                        ? "—"
                        : result.roi_indices[ri]}
                    </td>
                  )}
                  {row.map((cell, ci) => (
                    <td key={ci}>{formatCell(cell)}</td>
                  ))}
                </tr>
              ))
            : result.coords.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{formatCell(cell)}</td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(v: number | string | null): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e4)) return v.toExponential(3);
  return Number(v.toPrecision(5)).toString();
}
