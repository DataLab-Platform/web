/**
 * MultiImagePlot — read-only grid view shown when more than one image
 * is selected on the image panel.
 *
 * Mirrors PlotPy's behaviour in DataLab desktop: instead of forcing a
 * single-image viewer, the user sees every selected image side-by-side
 * (one canvas thumbnail per cell) along with the image title.  Each
 * cell honours its own colormap / invert / LUT.
 *
 * Heavy controls (Cross profiles, Contrast, Stats, ROI editing) are
 * intentionally disabled here — they only make sense on a single
 * image; pick one in the tree to bring back the full :class:`ImagePlot`.
 *
 * Implementation note:
 *   The grid used to render each cell with Plotly's SVG ``heatmap``
 *   trace.  For four 1024×1024 default images that pushed several
 *   million SVG elements through React/DOM and dominated perceived
 *   latency.  We now paint the colormapped pixels directly into a
 *   ``<canvas>`` (closed-form polynomial colormap, see
 *   ``utils/colormap.ts``) — typically 50–100× faster while keeping
 *   the same visual fidelity at preview resolutions.
 */

import { memo, useEffect, useRef, useState } from "react";
import { paintImageData } from "../utils/colormap";
import type { ImageData } from "../runtime/runtime";

/** Maximum number of images rendered in the grid.  Each image's pixels
 *  are JSON-serialised across the Pyodide bridge, so the cap is mostly
 *  there to keep the payload below a few MB on typical scientific
 *  images. */
export const MULTI_IMAGE_LIMIT = 6;

/** Largest image dimension (in pixels) requested from the runtime when
 *  building the grid.  Cells render at a few hundred CSS pixels so
 *  pushing more than this just wastes bridge bandwidth and canvas
 *  paint time without any perceptible quality gain.  See
 *  :func:`get_images_data` in ``bootstrap.py`` for the server-side
 *  decimation logic. */
export const MULTI_IMAGE_MAX_SIZE = 512;

interface Props {
  /** Images to render, in display order.  Truncate the list yourself
   *  to {@link MULTI_IMAGE_LIMIT}; this component will not slice it. */
  images: ImageData[];
  /** Total number of selected images (may exceed ``images.length``
   *  when capped).  Drives the "+N more" banner. */
  totalSelected: number;
}

export function MultiImagePlot({ images, totalSelected }: Props) {
  if (images.length === 0) {
    return (
      <div className="multi-image-empty">
        Select at least one image in the tree to display it here.
      </div>
    );
  }
  const omitted = Math.max(0, totalSelected - images.length);
  // Defensive dedupe: cells are keyed by object id, so any duplicate id
  // in the incoming list would trigger React "duplicate key" warnings and
  // a reconciliation loop. The selection state is deduped upstream
  // (`setSelectedIds` in App), but guard here too so the grid stays
  // robust regardless of caller.
  const uniqueImages =
    new Set(images.map((img) => img.id)).size === images.length
      ? images
      : images.filter(
          (img, i) => images.findIndex((o) => o.id === img.id) === i,
        );
  return (
    <div className="multi-image-area">
      {omitted > 0 && (
        <div className="multi-image-banner">
          Showing {images.length} of {totalSelected} selected images. Pick a
          single image in the tree for full viewer tools.
        </div>
      )}
      <div className="multi-image-grid">
        {uniqueImages.map((img) => (
          <MiniImage key={img.id} image={img} />
        ))}
      </div>
    </div>
  );
}

/**
 * Single grid cell: title + colormapped canvas + on-hover pixel
 * inspector.  Aspect ratio is preserved via CSS so non-square images
 * remain readable.
 */
function MiniImageImpl({ image }: { image: ImageData }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    z: number;
  } | null>(null);

  // Paint once per image change.  Using ``image.id`` + the LUT-relevant
  // fields as the dependency list ensures we re-paint when the user
  // tweaks contrast / colormap from the focused viewer and switches
  // back to the multi-selection.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = image.width;
    const h = image.height;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const data = image.data;
    // Fast path: bridge ships a list of ``Float32Array`` rows that
    // share one underlying ``ArrayBuffer`` — flatten by aliasing the
    // first row's buffer over the full ``H*W`` extent.  Falls back to
    // nested-array iteration for the legacy ``number[][]`` payload.
    let flat: Float32Array | ArrayLike<ArrayLike<number>>;
    if (Array.isArray(data) && data[0] instanceof Float32Array) {
      const first = data[0] as Float32Array;
      flat = new Float32Array(first.buffer, first.byteOffset, w * h);
    } else {
      flat = data as ArrayLike<ArrayLike<number>>;
    }
    const img = paintImageData(
      ctx,
      flat,
      w,
      h,
      image.data_min,
      image.data_max,
      image.colormap || "Viridis",
      Boolean(image.invert_colormap),
    );
    ctx.putImageData(img, 0, 0);
  }, [
    image.id,
    image.width,
    image.height,
    image.data,
    image.data_min,
    image.data_max,
    image.colormap,
    image.invert_colormap,
  ]);

  const handleMouseMove = (evt: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const i = Math.floor(
      ((evt.clientX - rect.left) / rect.width) * image.width,
    );
    const j = Math.floor(
      ((evt.clientY - rect.top) / rect.height) * image.height,
    );
    if (i < 0 || i >= image.width || j < 0 || j >= image.height) {
      setHover(null);
      return;
    }
    // Non-uniform images carry explicit pixel-center coordinates; report
    // those exactly instead of the default ``x0 + (i+0.5)·dx`` grid (which
    // would otherwise collapse to raw pixel indices).
    const xc = image.xcoords;
    const yc = image.ycoords;
    const x =
      image.is_uniform_coords === false && xc?.length
        ? xc[i]
        : image.x0 + (i + 0.5) * image.dx;
    const y =
      image.is_uniform_coords === false && yc?.length
        ? yc[j]
        : image.y0 + (j + 0.5) * image.dy;
    const data = image.data;
    let z: number;
    if (Array.isArray(data) && data[0] instanceof Float32Array) {
      z = (data[j] as Float32Array)[i];
    } else {
      z = (data as number[][])[j][i];
    }
    setHover({ x, y, z });
  };

  const aspectRatio = (image.height * image.dy) / (image.width * image.dx);
  return (
    <div className="multi-image-cell">
      <div className="multi-image-title" title={image.title}>
        {image.title || image.id}
      </div>
      <div
        className="multi-image-canvas-wrap"
        style={{ aspectRatio: `${1 / aspectRatio}` }}
      >
        <canvas
          ref={canvasRef}
          className="multi-image-canvas"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHover(null)}
        />
        {hover && (
          <div className="multi-image-hover">
            {image.xlabel || "x"}: {formatNum(hover.x)} · {image.ylabel || "y"}:{" "}
            {formatNum(hover.y)} · {image.zlabel || "z"}: {formatNum(hover.z)}
          </div>
        )}
      </div>
    </div>
  );
}

function formatNum(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) return v.toExponential(3);
  return v.toFixed(abs >= 100 ? 1 : abs >= 1 ? 3 : 4);
}

/**
 * Memoised cell — the grid re-renders on every panel-state change
 * (selection, theme, ROI overlays on neighbouring images, …) but the
 * canvas only depends on ``image`` identity.  ``React.memo`` with
 * shallow equality on the props skips the costly canvas re-paint when
 * nothing relevant changed.
 */
const MiniImage = memo(MiniImageImpl);
