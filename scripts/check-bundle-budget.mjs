#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "dist");
const ASSETS = resolve(DIST, "assets");
const INITIAL_JS_GZIP_BUDGET = 375 * 1024;
const PYTHON_RUNTIME_SENTINEL = "Sigima bootstrap script for DataLab-Web";

function fail(message) {
  console.error(`[bundle-budget] ${message}`);
  process.exit(1);
}

if (!existsSync(resolve(DIST, "index.html"))) {
  fail("dist/index.html is missing; run Vite before this check.");
}

const html = readFileSync(resolve(DIST, "index.html"), "utf8");
const tags = html.match(/<(?:script|link)\b[^>]*>/g) ?? [];

function attributes(tag) {
  const result = new Map();
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) {
    result.set(match[1].toLowerCase(), match[3]);
  }
  return result;
}

const moduleScripts = [];
const modulePreloads = [];
for (const tag of tags) {
  const attrs = attributes(tag);
  if (tag.startsWith("<script") && attrs.get("type") === "module") {
    if (attrs.has("src")) moduleScripts.push(attrs.get("src"));
  }
  if (tag.startsWith("<link") && attrs.get("rel") === "modulepreload") {
    if (attrs.has("href")) modulePreloads.push(attrs.get("href"));
  }
}

if (moduleScripts.length !== 1) {
  fail(`expected one module entry script, found ${moduleScripts.length}.`);
}

const forbiddenPreload = modulePreloads.find((reference) =>
  /\/(?:plotly|codemirror|runtime)-[^/]+\.js(?:$|[?#])/.test(reference),
);
if (forbiddenPreload) {
  fail(`heavy chunk is preloaded by index.html: ${forbiddenPreload}`);
}

function outputPath(reference) {
  const assetPath = reference.split(/[?#]/, 1)[0].replace(/^\.\//, "");
  const fullPath = resolve(DIST, assetPath);
  const relativePath = relative(DIST, fullPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    fail(`asset reference escapes dist/: ${reference}`);
  }
  if (!existsSync(fullPath)) fail(`referenced asset is missing: ${reference}`);
  return fullPath;
}

const initialReferences = [
  ...new Set([...moduleScripts, ...modulePreloads]),
].filter((reference) => reference.split(/[?#]/, 1)[0].endsWith(".js"));
const initialAssets = initialReferences.map(outputPath);
const initialGzipBytes = initialAssets.reduce(
  (total, asset) => total + gzipSync(readFileSync(asset)).byteLength,
  0,
);
if (initialGzipBytes > INITIAL_JS_GZIP_BUDGET) {
  fail(
    `initial JavaScript is ${(initialGzipBytes / 1024).toFixed(1)} KiB gzip ` +
      `(budget: ${INITIAL_JS_GZIP_BUDGET / 1024} KiB).`,
  );
}

const entrySource = readFileSync(outputPath(moduleScripts[0]), "utf8");
if (entrySource.includes(PYTHON_RUNTIME_SENTINEL)) {
  fail("the main entry embeds the Python runtime payload.");
}

const assetNames = readdirSync(ASSETS);
const runtimeChunk = assetNames.find((name) =>
  /^runtime-[^/]+\.js$/.test(name),
);
if (!runtimeChunk) fail("the main-thread runtime chunk is missing.");
const runtimeSource = readFileSync(resolve(ASSETS, runtimeChunk), "utf8");
if (!runtimeSource.includes(PYTHON_RUNTIME_SENTINEL)) {
  fail("the Python payload sentinel is missing from the runtime chunk.");
}

console.log(
  `[bundle-budget] initial JS: ${(initialGzipBytes / 1024).toFixed(1)} KiB gzip ` +
    `(${initialAssets.map((asset) => basename(asset)).join(", ")})`,
);
