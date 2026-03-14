/** ROI icon registry — mirrors createIcons / analysisIcons.
 *  Vite eagerly bundles every SVG so the URL is available synchronously
 *  for the menu builder. */

const icons = import.meta.glob("../assets/icons/roi/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const byName: Record<string, string> = {};
for (const [path, url] of Object.entries(icons)) {
  const m = path.match(/\/([^/]+)\.svg$/);
  if (m) byName[m[1]] = url;
}

export function getRoiIconUrl(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  return byName[name.replace(/\.svg$/i, "")];
}
