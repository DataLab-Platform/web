/**
 * RoiPanel — non-modal, docked ROI editor (Signal + Image).
 *
 * Replaces the old full-screen modal ROI dialogs (``RoiDialog`` /
 * ``ImageRoiDialog``) whose vertically-stacked forms hid the plot and
 * compressed the view.  This panel keeps the plot fully visible and
 * provides DataLab-desktop-style ergonomics:
 *
 *   - a compact, scrollable **list** of ROIs (color swatch + title + type);
 *   - a single **form** editing only the currently-selected ROI;
 *   - **draw** buttons that arm the matching plot tool so the user can add
 *     a ROI graphically (works even when no ROI exists yet);
 *   - **live two-way sync**: editing a field updates the plot overlay
 *     immediately, and dragging/drawing on the plot updates the form.
 *
 * The panel is a controlled component: every edit emits the *full* updated
 * ROI array through ``onSignalChange`` / ``onImageChange`` so the host
 * (``App``) keeps a single source of truth and reuses its existing
 * debounced persist path.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SignalRoiSegment, ImageRoiSegment } from "../runtime/runtime";
import { roiLineColor } from "../runtime/plotStyles";
import { t } from "../i18n/translate";

/** Geometry the plot should arm for graphical drawing.  ``segment`` maps
 *  to a horizontal range on signals (drawn with the rectangle tool). */
export type RoiDrawGeometry = "segment" | "rectangle" | "circle" | "polygon";

interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

interface Props {
  kind: "signal" | "image";
  signalRoi: SignalRoiSegment[];
  imageRoi: ImageRoiSegment[];
  bounds: Bounds;
  /** Index of the ROI whose form is shown (``null`` ⇒ none selected). */
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  onSignalChange: (segments: SignalRoiSegment[]) => void;
  onImageChange: (segments: ImageRoiSegment[]) => void;
  /** Arm (or disarm with ``null``) a graphical draw tool on the plot. */
  onRequestDraw: (geometry: RoiDrawGeometry | null) => void;
  /** Geometry currently armed for drawing, for button highlight. */
  activeDraw: RoiDrawGeometry | null;
  /** Reports the polygon vertex currently being edited (its cell has focus)
   *  so the host can highlight it on the plot; ``null`` ⇒ none. */
  onActiveVertexChange?: (vertexIndex: number | null) => void;
  /** Header title (defaults to "Regions of interest"). */
  title?: string;
  /** Optional prominent footer button (e.g. "Erase" for the erase session).
   *  When set it is rendered next to "Remove all" and the footer is shown
   *  even when no ROI exists yet. */
  primaryAction?: { label: string; onClick: () => void };
  onRemoveAll: () => void;
  onClose: () => void;
}

/** Short human label for a list row. */
function signalRowLabel(seg: SignalRoiSegment, idx: number): string {
  return seg.title || `ROI${idx + 1}`;
}

function imageRowLabel(seg: ImageRoiSegment, idx: number): string {
  return seg.title || `ROI${idx + 1}`;
}

function imageGeometryLabel(geometry: ImageRoiSegment["geometry"]): string {
  switch (geometry) {
    case "rectangle":
      return t("Rectangle");
    case "circle":
      return t("Circle");
    default:
      return t("Polygon");
  }
}

export function RoiPanel({
  kind,
  signalRoi,
  imageRoi,
  bounds,
  selectedIndex,
  onSelect,
  onSignalChange,
  onImageChange,
  onRequestDraw,
  activeDraw,
  onActiveVertexChange,
  title,
  primaryAction,
  onRemoveAll,
  onClose,
}: Props) {
  const count = kind === "signal" ? signalRoi.length : imageRoi.length;

  // -- Signal helpers -------------------------------------------------
  const addSignalNumeric = useCallback(() => {
    const span = (bounds.xMax - bounds.xMin) / 4 || 1;
    const center = (bounds.xMin + bounds.xMax) / 2;
    const next: SignalRoiSegment[] = [
      ...signalRoi,
      { xmin: center - span / 2, xmax: center + span / 2, title: "" },
    ];
    onSignalChange(next);
    onSelect(next.length - 1);
  }, [signalRoi, bounds, onSignalChange, onSelect]);

  const updateSignal = useCallback(
    (idx: number, patch: Partial<SignalRoiSegment>) => {
      onSignalChange(
        signalRoi.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
      );
    },
    [signalRoi, onSignalChange],
  );

  const removeAt = useCallback(
    (idx: number) => {
      if (kind === "signal") {
        onSignalChange(signalRoi.filter((_, i) => i !== idx));
      } else {
        onImageChange(imageRoi.filter((_, i) => i !== idx));
      }
      if (selectedIndex === idx) onSelect(null);
      else if (selectedIndex !== null && selectedIndex > idx) {
        onSelect(selectedIndex - 1);
      }
    },
    [
      kind,
      signalRoi,
      imageRoi,
      onSignalChange,
      onImageChange,
      selectedIndex,
      onSelect,
    ],
  );

  // -- Image helpers --------------------------------------------------
  const addImageRect = useCallback(() => {
    const sx = (bounds.xMax - bounds.xMin) / 4 || 1;
    const sy = (bounds.yMax - bounds.yMin) / 4 || 1;
    const x0 = (bounds.xMin + bounds.xMax) / 2 - sx / 2;
    const y0 = (bounds.yMin + bounds.yMax) / 2 - sy / 2;
    const next: ImageRoiSegment[] = [
      ...imageRoi,
      {
        geometry: "rectangle",
        title: "",
        inverse: false,
        x0,
        y0,
        dx: sx,
        dy: sy,
      },
    ];
    onImageChange(next);
    onSelect(next.length - 1);
  }, [imageRoi, bounds, onImageChange, onSelect]);

  const addImageCircle = useCallback(() => {
    const r =
      Math.min(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin) / 4 || 1;
    const xc = (bounds.xMin + bounds.xMax) / 2;
    const yc = (bounds.yMin + bounds.yMax) / 2;
    const next: ImageRoiSegment[] = [
      ...imageRoi,
      { geometry: "circle", title: "", inverse: false, xc, yc, r },
    ];
    onImageChange(next);
    onSelect(next.length - 1);
  }, [imageRoi, bounds, onImageChange, onSelect]);

  const updateImage = useCallback(
    (idx: number, seg: ImageRoiSegment) => {
      onImageChange(imageRoi.map((s, i) => (i === idx ? seg : s)));
    },
    [imageRoi, onImageChange],
  );

  const selectedSignal =
    kind === "signal" && selectedIndex !== null
      ? signalRoi[selectedIndex]
      : undefined;
  const selectedImage =
    kind === "image" && selectedIndex !== null
      ? imageRoi[selectedIndex]
      : undefined;

  const rows = useMemo(() => {
    if (kind === "signal") {
      return signalRoi.map((seg, idx) => ({
        idx,
        label: signalRowLabel(seg, idx),
        type: t("Range"),
        color: roiLineColor(idx),
      }));
    }
    return imageRoi.map((seg, idx) => ({
      idx,
      label: imageRowLabel(seg, idx),
      type: imageGeometryLabel(seg.geometry),
      color: roiLineColor(idx),
    }));
  }, [kind, signalRoi, imageRoi]);

  return (
    <div
      className="roi-panel"
      role="dialog"
      aria-label={title ?? t("Regions of interest")}
    >
      <div className="roi-panel-header">
        <span className="roi-panel-title">
          {title ?? t("Regions of interest")}
        </span>
        <button
          type="button"
          className="roi-panel-close"
          title={t("Close ROI editor")}
          aria-label={t("Close ROI editor")}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="roi-panel-toolbar">
        {kind === "signal" ? (
          <>
            <button
              type="button"
              className={
                "roi-draw-btn" + (activeDraw === "segment" ? " active" : "")
              }
              title={t("Draw a range on the plot")}
              onClick={() =>
                onRequestDraw(activeDraw === "segment" ? null : "segment")
              }
            >
              ✏ {t("Draw range")}
            </button>
            <button type="button" onClick={addSignalNumeric}>
              + {t("Add")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={
                "roi-draw-btn" + (activeDraw === "rectangle" ? " active" : "")
              }
              title={t("Draw a rectangle on the plot")}
              onClick={() =>
                onRequestDraw(activeDraw === "rectangle" ? null : "rectangle")
              }
            >
              ✏ {t("Rectangle")}
            </button>
            <button
              type="button"
              className={
                "roi-draw-btn" + (activeDraw === "circle" ? " active" : "")
              }
              title={t("Draw a circle on the plot")}
              onClick={() =>
                onRequestDraw(activeDraw === "circle" ? null : "circle")
              }
            >
              ✏ {t("Circle")}
            </button>
            <button
              type="button"
              className={
                "roi-draw-btn" + (activeDraw === "polygon" ? " active" : "")
              }
              title={t("Draw a polygon on the plot")}
              onClick={() =>
                onRequestDraw(activeDraw === "polygon" ? null : "polygon")
              }
            >
              ✏ {t("Polygon")}
            </button>
            <button
              type="button"
              onClick={addImageRect}
              title={t("Add a rectangle numerically")}
            >
              + {t("Rect")}
            </button>
            <button
              type="button"
              onClick={addImageCircle}
              title={t("Add a circle numerically")}
            >
              + {t("Circ")}
            </button>
          </>
        )}
      </div>

      {count === 0 ? (
        <div className="roi-panel-empty">
          {t(
            "No ROI yet. Use a draw button to trace one on the plot, or Add to enter coordinates.",
          )}
        </div>
      ) : (
        <ul className="roi-list">
          {rows.map((row) => (
            <li
              key={row.idx}
              className={
                "roi-list-item" + (selectedIndex === row.idx ? " selected" : "")
              }
              onClick={() => onSelect(row.idx)}
            >
              <span
                className="roi-swatch"
                style={{ background: row.color }}
                aria-hidden
              />
              <span className="roi-list-label">{row.label}</span>
              <span className="roi-list-type">{row.type}</span>
              <button
                type="button"
                className="roi-list-remove"
                title={t("Remove")}
                aria-label={t("Remove")}
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(row.idx);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedSignal && selectedIndex !== null && (
        <SignalRoiForm
          seg={selectedSignal}
          onChange={(patch) => updateSignal(selectedIndex, patch)}
        />
      )}
      {selectedImage && selectedIndex !== null && (
        <ImageRoiForm
          seg={selectedImage}
          onChange={(seg) => updateImage(selectedIndex, seg)}
          onActiveVertexChange={onActiveVertexChange}
        />
      )}

      {(count > 0 || primaryAction) && (
        <div className="roi-panel-footer">
          {count > 0 && (
            <button
              type="button"
              className="roi-remove-all"
              onClick={onRemoveAll}
            >
              {t("Remove all")}
            </button>
          )}
          {primaryAction && (
            <button
              type="button"
              className="roi-primary"
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-ROI forms (single active ROI only).
// ---------------------------------------------------------------------------

/** Numeric input that keeps the user's raw text but reports parsed
 *  numbers (only when finite) through ``onCommit``. */
function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  return (
    <label className="roi-field">
      <span className="roi-field-label">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? String(value) : ""}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onCommit(n);
        }}
      />
    </label>
  );
}

function SignalRoiForm({
  seg,
  onChange,
}: {
  seg: SignalRoiSegment;
  onChange: (patch: Partial<SignalRoiSegment>) => void;
}) {
  return (
    <div className="roi-form">
      <label className="roi-field roi-field--wide">
        <span className="roi-field-label">{t("Title")}</span>
        <input
          value={seg.title ?? ""}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </label>
      <div className="roi-field-row">
        <NumberField
          label={t("X min")}
          value={seg.xmin}
          onCommit={(n) => onChange({ xmin: n })}
        />
        <NumberField
          label={t("X max")}
          value={seg.xmax}
          onCommit={(n) => onChange({ xmax: n })}
        />
      </div>
    </div>
  );
}

function ImageRoiForm({
  seg,
  onChange,
  onActiveVertexChange,
}: {
  seg: ImageRoiSegment;
  onChange: (seg: ImageRoiSegment) => void;
  onActiveVertexChange?: (vertexIndex: number | null) => void;
}) {
  return (
    <div className="roi-form">
      <label className="roi-field roi-field--wide">
        <span className="roi-field-label">{t("Title")}</span>
        <input
          value={seg.title ?? ""}
          onChange={(e) => onChange({ ...seg, title: e.target.value })}
        />
      </label>
      <label className="roi-checkbox">
        <input
          type="checkbox"
          checked={!!seg.inverse}
          onChange={(e) => onChange({ ...seg, inverse: e.target.checked })}
        />
        {t("Inverse")}
      </label>

      {seg.geometry === "rectangle" && (
        <div className="roi-field-grid">
          <NumberField
            label="X₀"
            value={seg.x0}
            onCommit={(n) => onChange({ ...seg, x0: n })}
          />
          <NumberField
            label="Y₀"
            value={seg.y0}
            onCommit={(n) => onChange({ ...seg, y0: n })}
          />
          <NumberField
            label="ΔX"
            value={seg.dx}
            onCommit={(n) => onChange({ ...seg, dx: n })}
          />
          <NumberField
            label="ΔY"
            value={seg.dy}
            onCommit={(n) => onChange({ ...seg, dy: n })}
          />
        </div>
      )}
      {seg.geometry === "circle" && (
        <div className="roi-field-grid">
          <NumberField
            label="X꜀"
            value={seg.xc}
            onCommit={(n) => onChange({ ...seg, xc: n })}
          />
          <NumberField
            label="Y꜀"
            value={seg.yc}
            onCommit={(n) => onChange({ ...seg, yc: n })}
          />
          <NumberField
            label="R"
            value={seg.r}
            onCommit={(n) => onChange({ ...seg, r: n })}
          />
        </div>
      )}
      {seg.geometry === "polygon" && (
        <PolygonVertexTable
          points={seg.points}
          onChange={(points) => onChange({ ...seg, points })}
          onActiveVertexChange={onActiveVertexChange}
        />
      )}
    </div>
  );
}

/**
 * Editable vertex table for a polygon ROI — one row per vertex with X / Y
 * cells, plus add/remove controls.  Replaces the old free-text "x,y pairs"
 * box, which was unusable for long floating-point coordinates.
 *
 * Local string state per cell lets the user type freely (including transient
 * states like "-" or "1."); on every edit we emit a *full* point array,
 * substituting the last valid value for any cell that is momentarily
 * unparseable so the vertex count stays stable (the backend rejects polygons
 * with fewer than 3 vertices).  External changes (drawing, dragging on the
 * plot, selecting another ROI) are adopted via a signature comparison so the
 * table mirrors the model without clobbering in-progress typing.
 */
function PolygonVertexTable({
  points,
  onChange,
  onActiveVertexChange,
}: {
  points: [number, number][];
  onChange: (points: [number, number][]) => void;
  onActiveVertexChange?: (vertexIndex: number | null) => void;
}) {
  const [rows, setRows] = useState(() =>
    points.map(([x, y]) => ({ x: String(x), y: String(y) })),
  );
  const lastEmittedRef = useRef<string>("");
  // Index of the vertex whose cell currently has focus (``null`` ⇒ none).
  // Lets "+ Vertex" insert *before* the vertex being edited; when no cell is
  // focused the new vertex is appended at the end.
  const focusedRowRef = useRef<number | null>(null);

  // Keep the latest "active vertex" callback in a ref so the unmount cleanup
  // can clear the highlight without re-subscribing on every render.
  const activeCbRef = useRef(onActiveVertexChange);
  activeCbRef.current = onActiveVertexChange;
  const setActiveVertex = (idx: number | null) => {
    focusedRowRef.current = idx;
    activeCbRef.current?.(idx);
  };
  useEffect(() => {
    // Clear the plot highlight when the table unmounts (e.g. another ROI is
    // selected) so a stale vertex marker never lingers.
    return () => activeCbRef.current?.(null);
  }, []);

  useEffect(() => {
    const sig = JSON.stringify(points);
    if (sig !== lastEmittedRef.current) {
      lastEmittedRef.current = sig;
      setRows(points.map(([x, y]) => ({ x: String(x), y: String(y) })));
    }
  }, [points]);

  const commit = (nextRows: { x: string; y: string }[]) => {
    setRows(nextRows);
    const pts = nextRows.map((r, i) => {
      const x = Number(r.x);
      const y = Number(r.y);
      return [
        Number.isFinite(x) ? x : (points[i]?.[0] ?? 0),
        Number.isFinite(y) ? y : (points[i]?.[1] ?? 0),
      ] as [number, number];
    });
    lastEmittedRef.current = JSON.stringify(pts);
    onChange(pts);
  };

  const setCell = (idx: number, key: "x" | "y", value: string) =>
    commit(rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));

  const addVertex = () => {
    const n = rows.length;
    const parsed = rows.map(
      (r) => [Number(r.x), Number(r.y)] as [number, number],
    );
    const focused = focusedRowRef.current;
    let insertAt: number;
    let coord: [number, number];
    if (focused !== null && focused >= 0 && focused < n) {
      // Insert before the vertex being edited, on the incoming edge so the
      // new vertex lands on the polygon outline (midpoint of prev → focused).
      insertAt = focused;
      coord = midpoint(parsed[(focused - 1 + n) % n], parsed[focused]);
    } else {
      // No cell focused → append at the end, on the closing edge.
      insertAt = n;
      coord = n > 0 ? midpoint(parsed[n - 1], parsed[0]) : [0, 0];
    }
    const newRow = { x: String(coord[0]), y: String(coord[1]) };
    commit([...rows.slice(0, insertAt), newRow, ...rows.slice(insertAt)]);
  };

  const removeVertex = (idx: number) =>
    commit(rows.filter((_, i) => i !== idx));

  return (
    <div className="roi-poly">
      <div className="roi-poly-head">
        <span className="roi-field-label">{t("Vertices")}</span>
        <button
          type="button"
          className="roi-poly-add"
          title={t("Add a vertex")}
          // Keep focus on the cell being edited so ``addVertex`` can read it
          // (clicking a button would otherwise blur the input first).
          onMouseDown={(e) => e.preventDefault()}
          onClick={addVertex}
        >
          + {t("Vertex")}
        </button>
      </div>
      <div className="roi-poly-table" role="table">
        <div className="roi-poly-row roi-poly-row--head" role="row">
          <span className="roi-poly-idx" />
          <span>X</span>
          <span>Y</span>
          <span />
        </div>
        {rows.map((r, idx) => (
          <div className="roi-poly-row" role="row" key={idx}>
            <span className="roi-poly-idx">{idx + 1}</span>
            <input
              type="text"
              inputMode="decimal"
              value={r.x}
              aria-label={t("Vertex {n} X", { n: idx + 1 })}
              onFocus={() => setActiveVertex(idx)}
              onBlur={() => {
                if (focusedRowRef.current === idx) setActiveVertex(null);
              }}
              onChange={(e) => setCell(idx, "x", e.target.value)}
            />
            <input
              type="text"
              inputMode="decimal"
              value={r.y}
              aria-label={t("Vertex {n} Y", { n: idx + 1 })}
              onFocus={() => setActiveVertex(idx)}
              onBlur={() => {
                if (focusedRowRef.current === idx) setActiveVertex(null);
              }}
              onChange={(e) => setCell(idx, "y", e.target.value)}
            />
            <button
              type="button"
              className="roi-poly-remove"
              title={t("Remove vertex")}
              aria-label={t("Remove vertex")}
              disabled={rows.length <= 3}
              onClick={() => removeVertex(idx)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Midpoint of two vertices, falling back to a finite endpoint (or 0) when
 *  a coordinate is momentarily unparseable. */
function midpoint(a: [number, number], b: [number, number]): [number, number] {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  return [
    Number.isFinite(mx) ? mx : Number.isFinite(a[0]) ? a[0] : 0,
    Number.isFinite(my) ? my : Number.isFinite(a[1]) ? a[1] : 0,
  ];
}
