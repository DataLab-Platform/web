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
import {
  type Axis,
  PIXEL_INDEX_TOLERANCE,
  axisToFloatIndex,
  axisToPhysical,
} from "../utils/pixelCenters";
import type {
  ImageData,
  ImageRoiSegment,
  JsonSchema,
  SchemaWithValues,
} from "../runtime/runtime";

interface Props {
  imageData: ImageData;
  payload: SchemaWithValues;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
}

/** Pixels of a grid cell along an axis: those whose centers lie in
 *  ``[start, end[`` (Sigima's ``_cell_pixel_range``), so that adjacent cells
 *  never share a pixel.  Returns ``[i0, i1]``, not clipped to the image. */
function cellPixelRange(
  img: ImageData,
  axis: Axis,
  start: number,
  end: number,
): [number, number] {
  const i0 = Math.ceil(
    axisToFloatIndex(img, axis, start) - PIXEL_INDEX_TOLERANCE,
  );
  const i1 = Math.ceil(
    axisToFloatIndex(img, axis, end) - PIXEL_INDEX_TOLERANCE,
  );
  return [i0, Math.max(i0, i1)];
}

/** Physical interval covering pixels ``i0`` to ``i1 - 1`` along an axis, up to
 *  their outer edges (Sigima's ``pixel_range_to_physical``). */
function pixelRangeToPhysical(
  img: ImageData,
  axis: Axis,
  i0: number,
  i1: number,
): [number, number] {
  const a = axisToPhysical(img, axis, i0 - 0.5);
  const b = axisToPhysical(img, axis, i1 - 0.5);
  return [Math.min(a, b), Math.max(a, b)];
}

/** Numeric grid parameter, or its default when missing (``0`` is kept). */
function gridNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** TypeScript replica of ``sigima.proc.image.generate_image_grid_roi``.
 *
 *  Kept in lockstep with the Python implementation in
 *  :mod:`sigima.proc.image.extraction` (function
 *  ``generate_image_grid_roi``) so the live preview matches what the
 *  backend will produce on submit: the grid spans the image up to the outer
 *  edges of its pixels, each cell is made of the pixels whose centers lie in
 *  it, and each rectangle goes to the outer edges of its pixels.
 */
export function computeRoiGridPreview(
  img: ImageData,
  values: Record<string, unknown>,
): ImageRoiSegment[] {
  const left = axisToPhysical(img, "x", -0.5);
  const right = axisToPhysical(img, "x", img.width - 0.5);
  const top = axisToPhysical(img, "y", -0.5);
  const bottom = axisToPhysical(img, "y", img.height - 0.5);
  const physW = right - left;
  const physH = bottom - top;
  const nx = Math.max(1, Math.trunc(gridNumber(values.nx, 1)));
  const ny = Math.max(1, Math.trunc(gridNumber(values.ny, 1)));
  const dxCell = physW / nx;
  const dyCell = physH / ny;
  const dx = (dxCell * gridNumber(values.xsize, 0)) / 100;
  const dy = (dyCell * gridNumber(values.ysize, 0)) / 100;
  const dxStep = (dxCell * gridNumber(values.xstep, 100)) / 100;
  const dyStep = (dyCell * gridNumber(values.ystep, 100)) / 100;
  const xtrans = (physW * (gridNumber(values.xtranslation, 50) - 50)) / 100;
  const ytrans = (physH * (gridNumber(values.ytranslation, 50) - 50)) / 100;
  const xdir = String(values.xdirection || "increasing");
  const ydir = String(values.ydirection || "increasing");
  const baseName = String(values.base_name ?? "ROI");
  const pattern = String(values.name_pattern ?? "{base}({r},{c})");

  const out: ImageRoiSegment[] = [];
  for (let ir = 0; ir < ny; ir++) {
    for (let ic = 0; ic < nx; ic++) {
      const x0 = left + (ic + 0.5) * dxStep + xtrans - 0.5 * dx;
      const y0 = top + (ir + 0.5) * dyStep + ytrans - 0.5 * dy;
      const [ix0, ix1] = cellPixelRange(img, "x", x0, x0 + dx);
      const [iy0, iy1] = cellPixelRange(img, "y", y0, y0 + dy);
      const [rx0, rx1] = pixelRangeToPhysical(img, "x", ix0, ix1);
      const [ry0, ry1] = pixelRangeToPhysical(img, "y", iy0, iy1);
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
      // Cells holding no pixel are kept as empty rectangles, like Sigima.
      out.push({
        geometry: "rectangle",
        title,
        inverse: false,
        x0: rx0,
        y0: ry0,
        dx: rx1 - rx0,
        dy: ry1 - ry0,
      });
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
    string | undefined;

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
