#!/usr/bin/env node
/**
 * Release helper for DataLab-Web.
 *
 * Atomically bumps the version of both the app (`package.json`) and the
 * SDK (`packages/sdk/package.json`), creates a single commit and a
 * matching `vX.Y.Z` tag. The push to GitHub is intentionally NOT done
 * here so the user keeps a final manual checkpoint before triggering
 * the release pipeline.
 *
 * Usage:
 *   node scripts/release.mjs <version>
 *
 * <version> may be either an explicit SemVer (``0.2.0``, ``1.0.0-rc.1``)
 * or one of the ``npm version`` keywords (``patch``, ``minor``,
 * ``major``, ``prerelease``).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_PKG = resolve(ROOT, "package.json");
const SDK_PKG = resolve(ROOT, "packages/sdk/package.json");

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    // Required on Windows so ``npm`` (npm.cmd) resolves correctly.
    shell: process.platform === "win32",
    ...opts,
  });
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function readVersion(pkgPath) {
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
}

const version = process.argv[2];
if (!version) {
  fail(
    "Usage: node scripts/release.mjs <version|patch|minor|major|prerelease>",
  );
}

// 1. Working tree must be clean.
const status = run("git", ["status", "--porcelain"], { capture: true }).trim();
if (status) {
  fail(
    "Working tree is not clean. Commit or stash your changes before " +
      "running the release task.\n\n" +
      status,
  );
}

// 2. Warn (don't block) if not on the default branch.
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
  capture: true,
}).trim();
if (branch !== "main") {
  console.warn(
    `⚠️  You are on branch "${branch}", not "main". Continuing anyway.`,
  );
}

// 3. Bump SDK first (no commit, no tag — we'll bundle it with the root bump).
console.log(`\n→ Bumping SDK to ${version} ...`);
run("npm", [
  "version",
  version,
  "--no-git-tag-version",
  "--prefix",
  "packages/sdk",
]);

// 4. Bump root (no commit, no tag — we control them ourselves so the SDK
//    change is included in the same commit).
console.log(`→ Bumping app to ${version} ...`);
run("npm", ["version", version, "--no-git-tag-version"]);

// 5. Read the resolved versions and verify they match.
const appVersion = readVersion(ROOT_PKG);
const sdkVersion = readVersion(SDK_PKG);
if (appVersion !== sdkVersion) {
  fail(
    `Resolved versions disagree: app=${appVersion}, sdk=${sdkVersion}. ` +
      "Reverting via 'git checkout -- package.json package-lock.json " +
      "packages/sdk/package.json' is recommended.",
  );
}
const tag = `v${appVersion}`;

// 6. Stage, commit, tag.
console.log(`→ Committing and tagging ${tag} ...`);
run("git", [
  "add",
  "package.json",
  "package-lock.json",
  "packages/sdk/package.json",
]);
run("git", ["commit", "-m", tag]);
run("git", ["tag", "-a", tag, "-m", tag]);

console.log(`\n✅ Release ${tag} ready locally.\n`);
console.log("Next step (manual, intentional):");
console.log("    git push --follow-tags\n");
console.log(
  "This will trigger the 'Release tarballs' workflow on GitHub:\n" +
    "  verify → pytest + Playwright → lint + Vitest + build + pack →\n" +
    "  GitHub Release with tarballs → GitHub Pages deploy.\n",
);
