/**
 * Bundle-time index of every Create-menu SVG icon.
 *
 * Vite's :func:`import.meta.glob` (with ``eager: true``, ``query: "?raw"``)
 * returns a map ``{ "/abs/path/sine.svg": "<svg…>", ... }``.  We re-key it by
 * the bare filename so the Python catalogue can return ``"sine.svg"`` and
 * the React layer can resolve it to an inline ``data:`` URL.
 */

import { svgToDataUrl } from "./svgInline";

const modules = import.meta.glob<string>("../assets/icons/create/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});

const byName: Record<string, string> = {};
for (const [path, raw] of Object.entries(modules)) {
  const name = path.split("/").pop() ?? path;
  byName[name] = svgToDataUrl(raw);
}

export function getCreateIconUrl(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return byName[name];
}
