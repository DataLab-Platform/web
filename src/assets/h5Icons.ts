/**
 * Bundle-time index of every HDF5 browser SVG icon.
 *
 * Mirrors :mod:`createIcons` so the Python backend can return bare
 * filenames (``"h5group.svg"``) and the React layer resolves them to
 * inline ``data:`` URLs.
 */

import { svgToDataUrl } from "./svgInline";

const modules = import.meta.glob<string>("../assets/icons/h5/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});

const byName: Record<string, string> = {};
for (const [path, raw] of Object.entries(modules)) {
  const name = path.split("/").pop() ?? path;
  byName[name] = svgToDataUrl(raw);
}

export function getH5IconUrl(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return byName[name];
}
