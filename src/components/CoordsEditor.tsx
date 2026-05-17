/**
 * CoordsEditor — read-only preview + import of an image's X / Y pixel
 * coordinate arrays, with a Switch button to toggle between uniform
 * (origin + spacing) and non-uniform (explicit per-pixel arrays)
 * representations.
 *
 * Mirrors DataLab desktop's "Coordinates" tab in the image properties
 * dialog.  The generic ``DataSetForm`` cannot edit ``xcoords`` /
 * ``ycoords`` usefully (the fallback "1000 floats in a single text
 * input" widget is unusable), so this component provides:
 *
 *  - a head/tail preview of both arrays (similar to ``ArrayPreview``)
 *  - a Switch to uniform/non-uniform button (the only way to flip
 *    ``is_uniform_coords`` since the checkbox is inactive — mirroring
 *    Sigima's ``display.active=False`` on that item)
 *  - per-axis CSV import that switches the image to non-uniform.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DataLabRuntime } from "../runtime/runtime";

interface Props {
  runtime: DataLabRuntime;
  oid: string;
  refreshNonce: number;
  /** Notify the parent that the underlying object changed so the plot
   *  and the rest of the properties panel re-fetch. */
  onChanged: () => void;
}

interface CoordsPayload {
  is_uniform: boolean;
  shape: [number, number]; // [h, w]
  x: number[];
  y: number[];
}

const HEAD_ROWS = 5;
const TAIL_ROWS = 5;

export function CoordsEditor({ runtime, oid, refreshNonce, onChanged }: Props) {
  const [data, setData] = useState<CoordsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    runtime
      .getImageCoords(oid)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, oid, refreshNonce]);

  const handleSwitch = useCallback(async () => {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const target = data.is_uniform ? "non-uniform" : "uniform";
      await runtime.switchImageCoordsType(oid, target);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [runtime, oid, data, onChanged]);

  const importAxis = useCallback(
    async (axis: "x" | "y", text: string) => {
      if (!data) return;
      const parsed = parseCsvNumbers(text);
      if (parsed.length === 0) {
        setError("No numeric values found in file");
        return;
      }
      const [h, w] = data.shape;
      const expected = axis === "x" ? w : h;
      if (parsed.length !== expected) {
        setError(
          `${axis.toUpperCase()} length mismatch: got ${parsed.length}, expected ${expected}`,
        );
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const x = axis === "x" ? parsed : data.x;
        const y = axis === "y" ? parsed : data.y;
        await runtime.setImageCoords(oid, x, y);
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [runtime, oid, data, onChanged],
  );

  if (error && !data) return <div className="array-preview-error">{error}</div>;
  if (!data)
    return <div className="array-preview-loading">Loading coords…</div>;

  return (
    <section className="array-preview" aria-label="Coordinates">
      <header className="array-preview-header">
        <h3 className="array-preview-title">
          Coordinates ({data.shape[1]} × {data.shape[0]} —{" "}
          {data.is_uniform ? "uniform" : "non-uniform"})
        </h3>
        <div className="array-preview-actions">
          <button type="button" onClick={handleSwitch} disabled={busy}>
            Switch to {data.is_uniform ? "non-uniform" : "uniform"}
          </button>
        </div>
      </header>
      {error && <div className="array-preview-error">{error}</div>}
      <div className="coords-editor-axes">
        <AxisPreview
          axis="x"
          label={`X (width = ${data.shape[1]})`}
          values={data.x}
          onImport={(text) => importAxis("x", text)}
          disabled={busy}
        />
        <AxisPreview
          axis="y"
          label={`Y (height = ${data.shape[0]})`}
          values={data.y}
          onImport={(text) => importAxis("y", text)}
          disabled={busy}
        />
      </div>
    </section>
  );
}

function AxisPreview({
  axis,
  label,
  values,
  onImport,
  disabled,
}: {
  axis: "x" | "y";
  label: string;
  values: number[];
  onImport: (text: string) => void;
  disabled: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const total = values.length;
  const showEllipsis = total > HEAD_ROWS + TAIL_ROWS;
  const headEnd = showEllipsis ? HEAD_ROWS : Math.min(total, HEAD_ROWS);
  const tailStart = showEllipsis ? total - TAIL_ROWS : headEnd;
  const rows: { idx: number; v: number }[] = [];
  for (let i = 0; i < headEnd; i += 1) rows.push({ idx: i, v: values[i] });
  for (let i = tailStart; i < total; i += 1)
    rows.push({ idx: i, v: values[i] });

  const handlePick = () => fileInputRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-import of the same filename
    if (!file) return;
    const text = await file.text();
    onImport(text);
  };

  return (
    <div className="coords-editor-axis">
      <div className="coords-editor-axis-header">
        <strong>{label}</strong>
        <button
          type="button"
          onClick={handlePick}
          disabled={disabled}
          title={`Import ${axis.toUpperCase()} coordinates from a CSV / text file`}
        >
          Import {axis.toUpperCase()}…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          style={{ display: "none" }}
          onChange={handleFile}
          data-testid={`coords-import-${axis}`}
        />
      </div>
      <div className="array-preview-table-wrap">
        <table className="array-preview-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{axis.toUpperCase()}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const ellipsisHere = showEllipsis && i === HEAD_ROWS;
              return [
                ellipsisHere ? (
                  <tr key={`ell-${row.idx}`} className="array-preview-ellipsis">
                    <td colSpan={2}>…</td>
                  </tr>
                ) : null,
                <tr key={row.idx}>
                  <td className="array-preview-idx">{row.idx}</td>
                  <td>{fmt(row.v)}</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Parse a CSV / whitespace-delimited text blob into a flat list of
 *  finite numbers.  Header rows (non-numeric first token) are
 *  silently skipped.  Empty cells / non-numeric tokens are ignored. */
export function parseCsvNumbers(text: string): number[] {
  const out: number[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) continue;
    const tokens = stripped.split(/[\s,;]+/);
    for (const tok of tokens) {
      if (!tok) continue;
      const v = Number(tok);
      if (Number.isFinite(v)) out.push(v);
    }
  }
  return out;
}

function fmt(v: number): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return v.toExponential(4);
  return Number(v.toPrecision(6)).toString();
}
