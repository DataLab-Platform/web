/**
 * Modal dialog for image-profile feature parameters with an interactive
 * preview, mirroring DataLab desktop's ``ProfileExtractionDialog``.
 *
 * Splits the layout horizontally:
 *
 * * left:  the image preview (heatmap + draggable shape) so the user can
 *   sketch the profile geometry directly on the image;
 * * right: the regular ``DataSetForm`` so numeric values can also be
 *   typed in.
 *
 * Param ⇄ shape are kept in sync both ways:
 *
 * * editing values in the form moves the shape;
 * * dragging the shape on the plot updates the matching values
 *   (``row``/``col`` for ``line_profile``, ``row1``/``col1``/``row2``/
 *   ``col2`` for ``segment_profile`` and ``average_profile``,
 *   ``x0``/``y0`` for ``radial_profile`` — switching ``center`` to
 *   ``"user"`` automatically when the user starts dragging).
 *
 * On ``OK`` the dialog returns the same ``Record<string, unknown>`` of
 * values that :class:`DataSetDialog` would, so the surrounding
 * ``runFeature`` pipeline is unchanged.
 */

import { useCallback, useMemo, useState } from "react";
import Plot from "react-plotly.js";
import { DataSetForm } from "./DataSetForm";
import type {
  DynamicChoice,
  ImageData,
  JsonSchema,
  SchemaWithValues,
} from "../runtime/runtime";

export type ProfileFeatureId =
  | "line_profile"
  | "segment_profile"
  | "average_profile"
  | "radial_profile";

interface Props {
  title: string;
  featureId: ProfileFeatureId;
  payload: SchemaWithValues;
  imageData: ImageData;
  resolveChoices?: (
    itemName: string,
    currentValues: Record<string, unknown>,
  ) => Promise<DynamicChoice[]>;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Pixel ⇄ physical coordinate conversion
// ---------------------------------------------------------------------------

const pixToX = (img: ImageData, col: number) => img.x0 + (col + 0.5) * img.dx;
const pixToY = (img: ImageData, row: number) => img.y0 + (row + 0.5) * img.dy;
const xToPix = (img: ImageData, x: number) =>
  Math.max(0, Math.min(img.width - 1, Math.round((x - img.x0) / img.dx - 0.5)));
const yToPix = (img: ImageData, y: number) =>
  Math.max(
    0,
    Math.min(img.height - 1, Math.round((y - img.y0) / img.dy - 0.5)),
  );

// ---------------------------------------------------------------------------
// Profile shape derivation
// ---------------------------------------------------------------------------

type PlotlyShape = Record<string, unknown>;

const SHAPE_LINE = {
  line: { color: "#ff8800", width: 2.5 },
  editable: true,
} as const;
const SHAPE_RECT = {
  line: { color: "#ff8800", width: 2 },
  fillcolor: "rgba(255,136,0,0.10)",
  editable: true,
} as const;
const SHAPE_MARKER = {
  line: { color: "#ff8800", width: 2 },
  fillcolor: "rgba(255,136,0,0.50)",
  editable: true,
} as const;

function buildShape(
  feature: ProfileFeatureId,
  values: Record<string, unknown>,
  img: ImageData,
): PlotlyShape | null {
  const xMin = img.x0;
  const xMax = img.x0 + img.width * img.dx;
  const yMin = img.y0;
  const yMax = img.y0 + img.height * img.dy;
  if (feature === "line_profile") {
    const direction = String(values.direction ?? "horizontal");
    if (direction === "horizontal") {
      const row = Number(values.row ?? 0);
      const y = pixToY(img, row);
      return {
        type: "line",
        xref: "x",
        yref: "y",
        x0: xMin,
        x1: xMax,
        y0: y,
        y1: y,
        ...SHAPE_LINE,
      };
    }
    const col = Number(values.col ?? 0);
    const x = pixToX(img, col);
    return {
      type: "line",
      xref: "x",
      yref: "y",
      x0: x,
      x1: x,
      y0: yMin,
      y1: yMax,
      ...SHAPE_LINE,
    };
  }
  if (feature === "segment_profile") {
    const r1 = Number(values.row1 ?? 0);
    const c1 = Number(values.col1 ?? 0);
    const r2 = Number(values.row2 ?? 0);
    const c2 = Number(values.col2 ?? 0);
    return {
      type: "line",
      xref: "x",
      yref: "y",
      x0: pixToX(img, c1),
      y0: pixToY(img, r1),
      x1: pixToX(img, c2),
      y1: pixToY(img, r2),
      ...SHAPE_LINE,
    };
  }
  if (feature === "average_profile") {
    const r1 = Number(values.row1 ?? 0);
    const c1 = Number(values.col1 ?? 0);
    let r2 = Number(values.row2 ?? -1);
    let c2 = Number(values.col2 ?? -1);
    if (r2 < 0) r2 = img.height - 1;
    if (c2 < 0) c2 = img.width - 1;
    return {
      type: "rect",
      xref: "x",
      yref: "y",
      x0: pixToX(img, c1) - img.dx / 2,
      y0: pixToY(img, r1) - img.dy / 2,
      x1: pixToX(img, c2) + img.dx / 2,
      y1: pixToY(img, r2) + img.dy / 2,
      ...SHAPE_RECT,
    };
  }
  // radial_profile — small square marker around (x0, y0)
  const x0 = Number(values.x0 ?? (xMin + xMax) / 2);
  const y0 = Number(values.y0 ?? (yMin + yMax) / 2);
  const sx = Math.max(img.dx, (xMax - xMin) * 0.04);
  const sy = Math.max(img.dy, (yMax - yMin) * 0.04);
  return {
    type: "rect",
    xref: "x",
    yref: "y",
    x0: x0 - sx,
    y0: y0 - sy,
    x1: x0 + sx,
    y1: y0 + sy,
    ...SHAPE_MARKER,
  };
}

// ---------------------------------------------------------------------------
// Shape ⇄ values (relayout handler)
// ---------------------------------------------------------------------------

function shapeToValues(
  feature: ProfileFeatureId,
  values: Record<string, unknown>,
  img: ImageData,
  patch: Record<string, unknown>,
): Record<string, unknown> | null {
  // Collect the four edges from either the new "shapes[0].*" patch keys
  // or the previous values if missing.
  const prev = buildShape(feature, values, img);
  if (!prev) return null;
  const numeric = (key: "x0" | "y0" | "x1" | "y1") => {
    const v = patch[key];
    return typeof v === "number" ? v : (prev[key] as number);
  };
  const x0 = numeric("x0");
  const y0 = numeric("y0");
  const x1 = numeric("x1");
  const y1 = numeric("y1");
  if (feature === "line_profile") {
    const direction = String(values.direction ?? "horizontal");
    if (direction === "horizontal") {
      // Use the average of y0/y1 (Plotly returns identical values for a
      // horizontal line, but be defensive).
      const row = yToPix(img, (y0 + y1) / 2);
      if (row === values.row) return null;
      return { ...values, row };
    }
    const col = xToPix(img, (x0 + x1) / 2);
    if (col === values.col) return null;
    return { ...values, col };
  }
  if (feature === "segment_profile") {
    const row1 = yToPix(img, y0);
    const col1 = xToPix(img, x0);
    const row2 = yToPix(img, y1);
    const col2 = xToPix(img, x1);
    return { ...values, row1, col1, row2, col2 };
  }
  if (feature === "average_profile") {
    // The shape is rendered with a half-pixel padding on each side; undo
    // it before re-quantising back to pixel indices.
    const row1 = yToPix(img, y0 + img.dy / 2);
    const col1 = xToPix(img, x0 + img.dx / 2);
    const row2 = yToPix(img, y1 - img.dy / 2);
    const col2 = xToPix(img, x1 - img.dx / 2);
    return {
      ...values,
      row1: Math.min(row1, row2),
      col1: Math.min(col1, col2),
      row2: Math.max(row1, row2),
      col2: Math.max(col1, col2),
    };
  }
  // radial_profile — center is the rectangle's centre.  Switch to
  // "user" mode so subsequent renders honour the dragged x0/y0.
  return {
    ...values,
    center: "user",
    x0: (x0 + x1) / 2,
    y0: (y0 + y1) / 2,
  };
}

// ---------------------------------------------------------------------------
// Dialog component
// ---------------------------------------------------------------------------

export function ProfileDefinitionDialog(props: Props) {
  const {
    title,
    featureId,
    payload,
    imageData,
    resolveChoices,
    onSubmit,
    onCancel,
  } = props;
  const [values, setValues] = useState<Record<string, unknown>>(payload.values);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const description = (payload.schema as JsonSchema).description as
    | string
    | undefined;

  const traces = useMemo(() => {
    const w = imageData.width;
    const h = imageData.height;
    const xs = Array.from(
      { length: w },
      (_, i) => imageData.x0 + (i + 0.5) * imageData.dx,
    );
    const ys = Array.from(
      { length: h },
      (_, j) => imageData.y0 + (j + 0.5) * imageData.dy,
    );
    return [
      {
        type: "heatmap" as const,
        z: imageData.data,
        x: xs,
        y: ys,
        zmin: imageData.data_min,
        zmax: imageData.data_max,
        colorscale: "Jet" as const,
        showscale: false,
      },
    ];
  }, [imageData]);

  const shape = useMemo(
    () => buildShape(featureId, values, imageData),
    [featureId, values, imageData],
  );

  const layout = useMemo(
    () => ({
      autosize: true,
      margin: { l: 50, r: 20, t: 20, b: 40 },
      xaxis: { constrain: "domain" as const },
      yaxis: {
        scaleanchor: "x" as const,
        scaleratio: imageData.dy / imageData.dx,
        autorange: "reversed" as const,
      },
      shapes: shape ? [shape] : [],
      paper_bgcolor: "var(--surface)",
      plot_bgcolor: "var(--surface)",
    }),
    [imageData, shape],
  );

  const handleRelayout = useCallback(
    (event: Record<string, unknown>) => {
      // Either single-shape live edit (``shapes[0].x0`` etc.) or a full
      // ``shapes`` array on drag-end / draw / erase.
      const patch: Record<string, unknown> = {};
      let touched = false;
      for (const key of Object.keys(event)) {
        const m = key.match(/^shapes\[0\]\.(x0|y0|x1|y1)$/);
        if (m) {
          patch[m[1]] = event[key];
          touched = true;
        }
      }
      if (
        !touched &&
        Array.isArray((event as { shapes?: unknown }).shapes) &&
        ((event as { shapes: unknown[] }).shapes.length ?? 0) > 0
      ) {
        const s0 = (event as { shapes: Record<string, unknown>[] }).shapes[0];
        for (const k of ["x0", "y0", "x1", "y1"] as const) {
          if (typeof s0[k] === "number") {
            patch[k] = s0[k];
            touched = true;
          }
        }
      }
      if (!touched) return;
      const next = shapeToValues(featureId, values, imageData, patch);
      if (next) setValues(next);
    },
    [featureId, values, imageData],
  );

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card profile-dialog">
        <h2>{title}</h2>
        {description && <p className="dataset-dialog-desc">{description}</p>}
        <div className="profile-dialog-body">
          <div className="profile-dialog-plot">
            <Plot
              data={traces as never}
              layout={layout as never}
              style={{ width: "100%", height: "100%" }}
              useResizeHandler
              config={
                {
                  responsive: true,
                  displaylogo: false,
                  editable: true,
                  edits: {
                    shapePosition: true,
                  },
                } as never
              }
              onRelayout={handleRelayout}
            />
          </div>
          <div className="profile-dialog-form">
            <DataSetForm
              schema={payload.schema}
              values={values}
              onChange={setValues}
              resolveChoices={resolveChoices}
            />
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button onClick={submit} disabled={submitting}>
            {submitting ? "Applying…" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
