/**
 * Bundle-time index of every feature SVG icon (Operations, Processing, Fit).
 *
 * Same convention as :file:`./createIcons.ts`: Vite's
 * :func:`import.meta.glob` indexes the SVGs by absolute path; we re-key by
 * bare filename so the Python catalogue can return ``"normalize.svg"`` and
 * the React layer resolves it to a deployable URL.
 *
 * The three sub-categories (``operations``, ``processing``, ``fit``) share a
 * single namespace because the bare filenames are unique across them — this
 * mirrors the way DataLab desktop's :func:`get_icon` resolves icon names.
 */

import { svgToDataUrl } from "./svgInline";

const operations = import.meta.glob<string>(
  "../assets/icons/operations/*.svg",
  { eager: true, query: "?raw", import: "default" },
);
const processing = import.meta.glob<string>(
  "../assets/icons/processing/*.svg",
  { eager: true, query: "?raw", import: "default" },
);
const fit = import.meta.glob<string>("../assets/icons/fit/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});

const byName: Record<string, string> = {};
for (const modules of [operations, processing, fit]) {
  for (const [path, raw] of Object.entries(modules)) {
    const name = path.split("/").pop() ?? path;
    byName[name] = svgToDataUrl(raw);
  }
}

export function getFeatureIconUrl(
  name: string | undefined | null,
): string | undefined {
  if (!name) return undefined;
  return byName[name];
}
