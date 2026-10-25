/**
 * Coordinate helpers for non-uniform images (explicit per-column / per-row
 * pixel-center coordinates).
 *
 * Sigima images can be *non-uniform*: instead of a regular ``x0``/``dx`` grid
 * they carry explicit ``xcoords``/``ycoords`` arrays giving the physical
 * coordinate of each pixel **center**.  To render them exactly (matching the
 * desktop PlotPy ``XYImageItem``) the viewer needs the **bin edges** — the
 * boundaries between cells — which is what Plotly's ``heatmap`` trace expects
 * for its ``x``/``y`` arrays.
 *
 * The conversion below mirrors PlotPy's ``to_bins`` (plotpy/items/image/
 * filter.py) bit-for-bit so DataLab-Web and DataLab desktop place cell
 * boundaries identically.
 */

/**
 * Convert an array of pixel-center coordinates to bin edges.
 *
 * Given ``n`` centers, returns ``n + 1`` edges:
 * - interior edges are the midpoints between consecutive centers;
 * - the first/last edges extend the first/last cell by half its width;
 * - a single center yields a cell of width 1 centered on the point.
 *
 * Mirrors PlotPy's ``to_bins`` exactly. The input is assumed to be sorted in
 * increasing order (as Sigima stores non-uniform coordinates).
 *
 * @param centers Pixel-center coordinates (length ``n``).
 * @returns Bin edges (length ``n + 1``).
 */
export function toBins(centers: ArrayLike<number>): number[] {
  const n = centers.length;
  if (n === 0) return [];
  const edges = new Array<number>(n + 1);
  if (n === 1) {
    edges[0] = centers[0] - 0.5;
    edges[1] = centers[0] + 0.5;
    return edges;
  }
  for (let i = 1; i < n; i += 1) {
    edges[i] = (centers[i - 1] + centers[i]) / 2;
  }
  edges[0] = centers[0] - (centers[1] - centers[0]) / 2;
  edges[n] = centers[n - 1] + (centers[n - 1] - centers[n - 2]) / 2;
  return edges;
}
