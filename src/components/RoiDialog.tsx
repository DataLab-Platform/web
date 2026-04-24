import { useState } from "react";
import type { SignalRoiSegment } from "../runtime/runtime";

interface Props {
  /** Initial ROI list (already cloned from the model). */
  initial: SignalRoiSegment[];
  /** X bounds of the underlying signal — used as defaults for new segments. */
  xMin: number;
  xMax: number;
  onSubmit: (segments: SignalRoiSegment[]) => void;
  onCancel: () => void;
}

interface RowState {
  xmin: string;
  xmax: string;
  title: string;
}

function toRow(seg: SignalRoiSegment): RowState {
  return {
    xmin: String(seg.xmin),
    xmax: String(seg.xmax),
    title: seg.title ?? "",
  };
}

export function RoiDialog({ initial, xMin, xMax, onSubmit, onCancel }: Props) {
  const [rows, setRows] = useState<RowState[]>(initial.map(toRow));
  const [error, setError] = useState<string | null>(null);

  const updateRow = (idx: number, key: keyof RowState, value: string) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)),
    );
  };

  const addRow = () => {
    const span = (xMax - xMin) / 4 || 1;
    const center = (xMin + xMax) / 2;
    setRows((prev) => [
      ...prev,
      {
        xmin: String(center - span / 2),
        xmax: String(center + span / 2),
        title: "",
      },
    ]);
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const out: SignalRoiSegment[] = [];
    for (const r of rows) {
      const xmin = Number(r.xmin);
      const xmax = Number(r.xmax);
      if (!Number.isFinite(xmin) || !Number.isFinite(xmax)) {
        setError("All bounds must be valid numbers.");
        return;
      }
      if (xmax <= xmin) {
        setError("Each segment must satisfy xmin < xmax.");
        return;
      }
      out.push({ xmin, xmax, title: r.title });
    }
    setError(null);
    onSubmit(out);
  };

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog"
        style={{ minWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <h2>Edit regions of interest</h2>
          {rows.length === 0 && (
            <div style={{ color: "var(--text-dim)", marginBottom: 12 }}>
              No ROI defined. Click <em>Add</em> to create one.
            </div>
          )}
          {rows.length > 0 && (
            <table style={{ width: "100%", marginBottom: 8 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text-dim)" }}>
                  <th>Title</th>
                  <th>X min</th>
                  <th>X max</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={idx}>
                    <td>
                      <input
                        value={r.title}
                        placeholder={`ROI ${idx + 1}`}
                        onChange={(e) =>
                          updateRow(idx, "title", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        value={r.xmin}
                        onChange={(e) => updateRow(idx, "xmin", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        value={r.xmax}
                        onChange={(e) => updateRow(idx, "xmax", e.target.value)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        title="Remove"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {error && (
            <div style={{ color: "#c4302b", marginBottom: 8 }}>{error}</div>
          )}
          <div
            className="dialog-actions"
            style={{ justifyContent: "space-between" }}
          >
            <button type="button" onClick={addRow}>
              + Add
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
              <button type="submit">OK</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
