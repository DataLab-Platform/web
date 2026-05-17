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

import { useCallback, useEffect, useRef, useState } from "react";
import type { ObjectStats, DataLabRuntime } from "../runtime/runtime";

interface Props {
  runtime: DataLabRuntime;
  oid: string;
  stats: ObjectStats;
  refreshNonce: number;
  /** Notify the parent when a signal X/Y import succeeds so the plot
   *  and the rest of the properties panel re-fetch. */
  onChanged?: () => void;
}

const HEAD_ROWS = 5;
const TAIL_ROWS = 5;

export function ArrayPreview({
  runtime,
  oid,
  stats,
  refreshNonce,
  onChanged,
}: Props) {
  if (stats.kind === "image") {
    return <ImageArrayPreview stats={stats} />;
  }
  return (
    <SignalArrayPreview
      runtime={runtime}
      oid={oid}
      refreshNonce={refreshNonce}
      onChanged={onChanged}
    />
  );
}

function SignalArrayPreview({
  runtime,
  oid,
  refreshNonce,
  onChanged,
}: {
  runtime: DataLabRuntime;
  oid: string;
  refreshNonce: number;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<{ x: number[]; y: number[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleImportPick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        const text = await file.text();
        const { x, y } = parseSignalCsv(text);
        if (x.length === 0) throw new Error("No numeric values found in file");
        if (x.length !== y.length)
          throw new Error(`Length mismatch: x=${x.length}, y=${y.length}`);
        await runtime.setSignalXY(oid, x, y);
        onChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [runtime, oid, onChanged],
  );

  if (error && !data) return <div className="array-preview-error">{error}</div>;
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
          <button type="button" onClick={handleImportPick} disabled={busy}>
            Import CSV…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            style={{ display: "none" }}
            onChange={handleImportFile}
            data-testid="signal-import-csv"
          />
        </div>
      </header>
      {error && <div className="array-preview-error">{error}</div>}
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
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return String(v);
  }
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) {
    return v.toExponential(4);
  }
  return Number(v.toPrecision(6)).toString();
}

/** Parse a 2-column CSV / whitespace-delimited blob into ``{x, y}``.
 *
 *  - Header rows whose first token is non-numeric are skipped.
 *  - Empty / non-numeric tokens are ignored.
 *  - Lines starting with ``#`` are treated as comments.
 *  - Falls back to "single column → consecutive (i, value) pairs" only
 *    if every non-empty line has exactly one numeric token (treated as
 *    Y with implicit ``x = arange(len)``).
 */
export function parseSignalCsv(text: string): { x: number[]; y: number[] } {
  const rows: number[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const tokens = line.split(/[\s,;]+/).filter((t) => t.length > 0);
    const nums = tokens.map(Number).filter((n) => Number.isFinite(n));
    if (nums.length === 0) continue; // header row
    rows.push(nums);
  }
  if (rows.length === 0) return { x: [], y: [] };
  const allSingle = rows.every((r) => r.length === 1);
  if (allSingle) {
    const y = rows.map((r) => r[0]);
    return { x: y.map((_, i) => i), y };
  }
  const x: number[] = [];
  const y: number[] = [];
  for (const r of rows) {
    if (r.length >= 2) {
      x.push(r[0]);
      y.push(r[1]);
    }
  }
  return { x, y };
}
