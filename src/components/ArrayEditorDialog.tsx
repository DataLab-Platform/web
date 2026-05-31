/**
 * ArrayEditorDialog — graphical spreadsheet editor for numeric arrays.
 *
 * Browser-native counterpart to guidata's Qt ``ArrayEditor`` widget,
 * used to edit the value of a ``FloatArrayItem`` inside an
 * auto-generated DataSet form. Scope (v1): 1-D and 2-D numeric arrays.
 * Out of scope: 3-D slicing, masked / record arrays, complex dtypes.
 *
 * The dialog keeps a string-based ``draft`` matrix as its source of
 * truth so that partial input (``-``, ``1.``, …) survives keystrokes,
 * then parses it back to numbers on submit. 1-D arrays are displayed as
 * a single column and flattened again on output; the ``transpose`` flag
 * (display-only, like guidata) swaps the visible axes and is undone
 * before producing the value.
 */

import { useCallback, useMemo, useState } from "react";
import { t } from "../i18n/translate";

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export type Matrix = number[][];

export interface NormalizedArray {
  matrix: Matrix;
  /** True when the source value was a flat 1-D array (``number[]``). */
  is1D: boolean;
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

/** Coerce an arbitrary bridge value into a 2-D matrix plus a flag
 *  recording whether the original was 1-D (so we can flatten on output).
 *  A 1-D array becomes a column vector (``n×1``). */
export function normalizeToMatrix(value: unknown): NormalizedArray {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { matrix: [], is1D: true };
    }
    if (Array.isArray(value[0])) {
      const matrix = (value as unknown[][]).map((row) =>
        (Array.isArray(row) ? row : [row]).map(toNumber),
      );
      return { matrix, is1D: false };
    }
    return {
      matrix: (value as unknown[]).map((c) => [toNumber(c)]),
      is1D: true,
    };
  }
  return { matrix: [], is1D: true };
}

/** Convert an edited matrix back to the bridge representation, flattening
 *  to a flat array when the source value was 1-D. */
export function matrixToValue(
  matrix: Matrix,
  is1D: boolean,
): number[] | number[][] {
  if (is1D) {
    return matrix.map((row) => row[0] ?? 0);
  }
  return matrix.map((row) => row.slice());
}

/** Parse clipboard text (TSV or CSV) into a numeric matrix. Tab-separated
 *  rows win when a tab is present (Excel / pandas default), else comma. */
export function parseClipboardMatrix(text: string): Matrix {
  const rows = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((r) => r.trim().length > 0);
  return rows.map((row) => {
    const sep = row.includes("\t") ? "\t" : ",";
    return row.split(sep).map((c) => toNumber(c.trim()));
  });
}

/** Format a number for read-only display using a printf-style spec
 *  (``%.3f``, ``%g``, ``%e``, ``%d``). Falls back to the default string
 *  form when the spec is missing or unrecognised. */
export function formatCell(value: number, format?: string): string {
  if (!Number.isFinite(value)) return String(value);
  if (!format) return String(value);
  const m = /%[-+ 0]*\d*(?:\.(\d+))?([fgeEdG])/.exec(format);
  if (!m) return String(value);
  const precision = m[1] !== undefined ? parseInt(m[1], 10) : undefined;
  switch (m[2]) {
    case "d":
      return String(Math.round(value));
    case "e":
      return value.toExponential(precision ?? 6);
    case "E":
      return value.toExponential(precision ?? 6).toUpperCase();
    case "f":
      return value.toFixed(precision ?? 6);
    case "g":
    case "G":
      return parseFloat(value.toPrecision(precision ?? 6)).toString();
    default:
      return String(value);
  }
}

function numToDraft(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

function transposeStr(matrix: string[][]): string[][] {
  if (matrix.length === 0) return [];
  const rows = matrix.length;
  const cols = matrix[0].length;
  const out: string[][] = [];
  for (let c = 0; c < cols; c += 1) {
    const row: string[] = [];
    for (let r = 0; r < rows; r += 1) {
      row.push(matrix[r][c] ?? "");
    }
    out.push(row);
  }
  return out;
}

function draftToMatrix(draft: string[][]): Matrix {
  return draft.map((row) => row.map(toNumber));
}

function draftToTsv(draft: string[][]): string {
  return draft.map((row) => row.join("\t")).join("\n");
}

/** Hard cap on the number of editable cells; beyond this the grid is
 *  replaced by a notice (no virtualisation in v1). */
export const MAX_EDITABLE_CELLS = 10000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  value: unknown;
  format?: string;
  transpose?: boolean;
  variableSize?: boolean;
  readOnly?: boolean;
  onSubmit: (value: number[] | number[][]) => void;
  onCancel: () => void;
}

export function ArrayEditorDialog(props: Props) {
  const {
    value,
    format,
    transpose,
    variableSize,
    readOnly,
    onSubmit,
    onCancel,
  } = props;

  const init = useMemo(() => {
    const { matrix, is1D } = normalizeToMatrix(value);
    let draft = matrix.map((row) => row.map(numToDraft));
    if (transpose && !is1D) draft = transposeStr(draft);
    return { draft, is1D };
  }, [value, transpose]);

  const [is1D] = useState(init.is1D);
  const [draft, setDraft] = useState<string[][]>(init.draft);
  const [error, setError] = useState<string | null>(null);

  const rows = draft.length;
  const cols = rows > 0 ? draft[0].length : 0;
  const cellCount = rows * cols;
  const tooLarge = cellCount > MAX_EDITABLE_CELLS;
  // A 1-D array is a column vector: only row operations make sense.
  const canEditCols = !!variableSize && !is1D;

  const setCell = useCallback((r: number, c: number, raw: string) => {
    setDraft((prev) => {
      const next = prev.map((row) => row.slice());
      next[r][c] = raw;
      return next;
    });
  }, []);

  const addRow = useCallback(() => {
    setDraft((prev) => {
      const width = prev.length > 0 ? prev[0].length : 1;
      return [...prev, Array.from({ length: width }, () => "0")];
    });
  }, []);

  const removeRow = useCallback(() => {
    setDraft((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
  }, []);

  const addCol = useCallback(() => {
    setDraft((prev) =>
      prev.length > 0 ? prev.map((row) => [...row, "0"]) : [["0"]],
    );
  }, []);

  const removeCol = useCallback(() => {
    setDraft((prev) =>
      prev.length > 0 && prev[0].length > 1
        ? prev.map((row) => row.slice(0, -1))
        : prev,
    );
  }, []);

  const handlePaste = useCallback(async () => {
    setError(null);
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseClipboardMatrix(text);
      if (parsed.length === 0) return;
      if (is1D) {
        // Flatten any pasted block into a single column.
        const flat = parsed.flat();
        setDraft(flat.map((n) => [numToDraft(n)]));
      } else {
        setDraft(parsed.map((row) => row.map(numToDraft)));
      }
    } catch {
      setError(t("Clipboard access was denied."));
    }
  }, [is1D]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(draftToTsv(draft));
    } catch {
      // ignore — clipboard may be blocked outside secure contexts
    }
  }, [draft]);

  const submit = useCallback(() => {
    const oriented = transpose && !is1D ? transposeStr(draft) : draft;
    onSubmit(matrixToValue(draftToMatrix(oriented), is1D));
  }, [draft, is1D, transpose, onSubmit]);

  const shapeLabel = is1D ? `${rows}` : `${rows}×${cols}`;

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card array-editor-dialog">
        <h2>{readOnly ? t("View array") : t("Edit array")}</h2>
        <div className="array-editor-toolbar">
          <span className="array-editor-shape">
            {t("Shape: {shape}", { shape: shapeLabel })}
          </span>
          <div className="array-editor-toolbar-actions">
            {variableSize && !readOnly && (
              <>
                <button type="button" onClick={addRow} title={t("Add row")}>
                  {t("+ Row")}
                </button>
                <button
                  type="button"
                  onClick={removeRow}
                  disabled={rows <= 1}
                  title={t("Remove last row")}
                >
                  {t("− Row")}
                </button>
                {canEditCols && (
                  <>
                    <button
                      type="button"
                      onClick={addCol}
                      title={t("Add column")}
                    >
                      {t("+ Col")}
                    </button>
                    <button
                      type="button"
                      onClick={removeCol}
                      disabled={cols <= 1}
                      title={t("Remove last column")}
                    >
                      {t("− Col")}
                    </button>
                  </>
                )}
              </>
            )}
            <button type="button" onClick={handleCopy} title={t("Copy as TSV")}>
              {t("Copy")}
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={handlePaste}
                title={t("Paste TSV / CSV from clipboard")}
              >
                {t("Paste")}
              </button>
            )}
          </div>
        </div>

        {tooLarge ? (
          <p className="array-editor-notice">
            {t(
              "Array is too large to edit here ({cells} cells). Use Copy / Paste or edit the source data instead.",
              { cells: String(cellCount) },
            )}
          </p>
        ) : rows === 0 ? (
          <p className="array-editor-notice">{t("Empty array.")}</p>
        ) : (
          <div className="array-editor-grid-wrap">
            <table className="array-editor-grid">
              <thead>
                <tr>
                  <th className="array-editor-corner" />
                  {Array.from({ length: cols }, (_, c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draft.map((row, r) => (
                  <tr key={r}>
                    <th>{r}</th>
                    {row.map((cell, c) => (
                      <td key={c}>
                        {readOnly ? (
                          <span className="array-editor-cell-ro">
                            {formatCell(toNumber(cell), format)}
                          </span>
                        ) : (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={cell}
                            onChange={(e) => setCell(r, c, e.target.value)}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button onClick={onCancel}>
            {readOnly ? t("Close") : t("Cancel")}
          </button>
          {!readOnly && <button onClick={submit}>{t("OK")}</button>}
        </div>
      </div>
    </div>
  );
}
