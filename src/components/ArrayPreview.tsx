/**
 * ArrayPreview — read-only paginated view of the underlying data
 * array (signal x/y or first row of an image).
 *
 * Provides the missing alternative to the unusable "1000 floats in
 * one comma-separated text input" fallback used by the generic
 * DataSet form.  Editing the raw scientific data is rarely the right
 * UX — this widget focuses on visibility (head + tail, copy / download
 * as CSV).
 */

import { useCallback, useEffect, useState } from "react";
import type { ObjectStats, DataLabRuntime } from "../runtime/runtime";
import { t } from "../i18n/translate";
import { ArrayEditorDialog, MAX_EDITABLE_CELLS } from "./ArrayEditorDialog";

interface Props {
  runtime: DataLabRuntime;
  oid: string;
  stats: ObjectStats;
  refreshNonce: number;
  /** Called after the underlying data was edited so the parent can
   *  refresh plots / stats. */
  onApplied: () => void;
}

const HEAD_ROWS = 5;
const TAIL_ROWS = 5;

export function ArrayPreview({
  runtime,
  oid,
  stats,
  refreshNonce,
  onApplied,
}: Props) {
  if (stats.kind === "image") {
    return (
      <ImageArrayPreview
        runtime={runtime}
        oid={oid}
        stats={stats}
        onApplied={onApplied}
      />
    );
  }
  return (
    <SignalArrayPreview
      runtime={runtime}
      oid={oid}
      refreshNonce={refreshNonce}
      onApplied={onApplied}
    />
  );
}

function SignalArrayPreview({
  runtime,
  oid,
  refreshNonce,
  onApplied,
}: {
  runtime: DataLabRuntime;
  oid: string;
  refreshNonce: number;
  onApplied: () => void;
}) {
  const [data, setData] = useState<{ x: number[]; y: number[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    runtime
      .getSignalData(oid)
      .then((d) => {
        if (!cancelled) setData({ x: d.x, y: d.y });
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, oid, refreshNonce]);

  const handleCopyCsv = useCallback(async () => {
    if (!data) return;
    const csv = ["x,y", ...data.x.map((xi, i) => `${xi},${data.y[i]}`)].join(
      "\n",
    );
    try {
      await navigator.clipboard.writeText(csv);
    } catch {
      // ignore — clipboard may be blocked outside secure contexts
    }
  }, [data]);

  const handleDownload = useCallback(() => {
    if (!data) return;
    const csv = ["x,y", ...data.x.map((xi, i) => `${xi},${data.y[i]}`)].join(
      "\n",
    );
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${oid}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, oid]);

  if (error) return <div className="array-preview-error">{error}</div>;
  if (!data)
    return <div className="array-preview-loading">{t("Loading data…")}</div>;

  // Compute head + tail (with an ellipsis row when the array is long
  // enough to justify it).
  const total = data.x.length;
  const showEllipsis = total > HEAD_ROWS + TAIL_ROWS;
  const headEnd = showEllipsis ? HEAD_ROWS : Math.min(total, HEAD_ROWS);
  const tailStart = showEllipsis ? total - TAIL_ROWS : headEnd;

  const rows: { idx: number; x: number; y: number }[] = [];
  for (let i = 0; i < headEnd; i += 1) {
    rows.push({ idx: i, x: data.x[i], y: data.y[i] });
  }
  for (let i = tailStart; i < total; i += 1) {
    rows.push({ idx: i, x: data.x[i], y: data.y[i] });
  }

  // The editor materialises an N×2 string grid, so it is only offered for
  // arrays at/under the cell cap. Larger signals are still viewable via the
  // head/tail preview and Copy CSV.
  const editable = total * 2 <= MAX_EDITABLE_CELLS;

  return (
    <section className="array-preview" aria-label={t("Data preview")}>
      <header className="array-preview-header">
        <h3 className="array-preview-title">
          {t("Data ({count} {unit})", {
            count: total,
            unit: total === 1 ? t("point") : t("points"),
          })}
        </h3>
        <div className="array-preview-actions">
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={!editable}
            title={
              editable
                ? t("Edit X / Y values in a spreadsheet")
                : t("Array is too large to edit here")
            }
          >
            {t("Edit data…")}
          </button>
          <button type="button" onClick={handleCopyCsv}>
            {t("Copy CSV")}
          </button>
          <button type="button" onClick={handleDownload}>
            {t("Download")}
          </button>
        </div>
      </header>
      <div className="array-preview-table-wrap">
        <table className="array-preview-table">
          <thead>
            <tr>
              <th>#</th>
              <th>X</th>
              <th>Y</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const ellipsisHere = showEllipsis && i === HEAD_ROWS;
              return [
                ellipsisHere ? (
                  <tr key={`ell-${row.idx}`} className="array-preview-ellipsis">
                    <td colSpan={3}>…</td>
                  </tr>
                ) : null,
                <tr key={row.idx}>
                  <td className="array-preview-idx">{row.idx}</td>
                  <td>{fmt(row.x)}</td>
                  <td>{fmt(row.y)}</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      {editing && (
        <ArrayEditorDialog
          value={data.x.map((xi, i) => [xi, data.y[i]])}
          format="%g"
          onCancel={() => setEditing(false)}
          onSubmit={(next) => {
            const matrix = next as number[][];
            const xs = matrix.map((r) => r[0] ?? 0);
            const ys = matrix.map((r) => r[1] ?? 0);
            void runtime
              .setSignalData(oid, xs, ys)
              .then(() => {
                setEditing(false);
                onApplied();
              })
              .catch((err) => {
                setError(err instanceof Error ? err.message : String(err));
                setEditing(false);
              });
          }}
        />
      )}
    </section>
  );
}

function ImageArrayPreview({
  runtime,
  oid,
  stats,
  onApplied,
}: {
  runtime: DataLabRuntime;
  oid: string;
  stats: Extract<ObjectStats, { kind: "image" }>;
  onApplied: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [matrix, setMatrix] = useState<number[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [height, width] = stats.shape;
  // The editor materialises a full string grid; only offer it for images
  // at/under the cell cap. Larger images remain viewable on the main canvas.
  const editable = width * height <= MAX_EDITABLE_CELLS;

  const handleEdit = useCallback(() => {
    setError(null);
    setLoading(true);
    runtime
      .getImageData(oid)
      .then((img) => {
        const rows = img.data as (number[] | Float32Array)[];
        const grid: number[][] = rows.map((row) => Array.from(row));
        setMatrix(grid);
        setEditing(true);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [runtime, oid]);

  return (
    <section className="array-preview" aria-label={t("Data preview")}>
      <header className="array-preview-header">
        <h3 className="array-preview-title">
          {t("Image data ({shape} {dtype})", {
            shape: stats.shape.join(" × "),
            dtype: stats.dtype,
          })}
        </h3>
        <div className="array-preview-actions">
          <button
            type="button"
            onClick={handleEdit}
            disabled={!editable || loading}
            title={
              editable
                ? t("Edit pixel values in a spreadsheet")
                : t("Array is too large to edit here")
            }
          >
            {loading ? t("Loading data…") : t("Edit data…")}
          </button>
        </div>
      </header>
      {error && <div className="array-preview-error">{error}</div>}
      <p className="array-preview-info">
        {editable
          ? t(
              "Use “Edit data…” to view and edit pixel values, or see the main canvas above.",
            )
          : t(
              "Image is too large to edit here — see the main canvas and the statistics card above.",
            )}
      </p>
      {editing && matrix && (
        <ArrayEditorDialog
          value={matrix}
          format="%g"
          onCancel={() => setEditing(false)}
          onSubmit={(next) => {
            void runtime
              .setImageData(oid, next as number[][])
              .then(() => {
                setEditing(false);
                onApplied();
              })
              .catch((err) => {
                setError(err instanceof Error ? err.message : String(err));
                setEditing(false);
              });
          }}
        />
      )}
    </section>
  );
}

function fmt(v: number): string {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return String(v);
  }
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) {
    return v.toExponential(4);
  }
  return Number(v.toPrecision(6)).toString();
}
