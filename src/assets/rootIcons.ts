/** Bundle-time index of root-level (uncategorised) SVG icons:
 *  ``properties.svg``, ``new_window.svg`` and other one-offs. */

import { svgToDataUrl } from "./svgInline";

const modules = import.meta.glob<string>("../assets/icons/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});

const byName: Record<string, string> = {};
for (const [path, raw] of Object.entries(modules)) {
  const name = path.split("/").pop() ?? path;
  byName[name] = svgToDataUrl(raw);
}

export function getRootIconUrl(
  name: string | undefined | null,
): string | undefined {
  if (!name) return undefined;
  return byName[name];
}
