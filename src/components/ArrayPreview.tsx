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
import type {
  ObjectStats,
  RuntimeApi,
  SignalData,
  SignalDataPreview,
} from "../runtime/runtime";
import { t } from "../i18n/translate";
import { acceptFromExtensions, saveBytesToFile } from "../utils/saveFile";
import { useToast } from "./Toast";
import { ArrayEditorDialog, MAX_EDITABLE_CELLS } from "./ArrayEditorDialog";

interface Props {
  runtime: RuntimeApi;
  oid: string;
  stats: ObjectStats;
  signalPreview: SignalDataPreview | null;
  refreshNonce: number;
  /** Called after the underlying data was edited so the parent can
   *  refresh plots / stats. */
  onApplied: () => void;
}

/** Build a CSV string from X / Y arrays via index access so it works
 *  on both ``Float64Array`` (the bytes-encoded payload) and plain
 *  ``number[]`` (the legacy list encoding). */
function buildCsv(x: ArrayLike<number>, y: ArrayLike<number>): string {
  const lines = ["x,y"];
  for (let i = 0; i < x.length; i += 1) {
    lines.push(`${x[i]},${y[i]}`);
  }
  return lines.join("\n");
}

export function ArrayPreview({
  runtime,
  oid,
  stats,
  signalPreview,
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
      preview={signalPreview}
      refreshNonce={refreshNonce}
      onApplied={onApplied}
    />
  );
}

function SignalArrayPreview({
  runtime,
  oid,
  preview,
  refreshNonce,
  onApplied,
}: {
  runtime: RuntimeApi;
  oid: string;
  preview: SignalDataPreview | null;
  refreshNonce: number;
  onApplied: () => void;
}) {
  const [fullData, setFullData] = useState<SignalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const pushToast = useToast();

  useEffect(() => {
    setError(null);
    setFullData(null);
  }, [oid, refreshNonce]);

  const loadFullData = useCallback(async () => {
    if (fullData) return fullData;
    const loaded = await runtime.getSignalData(oid);
    setFullData(loaded);
    return loaded;
  }, [runtime, oid, fullData]);

  const handleCopyCsv = useCallback(async () => {
    try {
      setLoadingAction(true);
      const data = await loadFullData();
      try {
        await navigator.clipboard.writeText(buildCsv(data.x, data.y));
      } catch {
        // Clipboard access may be blocked outside secure contexts.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingAction(false);
    }
  }, [loadFullData]);

  const handleDownload = useCallback(async () => {
    try {
      setLoadingAction(true);
      const data = await loadFullData();
      const bytes = new TextEncoder().encode(buildCsv(data.x, data.y));
      const result = await saveBytesToFile(
        bytes,
        `${oid}.csv`,
        [acceptFromExtensions(t("CSV files"), ["csv"], "text/csv")],
        "text/csv",
      );
      if (result.outcome === "downloaded") {
        pushToast({
          kind: "success",
          message: t("Saved {name} to your browser's Downloads folder.", {
            name: result.filename,
          }),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingAction(false);
    }
  }, [loadFullData, oid, pushToast]);

  const handleEdit = useCallback(async () => {
    try {
      setError(null);
      setLoadingAction(true);
      await loadFullData();
      setEditing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingAction(false);
    }
  }, [loadFullData]);

  if (error) return <div className="array-preview-error">{error}</div>;
  if (!preview)
    return <div className="array-preview-loading">{t("Loading data…")}</div>;

  const total = preview.size;
  const rows = preview.indices.map((idx, index) => ({
    idx,
    x: preview.x[index],
    y: preview.y[index],
  }));

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
            onClick={() => void handleEdit()}
            disabled={!editable || loadingAction}
            title={
              editable
                ? t("Edit X / Y values in a spreadsheet")
                : t("Array is too large to edit here")
            }
          >
            {t("Edit data…")}
          </button>
          <button
            type="button"
            onClick={() => void handleCopyCsv()}
            disabled={loadingAction}
          >
            {t("Copy CSV")}
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={loadingAction}
          >
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
              const ellipsisHere = i > 0 && row.idx > rows[i - 1].idx + 1;
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
      {editing && fullData && (
        <ArrayEditorDialog
          value={Array.from({ length: fullData.x.length }, (_, i) => [
            fullData.x[i],
            fullData.y[i],
          ])}
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
  runtime: RuntimeApi;
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
