/**
 * MultiImagePlot — read-only grid view shown when more than one image
 * is selected on the image panel.
 *
 * Mirrors PlotPy's behaviour in DataLab desktop: instead of forcing a
 * single-image viewer, the user sees every selected image side-by-side
 * (one heatmap per cell, two columns).  Each cell honours its own
 * colormap / invert / LUT and shows the image title above the heatmap.
 *
 * Heavy controls (Cross profiles, Contrast, Stats, ROI editing) are
 * intentionally disabled here — they only make sense on a single
 * image; pick one in the tree to bring back the full :class:`ImagePlot`.
 *
 * To keep the bridge payload bounded, the App only feeds at most
 * :const:`MULTI_IMAGE_LIMIT` images; an "+N more" banner is rendered
 * when the selection exceeds that limit.
 */

import Plot from "react-plotly.js";
import { usePlotlyTheme } from "../utils/plotlyTheme";
import type { ImageData } from "../runtime/runtime";

/** Maximum number of images rendered in the grid.  Each image's pixels
 *  are JSON-serialised across the Pyodide bridge, so the cap is mostly
 *  there to keep the payload below a few MB on typical scientific
 *  images. */
export const MULTI_IMAGE_LIMIT = 6;

interface Props {
  /** Images to render, in display order.  Truncate the list yourself
   *  to {@link MULTI_IMAGE_LIMIT}; this component will not slice it. */
  images: ImageData[];
  /** Total number of selected images (may exceed ``images.length``
   *  when capped).  Drives the "+N more" banner. */
  totalSelected: number;
}

export function MultiImagePlot({ images, totalSelected }: Props) {
  const plotlyTheme = usePlotlyTheme();
  if (images.length === 0) {
    return (
      <div className="multi-image-empty">
        Select at least one image in the tree to display it here.
      </div>
    );
  }
  const omitted = Math.max(0, totalSelected - images.length);
  return (
    <div className="multi-image-area">
      {omitted > 0 && (
        <div className="multi-image-banner">
          Showing {images.length} of {totalSelected} selected images. Pick a
          single image in the tree for full viewer tools.
        </div>
      )}
      <div className="multi-image-grid">
        {images.map((img) => (
          <MiniImage key={img.id} image={img} theme={plotlyTheme} />
        ))}
      </div>
    </div>
  );
}

function MiniImage({
  image,
  theme,
}: {
  image: ImageData;
  theme: ReturnType<typeof usePlotlyTheme>;
}) {
  const baseColormap = image.colormap || "Viridis";
  const colorscale = image.invert_colormap ? `${baseColormap}_r` : baseColormap;
  const x = Array.from(
    { length: image.width },
    (_, i) => image.x0 + (i + 0.5) * image.dx,
  );
  const y = Array.from(
    { length: image.height },
    (_, j) => image.y0 + (j + 0.5) * image.dy,
  );
  return (
    <div className="multi-image-cell">
      <div className="multi-image-title" title={image.title}>
        {image.title || image.id}
      </div>
      <Plot
        data={[
          {
            type: "heatmap" as const,
            z: image.data,
            x,
            y,
            zmin: image.data_min,
            zmax: image.data_max,
            colorscale: colorscale as unknown as "Viridis",
            showscale: true,
            colorbar: { thickness: 8 },
            hovertemplate:
              `${image.xlabel || "x"}: %{x}<br>` +
              `${image.ylabel || "y"}: %{y}<br>` +
              `${image.zlabel || "z"}: %{z}<extra></extra>`,
          },
        ]}
        layout={{
          ...theme,
          autosize: true,
          margin: { l: 40, r: 10, t: 10, b: 30 },
          xaxis: {
            ...theme.xaxis,
            constrain: "domain" as const,
          },
          yaxis: {
            ...theme.yaxis,
            scaleanchor: "x" as const,
            scaleratio: image.dy / image.dx,
            autorange: "reversed" as const,
          },
        }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
        config={
          {
            responsive: true,
            displaylogo: false,
            displayModeBar: false,
          } as never
        }
      />
    </div>
  );
}
