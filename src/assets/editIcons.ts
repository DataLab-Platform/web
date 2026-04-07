/** Bundle-time index of Edit-menu SVG icons. */

const modules = import.meta.glob<string>("../assets/icons/edit/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

const byName: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const name = path.split("/").pop() ?? path;
  byName[name] = url;
}

export function getEditIconUrl(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  return byName[name];
}
