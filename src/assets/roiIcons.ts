/** ROI icon registry — mirrors createIcons / analysisIcons.
 *  Vite eagerly bundles every SVG as inline ``data:`` URLs so they are
 *  available synchronously for the menu builder, with no per-icon request. */

import { svgToDataUrl } from "./svgInline";

const icons = import.meta.glob("../assets/icons/roi/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const byName: Record<string, string> = {};
for (const [path, raw] of Object.entries(icons)) {
  const m = path.match(/\/([^/]+)\.svg$/);
  if (m) byName[m[1]] = svgToDataUrl(raw);
}

export function getRoiIconUrl(
  name: string | undefined | null,
): string | undefined {
  if (!name) return undefined;
  return byName[name.replace(/\.svg$/i, "")];
}
