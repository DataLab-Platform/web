/**
 * Bundle-time index of every Analysis-menu SVG icon.  Mirrors
 * :file:`./createIcons.ts`.
 */

import { svgToDataUrl } from "./svgInline";

const modules = import.meta.glob<string>("../assets/icons/analysis/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});

const byName: Record<string, string> = {};
for (const [path, raw] of Object.entries(modules)) {
  const name = path.split("/").pop() ?? path;
  byName[name] = svgToDataUrl(raw);
}

export function getAnalysisIconUrl(
  name: string | undefined,
): string | undefined {
  if (!name) return undefined;
  return byName[name];
}
