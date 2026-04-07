/** Bundle-time index of root-level (uncategorised) SVG icons:
 *  ``properties.svg``, ``new_window.svg`` and other one-offs. */

const modules = import.meta.glob<string>("../assets/icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

const byName: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const name = path.split("/").pop() ?? path;
  byName[name] = url;
}

export function getRootIconUrl(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  return byName[name];
}
