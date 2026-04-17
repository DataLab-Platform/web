/**
 * Bundle-time index of every Analysis-menu SVG icon.  Mirrors
 * :file:`./createIcons.ts`.
 */

const modules = import.meta.glob<string>("../assets/icons/analysis/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

const byName: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const name = path.split("/").pop() ?? path;
  byName[name] = url;
}

export function getAnalysisIconUrl(
  name: string | undefined,
): string | undefined {
  if (!name) return undefined;
  return byName[name];
}
