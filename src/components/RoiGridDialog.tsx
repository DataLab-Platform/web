/**
 * Modal dialog for "ROI > Create ROI grid…" with a live preview.
 *
 * Mirrors DataLab desktop's :class:`ImageGridROIEditor`: the parameter
 * form is rendered on the left, an :class:`ImagePlot` preview of the
 * current image with the generated grid overlay on the right.  The
 * preview uses a TypeScript replica of
 * :func:`sigima.proc.image.generate_image_grid_roi`, so changes update
 * instantly without a Python round-trip.
 */

import { useMemo, useState } from "react";
import { DataSetForm } from "./DataSetForm";
import { ImagePlot } from "./ImagePlot";
import type {
  ImageData,
  ImageRoiSegment,
  JsonSchema,
  SchemaWithValues,
} from "../sigima/runtime";

interface Props {
  imageData: ImageData;
  payload: SchemaWithValues;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
}

/** TypeScript replica of ``sigima.proc.image.generate_image_grid_roi``.
 *
 *  Kept in lockstep with the Python implementation in
 *  :mod:`sigima.proc.image.extraction` (function
 *  ``generate_image_grid_roi``) so the live preview matches what the
 *  backend will produce on submit.
 */
export function computeRoiGridPreview(
  img: ImageData,
  values: Record<string, unknown>,
): ImageRoiSegment[] {
  const physW = img.width * img.dx;
  const physH = img.height * img.dy;
  const nx = Math.max(1, Math.trunc(Number(values.nx) || 1));
  const ny = Math.max(1, Math.trunc(Number(values.ny) || 1));
  const dxCell = physW / nx;
  const dyCell = physH / ny;
  const dx = (dxCell * (Number(values.xsize) || 0)) / 100;
  const dy = (dyCell * (Number(values.ysize) || 0)) / 100;
  const dxStep = (dxCell * (Number(values.xstep) || 100)) / 100;
  const dyStep = (dyCell * (Number(values.ystep) || 100)) / 100;
  const xtrans =
    (physW * ((Number(values.xtranslation) ?? 50) - 50)) / 100;
  const ytrans =
    (physH * ((Number(values.ytranslation) ?? 50) - 50)) / 100;
  const xdir = String(values.xdirection || "increasing");
  const ydir = String(values.ydirection || "increasing");
  const baseName = String(values.base_name ?? "ROI");
  const pattern = String(values.name_pattern ?? "{base}({r},{c})");

  const out: ImageRoiSegment[] = [];
  for (let ir = 0; ir < ny; ir++) {
    for (let ic = 0; ic < nx; ic++) {
      const x0 = img.x0 + (ic + 0.5) * dxStep + xtrans - 0.5 * dx;
      const y0 = img.y0 + (ir + 0.5) * dyStep + ytrans - 0.5 * dy;
      const r = (ydir === "decreasing" ? ny - 1 - ir : ir) + 1;
      const c = (xdir === "decreasing" ? nx - 1 - ic : ic) + 1;
      let title: string;
      try {
        title = pattern
          .replace("{base}", baseName)
          .replace("{r}", String(r))
          .replace("{c}", String(c));
      } catch {
        title = `ROI(${r},${c})`;
      }
      // Skip degenerate rectangles (size = 0) so the preview matches what
      // the backend will accept (it raises on dx<=0/dy<=0).
      if (dx > 0 && dy > 0) {
        out.push({
          geometry: "rectangle",
          title,
          inverse: false,
          x0,
          y0,
          dx,
          dy,
        });
      }
    }
  }
  return out;
}

export function RoiGridDialog(props: Props) {
  const { imageData, payload, onSubmit, onCancel } = props;
  const [values, setValues] = useState<Record<string, unknown>>(payload.values);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewRoi = useMemo(
    () => computeRoiGridPreview(imageData, values),
    [imageData, values],
  );

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

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card roi-grid-dialog">
        <h2>Create ROI grid</h2>
        {description && <p className="dataset-dialog-desc">{description}</p>}
        <div className="roi-grid-dialog-body">
          <div className="roi-grid-dialog-form">
            <DataSetForm
              schema={payload.schema}
              values={values}
              onChange={setValues}
            />
          </div>
          <div className="roi-grid-dialog-preview">
            <ImagePlot data={imageData} roi={previewRoi} />
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
