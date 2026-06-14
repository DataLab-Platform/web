/**
 * MultiImageSpatialPlot — spatial overlay view shown when more than one
 * image is selected and the user switches the multi-image view to
 * "spatial" mode.
 *
 * Unlike :class:`MultiImagePlot` (a CSS grid of independent thumbnails
 * that ignores each image's origin), this view renders every selected
 * image into a single Plotly plot, positioned according to its physical
 * ``x0``/``y0``/``dx``/``dy`` coordinates — mirroring DataLab desktop's
 * PlotPy behaviour, where all selected images share one coordinate
 * space.
 *
 * This is what makes the "Distribute on a grid" / "Reset image
 * positions" geometry tools observable in the browser: those tools only
 * mutate the images' origin coordinates, so the change is invisible in
 * the CSS-grid preview but plainly visible here.
 *
 * Implementation mirrors :class:`ImagePlot`: uniform images are
 * pre-rasterised into an off-screen ``<canvas>`` (closed-form colormap,
 * see ``utils/colormap.ts``) and handed to a Plotly ``image`` trace as a
 * ``data:`` URL — far faster than a ``heatmap`` trace on large arrays.
 * Non-uniform images (variable pixel spacing) fall back to a ``heatmap``
 * trace using their explicit pixel-center coordinates.
 *
 * Heavy single-image controls (contrast, profiles, stats, ROI editing)
 * are intentionally absent — pick a single image in the tree to bring
 * back the full :class:`ImagePlot`.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import { usePlotlyTheme } from "../utils/plotlyTheme";
import { paintImageData, buildColorscale } from "../utils/colormap";
import { t } from "../i18n/translate";
import type { ImageData } from "../runtime/runtime";

interface Props {
  /** Images to render, in display order (primary first, then selected
   *  extras).  Later images are drawn on top, matching PlotPy's z-order
   *  by selection order. */
  images: ImageData[];
  /** Total number of selected images (may exceed ``images.length`` when
   *  capped upstream).  Drives the "+N more" banner. */
  totalSelected: number;
}

/** Physical extent of an image in data coordinates. */
interface Extent {
  xLo: number;
  xHi: number;
  yLo: number;
  yHi: number;
}

function imageExtent(img: ImageData): Extent {
  if (img.is_uniform_coords === false && img.xcoords?.length) {
    const xc = img.xcoords;
    const yc = img.ycoords ?? [];
    return {
      xLo: Math.min(xc[0], xc[xc.length - 1]),
      xHi: Math.max(xc[0], xc[xc.length - 1]),
      yLo: Math.min(yc[0] ?? 0, yc[yc.length - 1] ?? 0),
      yHi: Math.max(yc[0] ?? 0, yc[yc.length - 1] ?? 0),
    };
  }
  const x1 = img.x0 + img.width * img.dx;
  const y1 = img.y0 + img.height * img.dy;
  return {
    xLo: Math.min(img.x0, x1),
    xHi: Math.max(img.x0, x1),
    yLo: Math.min(img.y0, y1),
    yHi: Math.max(img.y0, y1),
  };
}

/** Flatten the bridge payload (list of ``Float32Array`` rows sharing one
 *  buffer) into a single contiguous view, or fall back to the nested
 *  ``number[][]`` form.  Same fast path as :class:`MultiImagePlot`. */
function flatten(
  data: ImageData["data"],
  w: number,
  h: number,
): Float32Array | ArrayLike<ArrayLike<number>> {
  if (Array.isArray(data) && data[0] instanceof Float32Array) {
    const first = data[0] as Float32Array;
    return new Float32Array(first.buffer, first.byteOffset, w * h);
  }
  return data as ArrayLike<ArrayLike<number>>;
}

/** Rasterise a uniform image into a PNG ``data:`` URL using its own
 *  colormap / LUT.  Returns ``null`` for degenerate sizes. */
function rasterise(img: ImageData): string | null {
  const w = img.width;
  const h = img.height;
  if (w <= 0 || h <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const flat = flatten(img.data, w, h);
  const painted = paintImageData(
    ctx,
    flat,
    w,
    h,
    img.data_min,
    img.data_max,
    img.colormap || "Viridis",
    Boolean(img.invert_colormap),
  );
  ctx.putImageData(painted, 0, 0);
  return canvas.toDataURL("image/png");
}

function MultiImageSpatialPlotImpl({ images, totalSelected }: Props) {
  const plotlyTheme = usePlotlyTheme();

  // Defensive dedupe (same rationale as MultiImagePlot): duplicate ids
  // would otherwise produce overlapping traces keyed identically.
  const uniqueImages = useMemo(() => {
    if (new Set(images.map((i) => i.id)).size === images.length) return images;
    return images.filter(
      (img, i) => images.findIndex((o) => o.id === img.id) === i,
    );
  }, [images]);

  // Rasterise every uniform image to a data URL.  Keyed by image id plus
  // the LUT-relevant fields so a contrast / colormap tweak from the
  // focused viewer re-rasterises on return.  Non-uniform images are left
  // out (rendered by a heatmap trace instead).
  const rasterKey = uniqueImages
    .map(
      (i) =>
        `${i.id}:${i.data_min}:${i.data_max}:${i.colormap}:${i.invert_colormap}`,
    )
    .join("|");
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const img of uniqueImages) {
      if (img.is_uniform_coords === false) continue;
      const url = rasterise(img);
      if (url) next[img.id] = url;
    }
    setUrls(next);
    // ``rasterKey`` captures every field that affects the bitmap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rasterKey]);

  // Global bounding box across all images, with a small margin so edges
  // are not flush against the axes.
  const range = useMemo(() => {
    if (uniqueImages.length === 0) return null;
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const img of uniqueImages) {
      const e = imageExtent(img);
      xMin = Math.min(xMin, e.xLo);
      xMax = Math.max(xMax, e.xHi);
      yMin = Math.min(yMin, e.yLo);
      yMax = Math.max(yMax, e.yHi);
    }
    const mx = (xMax - xMin) * 0.02 || 1;
    const my = (yMax - yMin) * 0.02 || 1;
    return {
      x: [xMin - mx, xMax + mx] as [number, number],
      // Y axis reversed: images use the top-left corner as origin.
      y: [yMax + my, yMin - my] as [number, number],
    };
  }, [uniqueImages]);

  const traces = useMemo(() => {
    const out: unknown[] = [];
    for (const img of uniqueImages) {
      if (img.is_uniform_coords === false && img.xcoords?.length) {
        // Non-uniform fallback: heatmap positioned by explicit pixel
        // centers.  Carries its own colorbar via the colorscale.
        out.push({
          type: "heatmap" as const,
          z: img.data,
          x: img.xcoords,
          y: img.ycoords,
          zmin: img.data_min,
          zmax: img.data_max,
          colorscale: buildColorscale(
            img.colormap || "Viridis",
            Boolean(img.invert_colormap),
          ) as unknown as "Viridis",
          showscale: false,
          hoverinfo: "skip" as const,
        });
        continue;
      }
      const url = urls[img.id];
      if (!url) continue;
      out.push({
        type: "image" as const,
        source: url,
        // ``image`` traces anchor at the upper-left of the first pixel
        // (no half-pixel offset, unlike ``heatmap``).
        x0: img.x0,
        dx: img.dx,
        y0: img.y0,
        dy: img.dy,
        hoverinfo: "skip" as const,
      });
    }
    return out;
  }, [uniqueImages, urls]);

  // ------------------------------------------------------------------
  // Custom hover: ``image`` traces emit no ``plotly_hover`` events, so
  // we convert client pixels → data coords via the resolved layout and
  // look up the value in the *topmost* image covering that point.
  // ------------------------------------------------------------------
  const gdRef = useRef<
    | (HTMLElement & {
        _fullLayout?: {
          xaxis?: { p2c: (px: number) => number; _offset?: number };
          yaxis?: { p2c: (px: number) => number; _offset?: number };
        };
      })
    | null
  >(null);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    z: number;
    img: ImageData;
  } | null>(null);

  const handleMouseMove = (evt: React.MouseEvent<HTMLDivElement>) => {
    const gd = gdRef.current;
    const fl = gd?._fullLayout;
    const xa = fl?.xaxis;
    const ya = fl?.yaxis;
    if (!gd || !xa || !ya || xa._offset == null || ya._offset == null) return;
    const rect = gd.getBoundingClientRect();
    const dataX = xa.p2c(evt.clientX - rect.left - xa._offset);
    const dataY = ya.p2c(evt.clientY - rect.top - ya._offset);
    // Topmost image (last drawn) wins.
    for (let k = uniqueImages.length - 1; k >= 0; k -= 1) {
      const img = uniqueImages[k];
      const e = imageExtent(img);
      if (dataX < e.xLo || dataX > e.xHi || dataY < e.yLo || dataY > e.yHi) {
        continue;
      }
      const i = Math.floor((dataX - img.x0) / img.dx);
      const j = Math.floor((dataY - img.y0) / img.dy);
      if (i < 0 || i >= img.width || j < 0 || j >= img.height) continue;
      const d = img.data;
      let z: number;
      if (Array.isArray(d) && d[0] instanceof Float32Array) {
        z = (d[j] as Float32Array)[i];
      } else {
        z = (d as number[][])[j][i];
      }
      setHover({ x: dataX, y: dataY, z, img });
      return;
    }
    setHover(null);
  };

  if (uniqueImages.length === 0 || !range) {
    return (
      <div className="multi-image-empty">
        {t("Select at least one image in the tree to display it here.")}
      </div>
    );
  }

  const omitted = Math.max(0, totalSelected - uniqueImages.length);

  const layout = {
    ...plotlyTheme,
    autosize: true,
    margin: { l: 60, r: 30, t: 20, b: 50 },
    xaxis: {
      ...plotlyTheme.xaxis,
      range: range.x,
      autorange: false as const,
      constrain: "domain" as const,
    },
    yaxis: {
      ...plotlyTheme.yaxis,
      range: range.y,
      autorange: false as const,
      scaleanchor: "x" as const,
      scaleratio: 1,
    },
    showlegend: false,
  };

  return (
    <div className="multi-image-area">
      {omitted > 0 && (
        <div className="multi-image-banner">
          {t("Showing {shown} of {total} selected images.", {
            shown: uniqueImages.length,
            total: totalSelected,
          })}
        </div>
      )}
      <div
        className="multi-image-spatial-wrap"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        <Plot
          data={traces as never}
          layout={layout as never}
          config={{ displaylogo: false, responsive: true } as never}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler
          onInitialized={(_fig, gd) => {
            gdRef.current = gd as unknown as typeof gdRef.current;
          }}
          onUpdate={(_fig, gd) => {
            gdRef.current = gd as unknown as typeof gdRef.current;
          }}
        />
        {hover && (
          <div className="multi-image-hover">
            {hover.img.xlabel || "x"}: {formatNum(hover.x)} ·{" "}
            {hover.img.ylabel || "y"}: {formatNum(hover.y)} ·{" "}
            {hover.img.zlabel || "z"}: {formatNum(hover.z)}
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

export const MultiImageSpatialPlot = memo(MultiImageSpatialPlotImpl);
