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
 *   node scripts/release.mjs <version> [--allow-empty-changelog]
 *
 * <version> may be either an explicit SemVer (``0.2.0``, ``1.0.0-rc.1``)
 * or one of the ``npm version`` keywords (``patch``, ``minor``,
 * ``major``, ``prerelease``).
 *
 * The script also promotes the ``[Unreleased]`` section of
 * ``CHANGELOG.md`` to ``[X.Y.Z] - YYYY-MM-DD`` and refreshes the
 * bottom-of-file link references in the same commit. It refuses to
 * proceed if ``[Unreleased]`` has no entries, unless
 * ``--allow-empty-changelog`` is passed (intended for tag-only or
 * infrastructure releases).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extractSection } from "./extract-changelog.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_PKG = resolve(ROOT, "package.json");
const SDK_PKG = resolve(ROOT, "packages/sdk/package.json");
const CHANGELOG = resolve(ROOT, "CHANGELOG.md");

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

/**
 * Promote the ``[Unreleased]`` block of CHANGELOG.md to a versioned
 * section dated today, leaving a fresh empty ``[Unreleased]`` on top
 * and updating the bottom link references. Returns ``true`` if the
 * file was modified.
 *
 * If the ``[Unreleased]`` block is empty, the release is aborted
 * unless ``allowEmpty`` is true (CLI flag ``--allow-empty-changelog``).
 */
function promoteChangelog(newVersion, allowEmpty) {
  let md;
  try {
    md = readFileSync(CHANGELOG, "utf8");
  } catch {
    console.warn("⚠️  CHANGELOG.md not found, skipping promotion.");
    return false;
  }
  const header = "## [Unreleased]";
  const start = md.indexOf(header);
  if (start === -1) {
    console.warn("⚠️  CHANGELOG.md: no [Unreleased] section, skipping.");
    return false;
  }
  const next = md.indexOf("\n## [", start + header.length);
  if (next === -1) {
    console.warn("⚠️  CHANGELOG.md: no following version section, skipping.");
    return false;
  }
  const body = md.slice(start + header.length, next).trim();
  if (!body) {
    if (!allowEmpty) {
      fail(
        "CHANGELOG.md: the [Unreleased] section is empty.\n" +
          "Add bullets describing the user-visible changes since the previous\n" +
          "release (see CONTRIBUTING.md), or re-run with --allow-empty-changelog\n" +
          "if this is intentional (e.g. tag-only / infrastructure release).",
      );
    }
    console.warn(
      "⚠️  CHANGELOG.md: [Unreleased] is empty — promoting an empty section\n" +
        "   (--allow-empty-changelog was passed).",
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const promoted = body.replace(/in Unreleased\b/g, `in ${newVersion}`);
  const replacement =
    `${header}\n\n` +
    `## [${newVersion}] - ${today}\n\n` +
    (promoted ? `${promoted}\n\n` : "");
  md = md.slice(0, start) + replacement + md.slice(next + 1);

  const linkRe =
    /^\[Unreleased\]:\s*(.+?)\/compare\/v([^.\s]+(?:\.[^.\s]+)*)\.\.\.HEAD\s*$/m;
  const m = md.match(linkRe);
  if (m) {
    const base = m[1];
    const prev = m[2];
    md = md.replace(
      linkRe,
      `[Unreleased]: ${base}/compare/v${newVersion}...HEAD`,
    );
    md = md.replace(
      /^(\[Unreleased\]:.*\n)/m,
      `$1[${newVersion}]: ${base}/compare/v${prev}...v${newVersion}\n`,
    );
  } else {
    console.warn("⚠️  CHANGELOG.md: could not update bottom link references.");
  }

  writeFileSync(CHANGELOG, md);
  return true;
}

const argv = process.argv.slice(2);
const allowEmptyChangelog = argv.includes("--allow-empty-changelog");
const positional = argv.filter((a) => !a.startsWith("--"));
const version = positional[0];
if (!version) {
  fail(
    "Usage: node scripts/release.mjs <version|patch|minor|major|prerelease>\n" +
      "                              [--allow-empty-changelog]",
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

// 6. Promote the [Unreleased] section of CHANGELOG.md to vX.Y.Z dated today.
const changelogUpdated = promoteChangelog(appVersion, allowEmptyChangelog);

// 6b. Fail early (before tagging) if the release pipeline would later be unable
//     to extract a non-empty notes section for this version. This mirrors the
//     CI step `node scripts/extract-changelog.mjs <tag> -o release-notes.md`,
//     so a missing/empty section surfaces locally instead of breaking the
//     GitHub Release job after the tag is already pushed.
if (changelogUpdated && !allowEmptyChangelog) {
  const md = readFileSync(CHANGELOG, "utf8");
  const section = extractSection(md, appVersion);
  if (section == null || section.trim() === "") {
    fail(
      `CHANGELOG.md: no release-notes section could be extracted for ${tag}.\n` +
        "The GitHub Release job (scripts/extract-changelog.mjs) would fail.\n" +
        "Add entries under [Unreleased] before releasing, or re-run with\n" +
        "--allow-empty-changelog for a tag-only / infrastructure release.",
    );
  }
}

// 7. Stage, commit, tag.
console.log(`→ Committing and tagging ${tag} ...`);
const toStage = [
  "package.json",
  "package-lock.json",
  "packages/sdk/package.json",
];
if (changelogUpdated) toStage.push("CHANGELOG.md");
run("git", ["add", ...toStage]);
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
