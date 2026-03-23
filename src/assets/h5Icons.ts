/**
 * Bundle-time index of every HDF5 browser SVG icon.
 *
 * Mirrors :mod:`createIcons` so the Python backend can return bare
 * filenames (``"h5group.svg"``) and the React layer resolves them to
 * deployable URLs.
 */

const modules = import.meta.glob<string>("../assets/icons/h5/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

const byName: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const name = path.split("/").pop() ?? path;
  byName[name] = url;
}

export function getH5IconUrl(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return byName[name];
}
