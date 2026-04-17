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
import type { ObjectStats, SigimaRuntime } from "../sigima/runtime";

interface Props {
  runtime: SigimaRuntime;
  oid: string;
  stats: ObjectStats;
  refreshNonce: number;
}

const HEAD_ROWS = 5;
const TAIL_ROWS = 5;

export function ArrayPreview({ runtime, oid, stats, refreshNonce }: Props) {
  if (stats.kind === "image") {
    return <ImageArrayPreview stats={stats} />;
  }
  return (
    <SignalArrayPreview
      runtime={runtime}
      oid={oid}
      refreshNonce={refreshNonce}
    />
  );
}

function SignalArrayPreview({
  runtime,
  oid,
  refreshNonce,
}: {
  runtime: SigimaRuntime;
  oid: string;
  refreshNonce: number;
}) {
  const [data, setData] = useState<{ x: number[]; y: number[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  if (!data) return <div className="array-preview-loading">Loading data…</div>;

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

  return (
    <section className="array-preview" aria-label="Data preview">
      <header className="array-preview-header">
        <h3 className="array-preview-title">
          Data ({total} {total === 1 ? "point" : "points"})
        </h3>
        <div className="array-preview-actions">
          <button type="button" onClick={handleCopyCsv}>
            Copy CSV
          </button>
          <button type="button" onClick={handleDownload}>
            Download
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
    </section>
  );
}

function ImageArrayPreview({
  stats,
}: {
  stats: Extract<ObjectStats, { kind: "image" }>;
}) {
  return (
    <section className="array-preview" aria-label="Data preview">
      <header className="array-preview-header">
        <h3 className="array-preview-title">
          Image data ({stats.shape.join(" × ")} {stats.dtype})
        </h3>
      </header>
      <p className="array-preview-info">
        Image data preview is not yet available — see the main canvas and the
        statistics card above.
      </p>
    </section>
  );
}

function fmt(v: number): string {
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) {
    return v.toExponential(4);
  }
  return Number(v.toPrecision(6)).toString();
}
