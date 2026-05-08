#!/usr/bin/env node
/**
 * Build the DataLab-Web SDK and produce a versioned npm tarball under
 * ``release/``.
 *
 * Wraps ``npm pack`` (which already runs the ``prepack`` script and
 * produces a properly-named ``<scope>-<name>-<version>.tgz``) and
 * relocates the output into the project's ``release/`` directory so
 * both the app bundle and the SDK end up in a single deliverable
 * folder.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const SDK_DIR = join(ROOT, "packages", "sdk");
const RELEASE = join(ROOT, "release");

if (!existsSync(SDK_DIR)) {
  console.error("[pack-sdk] packages/sdk not found.");
  process.exit(1);
}

mkdirSync(RELEASE, { recursive: true });

// ``npm pack`` honours ``files`` from the package.json and runs the
// package's own ``prepack`` (which builds dist/). Stream into release/.
execFileSync(
  "npm",
  ["pack", "--pack-destination", RELEASE],
  { cwd: SDK_DIR, stdio: "inherit", shell: process.platform === "win32" },
);

// Sanity check: the produced tarball name follows
// ``<scope>-<name>-<version>.tgz`` with a leading ``@`` stripped.
const matching = readdirSync(RELEASE).filter(
  (f) => f.startsWith("datalab-platform-web-sdk-") && f.endsWith(".tgz"),
);
if (matching.length === 0) {
  console.error("[pack-sdk] no tarball was produced.");
  process.exit(1);
}

console.log(`[pack-sdk] wrote ${join(RELEASE, matching[matching.length - 1])}`);
