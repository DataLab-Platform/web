#!/usr/bin/env node
/**
 * Print a final, easy-to-spot summary of artefacts produced by
 * ``release:pack``. Run as the last step of the orchestrator script
 * so the developer's eyes can land on the tarball paths.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const RELEASE = join(ROOT, "release");

if (!existsSync(RELEASE)) {
  console.error("[release-summary] no release/ directory.");
  process.exit(1);
}

const artifacts = readdirSync(RELEASE)
  .filter(
    (filename) =>
      filename.endsWith(".tgz") ||
      filename.endsWith(".zip") ||
      filename.endsWith(".sha256"),
  )
  .map((f) => {
    const full = join(RELEASE, f);
    const size = statSync(full).size;
    return { name: f, full, size };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

if (artifacts.length === 0) {
  console.error("[release-summary] no release artifacts found in release/.");
  process.exit(1);
}

const fmt = (n) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MiB`
    : `${(n / 1024).toFixed(1)} KiB`;

const sep = "─".repeat(60);
console.log(`\n${sep}`);
console.log("DataLab-Web release artefacts");
console.log(sep);
for (const { name, full, size } of artifacts) {
  console.log(`  ${name}  (${fmt(size)})`);
  console.log(`    ${full}`);
}
console.log(sep);
console.log("Hand-off:");
console.log("  • Use the .tgz app and SDK files for online integrations.");
console.log("  • Transfer the offline .zip and its external .sha256 together.");
console.log("  • Unpack either app bundle under a static web server.");
console.log("  • SDK is consumed via `npm install ./<sdk>.tgz`.");
console.log(`${sep}\n`);
