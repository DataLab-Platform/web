/**
 * TextImportWizard — DataLab-Web port of
 * :class:`datalab.widgets.textimport.TextImportWizard` (signal panel only).
 *
 * Four-page wizard mirroring the Qt desktop application:
 *
 *   1. **Source** — clipboard or file picker.
 *   2. **Data preview** — delimiter / decimal / header / dtype etc.
 *      with a live preview table.
 *   3. **Graphical preview** — Plotly chart of all candidate signals
 *      with per-signal include/exclude checkboxes.
 *   4. **Labels** — title / xlabel / ylabel / xunit / yunit shared by
 *      all imported signals.
 *
 * The heavy lifting (parsing, building SignalObj instances) lives in
 * Python ``bootstrap.py`` for parity with the desktop wizard's
 * pandas-based pipeline.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Plot from "react-plotly.js";
import { useSigima } from "../sigima/SigimaContext";
import {
  defaultTextImportParams,
  type TextImportParams,
  type TextImportPreview,
  type TextImportSignal,
} from "../sigima/runtime";

interface Props {
  /** Called with the list of newly created object ids on successful
   *  import. The wizard closes itself before the callback runs. */
  onImport: (oids: string[]) => void;
  onCancel: () => void;
}

type Step = 0 | 1 | 2 | 3;

const STEP_TITLES = [
  "Source",
  "Data preview",
  "Graphical representation",
  "Labels and units",
] as const;

const DTYPES = [
  "float64",
  "float32",
  "int64",
  "int32",
  "int16",
  "uint16",
  "uint8",
] as const;

interface LabelState {
  title: string;
  xlabel: string;
  ylabel: string;
  xunit: string;
  yunit: string;
}

const EMPTY_LABELS: LabelState = {
  title: "",
  xlabel: "",
  ylabel: "",
  xunit: "",
  yunit: "",
};

export function TextImportWizard({ onImport, onCancel }: Props) {
  const { runtime } = useSigima();
  const [step, setStep] = useState<Step>(0);
  // ----- step 1: source -----
  const [sourceKind, setSourceKind] = useState<"file" | "clipboard">("file");
  const [sourceName, setSourceName] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [readError, setReadError] = useState<string | null>(null);
  // ----- step 2: parameters & preview -----
  const [params, setParams] = useState<TextImportParams>(
    defaultTextImportParams,
  );
  const [preview, setPreview] = useState<TextImportPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  // ----- step 3: graphical preview -----
  const [signals, setSignals] = useState<TextImportSignal[]>([]);
  const [included, setIncluded] = useState<boolean[]>([]);
  const [signalsBusy, setSignalsBusy] = useState(false);
  // ----- step 4: labels -----
  const [labels, setLabels] = useState<LabelState>(EMPTY_LABELS);
  // ----- final commit -----
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  // Esc closes the wizard.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  // Refresh the preview table whenever parameters or text change while
  // the user is on the parameters page.
  useEffect(() => {
    if (step !== 1 || !runtime || !text) {
      return;
    }
    let cancelled = false;
    setPreviewBusy(true);
    runtime
      .parseTextImport(text, params, 200)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((err) => {
        if (!cancelled) {
          setPreview({
            headers: [],
            preview_rows: [],
            nrows: 0,
            ncols: 0,
            signal_titles: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, step, text, params]);

  // Build the candidate signal list when entering page 3.
  useEffect(() => {
    if (step !== 2 || !runtime || !text) return;
    let cancelled = false;
    setSignalsBusy(true);
    runtime
      .buildTextImportSignals(text, params)
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setSignals([]);
          setIncluded([]);
          setCommitError(res.error);
        } else {
          setSignals(res.signals);
          setIncluded(res.signals.map(() => true));
          setCommitError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSignals([]);
          setIncluded([]);
          setCommitError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setSignalsBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, step, text, params]);

  // Default the title field with the source name when entering page 4.
  useEffect(() => {
    if (step !== 3) return;
    setLabels((prev) =>
      prev.title
        ? prev
        : { ...prev, title: `Imported from: ${sourceName || "clipboard"}` },
    );
  }, [step, sourceName]);

  // -------------- helpers ---------------------------------------------

  const handlePickFile = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.txt,.dat,.asc,.tsv,.mca,text/plain,text/csv";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setReadError(null);
      try {
        const content = await file.text();
        setText(content);
        setSourceName(file.name);
        // Auto-pick a sensible default delimiter from the file name.
        if (file.name.endsWith(".tsv") || file.name.endsWith(".dat")) {
          setParams((p) => ({ ...p, delimiter: "\t" }));
        } else if (file.name.endsWith(".csv")) {
          setParams((p) => ({ ...p, delimiter: "," }));
        }
      } catch (err) {
        setReadError(err instanceof Error ? err.message : String(err));
        setText("");
        setSourceName("");
      }
    };
    input.click();
  }, []);

  const handleReadClipboard = useCallback(async () => {
    setReadError(null);
    try {
      const content = await navigator.clipboard.readText();
      if (!content) {
        setReadError("Clipboard is empty");
        setText("");
        setSourceName("");
        return;
      }
      setText(content);
      setSourceName("clipboard");
    } catch (err) {
      setReadError(
        err instanceof Error
          ? `Cannot read clipboard: ${err.message}`
          : String(err),
      );
    }
  }, []);

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0:
        return text.length > 0;
      case 1:
        return preview !== null && !preview.error && preview.nrows > 0;
      case 2:
        return included.some(Boolean);
      case 3:
        return true;
      default:
        return false;
    }
  }, [step, text, preview, included]);

  const goPrev = useCallback(() => {
    setCommitError(null);
    setStep((s) => (s > 0 ? ((s - 1) as Step) : s));
  }, []);

  const goNext = useCallback(() => {
    setCommitError(null);
    setStep((s) => (s < 3 ? ((s + 1) as Step) : s));
  }, []);

  const doCommit = useCallback(async () => {
    if (!runtime) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const indices = included
        .map((v, i) => (v ? i : -1))
        .filter((i) => i >= 0);
      const oids = await runtime.commitTextImport(text, params, {
        selectedIndices: indices,
        title: labels.title,
        xlabel: labels.xlabel,
        ylabel: labels.ylabel,
        xunit: labels.xunit,
        yunit: labels.yunit,
      });
      onImport(oids);
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }, [runtime, text, params, labels, included, onImport]);

  // -------------- render ----------------------------------------------

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card import-wizard">
        <h2>DataLab Import Wizard</h2>
        <ol className="import-wizard-steps">
          {STEP_TITLES.map((t, idx) => (
            <li
              key={t}
              className={idx === step ? "active" : idx < step ? "done" : ""}
            >
              <span className="import-wizard-step-num">{idx + 1}</span>
              <span className="import-wizard-step-label">{t}</span>
            </li>
          ))}
        </ol>

        <div className="import-wizard-body">
          {step === 0 && (
            <SourcePage
              kind={sourceKind}
              onKindChange={setSourceKind}
              sourceName={sourceName}
              hasText={text.length > 0}
              onPickFile={handlePickFile}
              onReadClipboard={handleReadClipboard}
              error={readError}
            />
          )}
          {step === 1 && (
            <ParametersPage
              params={params}
              onChange={setParams}
              preview={preview}
              busy={previewBusy}
            />
          )}
          {step === 2 && (
            <GraphicalPage
              signals={signals}
              included={included}
              onIncludedChange={setIncluded}
              busy={signalsBusy}
              error={commitError}
            />
          )}
          {step === 3 && <LabelsPage labels={labels} onChange={setLabels} />}
        </div>

        {commitError && step === 3 && (
          <div className="error">{commitError}</div>
        )}

        <div className="actions import-wizard-actions">
          <button onClick={onCancel} disabled={committing}>
            Cancel
          </button>
          <span style={{ flex: 1 }} />
          <button onClick={goPrev} disabled={step === 0 || committing}>
            ← Back
          </button>
          {step < 3 ? (
            <button onClick={goNext} disabled={!canGoNext}>
              Next →
            </button>
          ) : (
            <button
              onClick={doCommit}
              disabled={!included.some(Boolean) || committing}
            >
              {committing ? "Importing…" : "Finish"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Page 1 — Source
// ---------------------------------------------------------------------
interface SourcePageProps {
  kind: "file" | "clipboard";
  onKindChange: (kind: "file" | "clipboard") => void;
  sourceName: string;
  hasText: boolean;
  onPickFile: () => void;
  onReadClipboard: () => void;
  error: string | null;
}

function SourcePage(p: SourcePageProps) {
  return (
    <div className="import-wizard-page">
      <p className="import-wizard-subtitle">Select the source of the data:</p>
      <div className="import-wizard-source-choice">
        <label>
          <input
            type="radio"
            name="src"
            checked={p.kind === "file"}
            onChange={() => p.onKindChange("file")}
          />{" "}
          File
        </label>
        <label>
          <input
            type="radio"
            name="src"
            checked={p.kind === "clipboard"}
            onChange={() => p.onKindChange("clipboard")}
          />{" "}
          Clipboard
        </label>
      </div>
      <div className="import-wizard-source-action">
        {p.kind === "file" ? (
          <button onClick={p.onPickFile}>Choose file…</button>
        ) : (
          <button onClick={p.onReadClipboard}>Read clipboard</button>
        )}
        {p.sourceName && (
          <span className="import-wizard-source-name">
            Loaded from: <strong>{p.sourceName}</strong>
          </span>
        )}
      </div>
      {p.error && <div className="error">{p.error}</div>}
      {p.hasText && !p.error && (
        <p className="import-wizard-hint">
          Click <em>Next</em> to configure parsing parameters.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Page 2 — Parameters & preview
// ---------------------------------------------------------------------
interface ParametersPageProps {
  params: TextImportParams;
  onChange: (next: TextImportParams) => void;
  preview: TextImportPreview | null;
  busy: boolean;
}

function ParametersPage(p: ParametersPageProps) {
  const update = <K extends keyof TextImportParams>(
    key: K,
    value: TextImportParams[K],
  ) => p.onChange({ ...p.params, [key]: value });

  return (
    <div className="import-wizard-page">
      <p className="import-wizard-subtitle">
        Preview and modify the import settings:
      </p>
      <div className="import-wizard-params">
        <label>
          <span>Delimiter</span>
          <select
            value={p.params.delimiter}
            onChange={(e) => update("delimiter", e.target.value)}
          >
            <option value=",">,</option>
            <option value=";">;</option>
            <option value={"\t"}>Tab</option>
            <option value=" ">Space</option>
          </select>
        </label>
        <label>
          <span>Decimal</span>
          <select
            value={p.params.decimal}
            onChange={(e) => update("decimal", e.target.value)}
          >
            <option value=".">Point</option>
            <option value=",">Comma</option>
          </select>
        </label>
        <label>
          <span>Comment char</span>
          <input
            type="text"
            value={p.params.comment}
            maxLength={3}
            onChange={(e) => update("comment", e.target.value)}
          />
        </label>
        <label>
          <span>Header</span>
          <select
            value={p.params.header}
            onChange={(e) =>
              update("header", e.target.value as TextImportParams["header"])
            }
          >
            <option value="infer">Infer</option>
            <option value="none">None</option>
            <option value="first">First row</option>
          </select>
        </label>
        <label>
          <span>Skip rows</span>
          <input
            type="number"
            min={0}
            value={p.params.skipRows}
            onChange={(e) =>
              update("skipRows", Math.max(0, Number(e.target.value) || 0))
            }
          />
        </label>
        <label>
          <span>Max rows</span>
          <input
            type="number"
            min={1}
            placeholder="∞"
            value={p.params.maxRows ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              update("maxRows", v === "" ? null : Math.max(1, Number(v) || 1));
            }}
          />
        </label>
        <label>
          <span>Data type</span>
          <select
            value={p.params.dtypeStr}
            onChange={(e) => update("dtypeStr", e.target.value)}
          >
            {DTYPES.map((dt) => (
              <option key={dt} value={dt}>
                {dt}
              </option>
            ))}
          </select>
        </label>
        <label className="import-wizard-checkbox">
          <input
            type="checkbox"
            checked={p.params.transpose}
            onChange={(e) => update("transpose", e.target.checked)}
          />
          <span>Transpose</span>
        </label>
        <label className="import-wizard-checkbox">
          <input
            type="checkbox"
            checked={p.params.firstColIsX}
            onChange={(e) => update("firstColIsX", e.target.checked)}
          />
          <span>First column is X</span>
        </label>
      </div>

      <div className="import-wizard-preview">
        {p.busy && <p className="import-wizard-hint">Parsing…</p>}
        {!p.busy && p.preview && p.preview.error && (
          <div className="error">{p.preview.error}</div>
        )}
        {!p.busy && p.preview && !p.preview.error && (
          <>
            <p className="import-wizard-hint">
              {p.preview.nrows} row(s) × {p.preview.ncols} column(s) parsed.
            </p>
            <div className="import-wizard-table-wrap">
              <table className="import-wizard-table">
                <thead>
                  <tr>
                    {p.preview.headers.map((h, i) => (
                      <th key={i}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.preview.preview_rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci}>
                          {typeof cell === "number" ? formatCell(cell) : cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatCell(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  // Compact representation: full precision for small ints, scientific
  // for very large/small magnitudes.
  if (Number.isInteger(v) && Math.abs(v) < 1e9) return String(v);
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return v.toExponential(4);
  return v.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

// ---------------------------------------------------------------------
// Page 3 — Graphical preview
// ---------------------------------------------------------------------
interface GraphicalPageProps {
  signals: TextImportSignal[];
  included: boolean[];
  onIncludedChange: (next: boolean[]) => void;
  busy: boolean;
  error: string | null;
}

function GraphicalPage(p: GraphicalPageProps) {
  const traces = useMemo(
    () =>
      p.signals
        .map((s, i) =>
          p.included[i]
            ? {
                x: s.x,
                y: s.y,
                name: s.title,
                mode: "lines" as const,
                type: "scatter" as const,
              }
            : null,
        )
        .filter(Boolean) as Array<Record<string, unknown>>,
    [p.signals, p.included],
  );
  const allChecked = p.included.every(Boolean);

  return (
    <div className="import-wizard-page">
      <p className="import-wizard-subtitle">
        Unselect the signals that you do not want to import:
      </p>
      {p.busy && <p className="import-wizard-hint">Building signals…</p>}
      {p.error && <div className="error">{p.error}</div>}
      {!p.busy && p.signals.length > 0 && (
        <div className="import-wizard-graphical">
          <div className="import-wizard-signal-list">
            <label>
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(e) =>
                  p.onIncludedChange(p.signals.map(() => e.target.checked))
                }
              />
              <strong>Select all</strong>
            </label>
            <hr />
            {p.signals.map((s, i) => (
              <label key={i}>
                <input
                  type="checkbox"
                  checked={p.included[i] ?? false}
                  onChange={(e) => {
                    const next = [...p.included];
                    next[i] = e.target.checked;
                    p.onIncludedChange(next);
                  }}
                />
                <span>{s.title || `col${i}`}</span>
              </label>
            ))}
          </div>
          <div className="import-wizard-plot">
            <Plot
              data={traces}
              layout={{
                autosize: true,
                margin: { l: 50, r: 10, t: 10, b: 40 },
                showlegend: traces.length > 1,
                legend: { orientation: "h" },
                paper_bgcolor: "transparent",
                plot_bgcolor: "transparent",
                font: { color: "#ddd" },
              }}
              style={{ width: "100%", height: "100%" }}
              useResizeHandler
              config={{ displaylogo: false, responsive: true }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Page 4 — Labels
// ---------------------------------------------------------------------
interface LabelsPageProps {
  labels: LabelState;
  onChange: (next: LabelState) => void;
}

function LabelsPage(p: LabelsPageProps) {
  const update = <K extends keyof LabelState>(key: K, value: LabelState[K]) =>
    p.onChange({ ...p.labels, [key]: value });

  return (
    <div className="import-wizard-page">
      <p className="import-wizard-subtitle">
        Set the labels and units for the imported data.
        <br />
        <em>Leave a field empty to keep the value inferred from the source.</em>
      </p>
      <div className="import-wizard-labels">
        <label>
          <span>Title</span>
          <input
            type="text"
            value={p.labels.title}
            onChange={(e) => update("title", e.target.value)}
          />
        </label>
        <label>
          <span>X label</span>
          <input
            type="text"
            value={p.labels.xlabel}
            onChange={(e) => update("xlabel", e.target.value)}
          />
        </label>
        <label>
          <span>Y label</span>
          <input
            type="text"
            value={p.labels.ylabel}
            onChange={(e) => update("ylabel", e.target.value)}
          />
        </label>
        <label>
          <span>X unit</span>
          <input
            type="text"
            value={p.labels.xunit}
            onChange={(e) => update("xunit", e.target.value)}
          />
        </label>
        <label>
          <span>Y unit</span>
          <input
            type="text"
            value={p.labels.yunit}
            onChange={(e) => update("yunit", e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
