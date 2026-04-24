import { useState } from "react";
import type { ImageRoiSegment } from "../runtime/runtime";

interface Props {
  /** Initial ROI list (already cloned from the model). */
  initial: ImageRoiSegment[];
  /** Physical bounding box of the underlying image — used as defaults
   *  when adding new shapes (centred sub-region). */
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  onSubmit: (segments: ImageRoiSegment[]) => void;
  onCancel: () => void;
}

type Geometry = "rectangle" | "circle" | "polygon";

/** Internal form state — strings everywhere so the user can type freely. */
interface RowState {
  geometry: Geometry;
  title: string;
  inverse: boolean;
  // rectangle
  x0: string;
  y0: string;
  dx: string;
  dy: string;
  // circle
  xc: string;
  yc: string;
  r: string;
  // polygon: "x0,y0 x1,y1 …" (whitespace- or newline-separated pairs)
  points: string;
}

function toRow(seg: ImageRoiSegment): RowState {
  const base: RowState = {
    geometry: seg.geometry,
    title: seg.title ?? "",
    inverse: !!seg.inverse,
    x0: "0",
    y0: "0",
    dx: "0",
    dy: "0",
    xc: "0",
    yc: "0",
    r: "0",
    points: "",
  };
  if (seg.geometry === "rectangle") {
    base.x0 = String(seg.x0);
    base.y0 = String(seg.y0);
    base.dx = String(seg.dx);
    base.dy = String(seg.dy);
  } else if (seg.geometry === "circle") {
    base.xc = String(seg.xc);
    base.yc = String(seg.yc);
    base.r = String(seg.r);
  } else {
    base.points = seg.points.map(([x, y]) => `${x},${y}`).join(" ");
  }
  return base;
}

function defaultRect(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): RowState {
  const sx = (xMax - xMin) / 4 || 1;
  const sy = (yMax - yMin) / 4 || 1;
  const x0 = (xMin + xMax) / 2 - sx / 2;
  const y0 = (yMin + yMax) / 2 - sy / 2;
  return {
    geometry: "rectangle",
    title: "",
    inverse: false,
    x0: String(x0),
    y0: String(y0),
    dx: String(sx),
    dy: String(sy),
    xc: "0",
    yc: "0",
    r: "0",
    points: "",
  };
}

function defaultCircle(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): RowState {
  const r = Math.min(xMax - xMin, yMax - yMin) / 4 || 1;
  return {
    geometry: "circle",
    title: "",
    inverse: false,
    x0: "0",
    y0: "0",
    dx: "0",
    dy: "0",
    xc: String((xMin + xMax) / 2),
    yc: String((yMin + yMax) / 2),
    r: String(r),
    points: "",
  };
}

function rowToSegment(r: RowState): ImageRoiSegment {
  if (r.geometry === "rectangle") {
    return {
      geometry: "rectangle",
      title: r.title,
      inverse: r.inverse,
      x0: Number(r.x0),
      y0: Number(r.y0),
      dx: Number(r.dx),
      dy: Number(r.dy),
    };
  }
  if (r.geometry === "circle") {
    return {
      geometry: "circle",
      title: r.title,
      inverse: r.inverse,
      xc: Number(r.xc),
      yc: Number(r.yc),
      r: Number(r.r),
    };
  }
  // polygon: parse "x,y x,y …" or newline-separated pairs.
  const points: [number, number][] = [];
  for (const tok of r.points.split(/[\s;]+/)) {
    if (!tok) continue;
    const [xs, ys] = tok.split(",");
    const x = Number(xs);
    const y = Number(ys);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
  }
  return {
    geometry: "polygon",
    title: r.title,
    inverse: r.inverse,
    points,
  };
}

function validate(seg: ImageRoiSegment): string | null {
  if (seg.geometry === "rectangle") {
    if (!Number.isFinite(seg.x0) || !Number.isFinite(seg.y0)) {
      return "Rectangle origin must be a number.";
    }
    if (!(seg.dx > 0 && seg.dy > 0)) {
      return "Rectangle dx/dy must be > 0.";
    }
  } else if (seg.geometry === "circle") {
    if (!Number.isFinite(seg.xc) || !Number.isFinite(seg.yc)) {
      return "Circle center must be a number.";
    }
    if (!(seg.r > 0)) return "Circle radius must be > 0.";
  } else {
    if (seg.points.length < 3) return "Polygon needs ≥ 3 vertices.";
  }
  return null;
}

export function ImageRoiDialog({
  initial,
  xMin,
  xMax,
  yMin,
  yMax,
  onSubmit,
  onCancel,
}: Props) {
  const [rows, setRows] = useState<RowState[]>(initial.map(toRow));
  const [error, setError] = useState<string | null>(null);

  const updateRow = <K extends keyof RowState>(
    idx: number,
    key: K,
    value: RowState[K],
  ) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)),
    );
  };

  const addRect = () =>
    setRows((p) => [...p, defaultRect(xMin, xMax, yMin, yMax)]);
  const addCircle = () =>
    setRows((p) => [...p, defaultCircle(xMin, xMax, yMin, yMax)]);
  const addPolygon = () =>
    setRows((p) => [
      ...p,
      {
        geometry: "polygon",
        title: "",
        inverse: false,
        x0: "0",
        y0: "0",
        dx: "0",
        dy: "0",
        xc: "0",
        yc: "0",
        r: "0",
        // Default: triangle near image center.
        points: `${(xMin + xMax) / 2},${yMin + (yMax - yMin) * 0.25} ${
          xMin + (xMax - xMin) * 0.25
        },${yMin + (yMax - yMin) * 0.75} ${
          xMin + (xMax - xMin) * 0.75
        },${yMin + (yMax - yMin) * 0.75}`,
      },
    ]);

  const removeRow = (idx: number) =>
    setRows((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const out: ImageRoiSegment[] = [];
    for (const r of rows) {
      const seg = rowToSegment(r);
      const err = validate(seg);
      if (err) {
        setError(err);
        return;
      }
      out.push(seg);
    }
    setError(null);
    onSubmit(out);
  };

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog"
        style={{ minWidth: 560, maxHeight: "85vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <h2>Edit image regions of interest</h2>
          {rows.length === 0 && (
            <div style={{ color: "var(--text-dim)", marginBottom: 12 }}>
              No ROI defined. Use the buttons below to add one.
            </div>
          )}
          {rows.map((r, idx) => (
            <fieldset
              key={idx}
              style={{
                marginBottom: 10,
                padding: 8,
                border: "1px solid var(--border)",
                borderRadius: 4,
              }}
            >
              <legend style={{ fontSize: 12, color: "var(--text-dim)" }}>
                ROI {idx + 1} — {r.geometry}
              </legend>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto 1fr auto",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                <label>Title</label>
                <input
                  value={r.title}
                  placeholder={`ROI ${idx + 1}`}
                  onChange={(e) => updateRow(idx, "title", e.target.value)}
                />
                <label>Inverse</label>
                <input
                  type="checkbox"
                  checked={r.inverse}
                  onChange={(e) => updateRow(idx, "inverse", e.target.checked)}
                />
                <button
                  type="button"
                  title="Remove"
                  onClick={() => removeRow(idx)}
                >
                  ×
                </button>
              </div>
              <div style={{ marginTop: 6 }}>
                {r.geometry === "rectangle" && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto 1fr",
                      gap: 6,
                      alignItems: "center",
                    }}
                  >
                    <label>X₀</label>
                    <input
                      value={r.x0}
                      onChange={(e) => updateRow(idx, "x0", e.target.value)}
                    />
                    <label>Y₀</label>
                    <input
                      value={r.y0}
                      onChange={(e) => updateRow(idx, "y0", e.target.value)}
                    />
                    <label>ΔX</label>
                    <input
                      value={r.dx}
                      onChange={(e) => updateRow(idx, "dx", e.target.value)}
                    />
                    <label>ΔY</label>
                    <input
                      value={r.dy}
                      onChange={(e) => updateRow(idx, "dy", e.target.value)}
                    />
                  </div>
                )}
                {r.geometry === "circle" && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto 1fr auto 1fr",
                      gap: 6,
                      alignItems: "center",
                    }}
                  >
                    <label>X꜀</label>
                    <input
                      value={r.xc}
                      onChange={(e) => updateRow(idx, "xc", e.target.value)}
                    />
                    <label>Y꜀</label>
                    <input
                      value={r.yc}
                      onChange={(e) => updateRow(idx, "yc", e.target.value)}
                    />
                    <label>R</label>
                    <input
                      value={r.r}
                      onChange={(e) => updateRow(idx, "r", e.target.value)}
                    />
                  </div>
                )}
                {r.geometry === "polygon" && (
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: 12,
                        color: "var(--text-dim)",
                        marginBottom: 2,
                      }}
                    >
                      Vertices (space-separated <code>x,y</code> pairs)
                    </label>
                    <textarea
                      value={r.points}
                      rows={3}
                      style={{ width: "100%", fontFamily: "monospace" }}
                      onChange={(e) => updateRow(idx, "points", e.target.value)}
                    />
                  </div>
                )}
              </div>
            </fieldset>
          ))}
          {error && (
            <div style={{ color: "#c4302b", marginBottom: 8 }}>{error}</div>
          )}
          <div
            className="dialog-actions"
            style={{ justifyContent: "space-between" }}
          >
            <div style={{ display: "flex", gap: 4 }}>
              <button type="button" onClick={addRect}>
                + Rectangle
              </button>
              <button type="button" onClick={addCircle}>
                + Circle
              </button>
              <button type="button" onClick={addPolygon}>
                + Polygon
              </button>
            </div>
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
