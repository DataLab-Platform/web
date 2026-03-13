/**
 * SidePanel — DataLab-style "Creation parameters" / "Properties" tabs.
 *
 * Mirrors the bottom-left tabbed dock from the desktop app: each tab
 * embeds a :class:`DataSetForm` rendering a guidata DataSet sent over
 * by the Python side.  Edits are auto-applied with a short debounce so
 * the user gets the same live-update experience as in the Qt UI.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnalysisResult,
  SchemaWithValues,
  SigimaRuntime,
} from "../sigima/runtime";
import { DataSetForm } from "./DataSetForm";

type TabId = "creation" | "properties" | "results";

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
}

const APPLY_DEBOUNCE_MS = 250;

export function SidePanel(props: Props) {
  const {
    runtime,
    currentId,
    refreshNonce,
    onObjectChanged,
    preferredTab,
    results,
    onClearResults,
  } = props;
  const [active, setActive] = useState<TabId>(preferredTab);

  // Re-honour the parent's preferred tab when it bumps after a Create
  // action (the parent flips ``preferredTab`` to "creation" then).
  useEffect(() => {
    setActive(preferredTab);
  }, [preferredTab, currentId]);

  return (
    <aside className="side-panel" aria-label="Object panel">
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
        <button
          role="tab"
          aria-selected={active === "results"}
          className={
            "side-panel-tab" + (active === "results" ? " active" : "")
          }
          onClick={() => setActive("results")}
        >
          Results{results.length > 0 ? ` (${results.length})` : ""}
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
        {currentId && active === "results" && (
          <ResultsPanel results={results} onClear={onClearResults} />
        )}
      </div>
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
  const timer = useRef<number | null>(null);

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
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [runtime, oid, refreshNonce]);

  const apply = useCallback(
    async (values: Record<string, unknown>) => {
      try {
        await runtime.updateSignalCreationParams(oid, values);
        onApplied();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [runtime, oid, onApplied],
  );

  const handleChange = useCallback(
    (values: Record<string, unknown>) => {
      if (!payload) return;
      setPayload({ ...payload, values });
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(
        () => apply(values),
        APPLY_DEBOUNCE_MS,
      );
    },
    [payload, apply],
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
    <div className="side-panel-form">
      {error && <div className="error">{error}</div>}
      <DataSetForm
        schema={payload.schema}
        values={payload.values}
        onChange={handleChange}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties tab (full SignalObj DataSet editor)
// ---------------------------------------------------------------------------

function PropertiesPanel({ runtime, oid, refreshNonce, onApplied }: SubProps) {
  const [payload, setPayload] = useState<SchemaWithValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

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
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [runtime, oid, refreshNonce]);

  const apply = useCallback(
    async (values: Record<string, unknown>) => {
      try {
        await runtime.setObjectPropertyValues(oid, values);
        onApplied();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [runtime, oid, onApplied],
  );

  const handleChange = useCallback(
    (values: Record<string, unknown>) => {
      if (!payload) return;
      setPayload({ ...payload, values });
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(
        () => apply(values),
        APPLY_DEBOUNCE_MS,
      );
    },
    [payload, apply],
  );

  if (loading) return <div className="side-panel-info">Loading…</div>;
  if (error) return <div className="error">{error}</div>;
  if (!payload) return null;
  return (
    <div className="side-panel-form">
      <DataSetForm
        schema={payload.schema}
        values={payload.values}
        onChange={handleChange}
      />
    </div>
  );
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
            {result.category === "table" && result.roi_indices && (
              <th>ROI</th>
            )}
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
