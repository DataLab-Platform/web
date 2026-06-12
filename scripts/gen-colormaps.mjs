/**
 * Generate ``src/utils/colormapData.ts`` from PlotPy's default colormap
 * definitions.
 *
 * PlotPy is NOT a build dependency of DataLab-Web, so this script is a
 * one-shot / maintenance tool: it reads PlotPy's committed
 * ``plotpy/data/colormaps_default.json`` (a sibling checkout) and emits a
 * self-contained, committed TypeScript module.  The generated module is the
 * single source of truth at runtime; this script only needs to be re-run when
 * PlotPy ships new or changed default colormaps.
 *
 * Usage:
 *
 *   node scripts/gen-colormaps.mjs [path/to/colormaps_default.json]
 *
 * Smooth colormaps (256 stops) are simplified by removing stops that lie on
 * (within ``RGB_TOL`` of) the straight RGB line between their kept neighbours.
 * Qualitative colormaps encode hard transitions as duplicated positions
 * (``[t, A], [t, B]``); the collinearity test naturally preserves those (a
 * duplicated position is a sharp corner, never collinear), so the same pass is
 * safe for every map.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Max per-channel deviation (0..255) tolerated when dropping a stop. */
const RGB_TOL = 1.5;

/** Default location of PlotPy's colormap data (sibling checkout). */
const DEFAULT_SOURCE = resolve(
  __dirname,
  "..",
  "..",
  "PlotPy",
  "plotpy",
  "data",
  "colormaps_default.json",
);

const OUTPUT = resolve(__dirname, "..", "src", "utils", "colormapData.ts");

/**
 * Ordered colormap categories, mirroring matplotlib's reference grouping.
 * Names not listed here (but present in the JSON) are appended under "Other".
 */
const CATEGORIES = [
  {
    label: "Perceptually uniform",
    names: ["viridis", "plasma", "inferno", "magma", "cividis"],
  },
  {
    label: "Sequential",
    names: [
      "greys",
      "purples",
      "blues",
      "greens",
      "oranges",
      "reds",
      "ylorbr",
      "ylorrd",
      "orrd",
      "purd",
      "rdpu",
      "bupu",
      "gnbu",
      "pubu",
      "ylgnbu",
      "pubugn",
      "bugn",
      "ylgn",
      "binary",
      "gist_yarg",
      "gist_gray",
      "gray",
      "bone",
      "pink",
      "spring",
      "summer",
      "autumn",
      "winter",
      "cool",
      "hot",
      "afmhot",
      "gist_heat",
      "copper",
    ],
  },
  {
    label: "Diverging",
    names: [
      "piyg",
      "prgn",
      "brbg",
      "puor",
      "rdgy",
      "rdbu",
      "rdylbu",
      "rdylgn",
      "spectral",
      "coolwarm",
      "bwr",
      "seismic",
    ],
  },
  {
    label: "Cyclic",
    names: ["hsv"],
  },
  {
    label: "Qualitative",
    names: [
      "pastel1",
      "pastel2",
      "paired",
      "accent",
      "dark2",
      "set1",
      "set2",
      "set3",
    ],
  },
  {
    label: "Miscellaneous",
    names: [
      "flag",
      "prism",
      "gist_earth",
      "gist_stern",
      "gnuplot2",
      "cmrmap",
      "gist_rainbow",
      "rainbow",
      "jet",
      "turbo",
      "gist_ncar",
    ],
  },
];

/** Parse ``#rrggbb`` into ``[r, g, b]`` (0..255 integers). */
function hexToRgb(hex) {
  const s = hex.replace(/^#/, "");
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

/** Linearly interpolate channel value at position ``t`` on segment a→b. */
function lerpAt(a, b, t) {
  const span = b[0] - a[0];
  if (span <= 0) return a.slice(1); // zero-width segment → step
  const f = (t - a[0]) / span;
  return [
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
    a[3] + (b[3] - a[3]) * f,
  ];
}

/**
 * Greedily drop interior stops that lie within ``RGB_TOL`` of the straight
 * RGB line between the last kept stop and the next candidate.  Endpoints are
 * always kept.  Each stop is ``[t, r, g, b]``.
 */
function simplify(stops) {
  if (stops.length <= 2) return stops;
  const out = [stops[0]];
  let anchor = 0;
  while (anchor < stops.length - 1) {
    let best = anchor + 1;
    for (let j = anchor + 2; j < stops.length; j += 1) {
      let ok = true;
      for (let k = anchor + 1; k < j; k += 1) {
        const [r, g, b] = lerpAt(stops[anchor], stops[j], stops[k][0]);
        if (
          Math.abs(r - stops[k][1]) > RGB_TOL ||
          Math.abs(g - stops[k][2]) > RGB_TOL ||
          Math.abs(b - stops[k][3]) > RGB_TOL
        ) {
          ok = false;
          break;
        }
      }
      if (ok) best = j;
      else break;
    }
    out.push(stops[best]);
    anchor = best;
  }
  return out;
}

/** Round a position to at most 6 significant decimals, dropping trailing 0s. */
function roundT(t) {
  return Number(t.toFixed(6));
}

function main() {
  const sourcePath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : DEFAULT_SOURCE;
  const raw = JSON.parse(readFileSync(sourcePath, "utf-8"));

  // Build the ordered name list: categorised names first (in declared order),
  // then any leftover JSON keys under "Other".
  const present = new Set(Object.keys(raw));
  const categories = [];
  const ordered = [];
  for (const cat of CATEGORIES) {
    const names = cat.names.filter((n) => present.has(n));
    if (names.length === 0) continue;
    categories.push({ label: cat.label, names });
    ordered.push(...names);
  }
  const leftover = Object.keys(raw).filter((n) => !ordered.includes(n));
  if (leftover.length > 0) {
    categories.push({ label: "Other", names: leftover });
    ordered.push(...leftover);
  }

  // Simplify each colormap's stops.
  const data = {};
  let rawStops = 0;
  let keptStops = 0;
  for (const name of ordered) {
    const stops = raw[name].map(([t, hex]) => [roundT(t), ...hexToRgb(hex)]);
    rawStops += stops.length;
    const simplified = simplify(stops);
    keptStops += simplified.length;
    data[name] = simplified;
  }

  // Emit the TypeScript module.
  const lines = [];
  lines.push(
    "// AUTO-GENERATED by scripts/gen-colormaps.mjs — DO NOT EDIT BY HAND.",
    "//",
    "// Source: PlotPy plotpy/data/colormaps_default.json",
    "// Regenerate with: node scripts/gen-colormaps.mjs [path/to/json]",
    "//",
    "// Each colormap is a list of stops [position(0..1), r, g, b] with r/g/b in",
    "// 0..255. Smooth maps are simplified (collinear stops removed); qualitative",
    "// maps keep their hard transitions (duplicated positions).",
    "",
    "/** One colormap stop: [position (0..1), r, g, b] (channels 0..255). */",
    "export type ColormapStop = readonly [number, number, number, number];",
    "",
    "/** Ordered list of stops defining a colormap. */",
    "export type ColormapStops = readonly ColormapStop[];",
    "",
    "/** Raw stop definitions for every default colormap, keyed by lowercase name. */",
    "export const COLORMAP_STOPS: Readonly<Record<string, ColormapStops>> = {",
  );
  for (const name of ordered) {
    const body = data[name]
      .map((s) => `[${s[0]}, ${s[1]}, ${s[2]}, ${s[3]}]`)
      .join(", ");
    lines.push(`  ${JSON.stringify(name)}: [${body}],`);
  }
  lines.push("};", "");

  lines.push(
    "/** Ordered colormap names (lowercase, PlotPy keys). */",
    "export const COLORMAP_NAMES: readonly string[] = [",
  );
  for (const name of ordered) {
    lines.push(`  ${JSON.stringify(name)},`);
  }
  lines.push("];", "");

  lines.push(
    "/** Colormap names grouped by category, for the UI selector. */",
    "export const COLORMAP_CATEGORIES: readonly {",
    "  readonly label: string;",
    "  readonly names: readonly string[];",
    "}[] = [",
  );
  for (const cat of categories) {
    const names = cat.names.map((n) => JSON.stringify(n)).join(", ");
    lines.push(`  { label: ${JSON.stringify(cat.label)}, names: [${names}] },`);
  }
  lines.push("];", "");

  writeFileSync(OUTPUT, lines.join("\n"), "utf-8");

  process.stdout.write(
    `Generated ${OUTPUT}\n` +
      `  ${ordered.length} colormaps, ${rawStops} → ${keptStops} stops ` +
      `(${((1 - keptStops / rawStops) * 100).toFixed(1)}% reduction)\n`,
  );
}

main();
