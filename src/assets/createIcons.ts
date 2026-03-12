/**
 * Bundle-time index of every Create-menu SVG icon.
 *
 * Vite's :func:`import.meta.glob` (with ``eager: true``, ``query: "?url"``)
 * returns a map ``{ "/abs/path/sine.svg": url, ... }``.  We re-key it by
 * the bare filename so the Python catalogue can return ``"sine.svg"`` and
 * the React layer can resolve it to a deployable URL.
 */

const modules = import.meta.glob<string>("../assets/icons/create/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

const byName: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const name = path.split("/").pop() ?? path;
  byName[name] = url;
}

export function getCreateIconUrl(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return byName[name];
}
