/** Bundle-time index of Help-menu SVG icons. */

import { svgToDataUrl } from "./svgInline";

const modules = import.meta.glob<string>("../assets/icons/help/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});

const byName: Record<string, string> = {};
for (const [path, raw] of Object.entries(modules)) {
  const name = path.split("/").pop() ?? path;
  byName[name] = svgToDataUrl(raw);
}

export function getHelpIconUrl(
  name: string | undefined | null,
): string | undefined {
  if (!name) return undefined;
  return byName[name];
}
