/**
 * Pixel centers of an image, following the Sigima convention: ``x0``/``y0``
 * are the physical coordinates of the center of the first pixel, and images
 * with non-uniform coordinates carry the centers in ``xcoords``/``ycoords``.
 *
 * Sigima computations (profiles, ROIs, analyses) use these coordinates.
 */

import type { ImageData } from "../runtime/runtime";

/** Physical coordinates of the pixel centers along an axis. */
export function pixelCenters(
  img: Pick<
    ImageData,
    | "width"
    | "height"
    | "x0"
    | "y0"
    | "dx"
    | "dy"
    | "is_uniform_coords"
    | "xcoords"
    | "ycoords"
  >,
  axis: "x" | "y",
): number[] {
  const coords = axis === "x" ? img.xcoords : img.ycoords;
  const size = axis === "x" ? img.width : img.height;
  if (img.is_uniform_coords === false && coords?.length === size) {
    return coords;
  }
  const origin = axis === "x" ? img.x0 : img.y0;
  const step = axis === "x" ? img.dx : img.dy;
  return Array.from({ length: size }, (_, i) => origin + i * step);
}
