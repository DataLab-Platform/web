// @ts-check
/**
 * i18n extraction / verification tool for DataLab-Web.
 *
 * Scans the TypeScript/TSX sources under ``src/`` for ``t("…")`` calls
 * (the translation helper from ``src/i18n/translate``), collects the set
 * of English message keys, and reconciles them with the JSON catalogs
 * under ``src/locales/``.
 *
 * Two modes:
 *
 * - ``--write`` (default): merge discovered keys into every catalog,
 *   preserving existing translations, adding missing keys with an empty
 *   ``""`` placeholder, and keeping the file sorted/grouped. Orphan keys
 *   (present in a catalog but no longer referenced) are reported but NOT
 *   removed automatically (a translator may keep a key intentionally).
 * - ``--check``: exit non-zero if any catalog is missing a referenced key
 *   or has an untranslated (empty) value. Used in CI / pre-commit.
 *
 * The English source is the key itself, so there is intentionally NO
 * ``en.json`` catalog — English is the identity locale.
 *
 * Usage:
 *   node scripts/i18n-extract.mjs            # write/update catalogs
 *   node scripts/i18n-extract.mjs --check    # verify only (CI)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const LOCALES_DIR = path.join(ROOT, "src", "locales");

/** Locales to maintain. English is implicit (identity), so excluded. */
const LOCALES = ["fr"];

/**
 * Match ``t("…")`` / ``t('…')`` calls — single argument string literal,
 * optionally followed by a comma (interpolation vars). Template literals
 * are intentionally NOT extracted: dynamic keys can't be statically
 * collected and must be added to catalogs by hand.
 *
 * @type {RegExp}
 */
const T_CALL = /\bt\(\s*(["'])((?:\\.|(?!\1).)*)\1/g;

/** Recursively list ``*.ts``/``*.tsx`` files under a directory. */
async function listSources(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip generated / vendored folders.
      if (["node_modules", "dist", "locales"].includes(entry.name)) continue;
      out.push(...(await listSources(full)));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Unescape a JS string literal body (handles \\, \", \', \n, \t, \uXXXX). */
function unescapeLiteral(raw) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, esc) => {
    if (esc[0] === "u" || esc[0] === "x") {
      return String.fromCodePoint(parseInt(esc.slice(1), 16));
    }
    const map = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'" };
    return map[esc] ?? esc;
  });
}

/**
 * Remove ``//`` line comments and ``/* … *\/`` block comments while keeping
 * string and template literals intact, so docstring examples that show a
 * ``t("…")`` call are not mistaken for real references.
 *
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    // String / template literal — copy verbatim until the closing quote.
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        out += src[i];
        if (src[i] === "\\") {
          out += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Collect the set of translation keys referenced across all sources. */
async function collectKeys() {
  const files = await listSources(SRC_DIR);
  /** @type {Set<string>} */
  const keys = new Set();
  // Seed with keys referenced only through variables (folder labels,
  // per-panel open/save strings, message-box headings, …) which a static
  // ``t("literal")`` scan cannot see. Keeps orphan detection accurate.
  for (const k of await readDynamicKeys()) keys.add(k);
  for (const file of files) {
    const text = stripComments(await fs.readFile(file, "utf8"));
    for (const m of text.matchAll(T_CALL)) {
      keys.add(unescapeLiteral(m[2]));
    }
  }
  return keys;
}

/** Read the explicit list of dynamically-referenced keys, if present. */
async function readDynamicKeys() {
  const file = path.join(LOCALES_DIR, "_dynamic-keys.json");
  try {
    const arr = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function readCatalog(locale) {
  const file = path.join(LOCALES_DIR, `${locale}.json`);
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return {};
  }
}

async function writeCatalog(locale, obj) {
  const file = path.join(LOCALES_DIR, `${locale}.json`);
  // Keep insertion order of ``obj``; Prettier will re-format on commit.
  await fs.writeFile(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function main() {
  const mode = process.argv.includes("--check") ? "check" : "write";
  const keys = await collectKeys();
  const sortedKeys = [...keys].sort((a, b) => a.localeCompare(b));

  let problems = 0;
  for (const locale of LOCALES) {
    const existing = await readCatalog(locale);
    const missing = sortedKeys.filter((k) => !(k in existing));
    const empty = sortedKeys.filter((k) => k in existing && existing[k] === "");
    const orphans = Object.keys(existing).filter((k) => !keys.has(k));

    if (mode === "check") {
      for (const k of missing) {
        console.error(`[${locale}] MISSING  ${JSON.stringify(k)}`);
        problems++;
      }
      for (const k of empty) {
        console.error(`[${locale}] EMPTY    ${JSON.stringify(k)}`);
        problems++;
      }
      for (const k of orphans) {
        console.warn(`[${locale}] orphan   ${JSON.stringify(k)}`);
      }
    } else {
      // Merge: referenced keys first (preserving existing translations),
      // then surviving orphans at the end so nothing is silently dropped.
      /** @type {Record<string, string>} */
      const merged = {};
      for (const k of sortedKeys) merged[k] = existing[k] ?? "";
      for (const k of orphans) merged[k] = existing[k];
      await writeCatalog(locale, merged);
      console.log(
        `[${locale}] ${sortedKeys.length} keys (` +
          `${missing.length} new, ${orphans.length} orphan)`,
      );
    }
  }

  if (mode === "check" && problems > 0) {
    console.error(`\ni18n check failed: ${problems} problem(s).`);
    process.exit(1);
  }
  if (mode === "check") {
    console.log(`i18n check OK — ${sortedKeys.length} keys.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
