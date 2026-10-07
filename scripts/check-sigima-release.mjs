/** Ensure a DataLab-Web release uses published Sigima and guidata versions. */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PACKAGES = {
  sigima: {
    label: "Sigima",
    manifest: resolve(ROOT, "sigima-dependency.json"),
    publishedRequirementRe: /^sigima==[0-9]+\.[0-9]+\.[0-9]+$/,
    publishedRequirementRule: 'an exact stable pin such as "sigima==1.3.0"',
    remedy: "Publish and qualify that exact Sigima version",
  },
  guidata: {
    label: "guidata",
    manifest: resolve(ROOT, "guidata-dependency.json"),
    publishedRequirementRe: /^guidata(==|>=)[0-9]+\.[0-9]+\.[0-9]+$/,
    publishedRequirementRule:
      'an exact pin or a lower bound such as "guidata>=3.15.0"',
    remedy:
      "Publish and qualify a guidata version providing the required " +
      "changes, make publishedRequirement require it",
  },
};

const EXPECTED_KEYS = new Set(["publishedRequirement", "developmentRef"]);
const DEVELOPMENT_REF_RE = /^[0-9a-f]{40}$/;

function packageRules(packageName) {
  const rules = PACKAGES[packageName];
  if (!rules) throw new Error(`Unknown dependency package: ${packageName}`);
  return rules;
}

/** Validate and normalize a parsed dependency manifest. */
export function validateDependencyManifest(manifest, packageName = "sigima") {
  const rules = packageRules(packageName);
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  ) {
    throw new Error(
      `${rules.label} dependency manifest must be a JSON object.`,
    );
  }

  const keys = Object.keys(manifest);
  const missing = [...EXPECTED_KEYS].filter((key) => !keys.includes(key));
  const unexpected = keys.filter((key) => !EXPECTED_KEYS.has(key));
  if (missing.length || unexpected.length) {
    const details = [];
    if (missing.length) details.push(`missing keys: ${missing.join(", ")}`);
    if (unexpected.length) {
      details.push(`unexpected keys: ${unexpected.join(", ")}`);
    }
    throw new Error(
      `Invalid ${rules.label} dependency manifest: ${details.join("; ")}.`,
    );
  }

  const { publishedRequirement, developmentRef } = manifest;
  if (
    typeof publishedRequirement !== "string" ||
    !rules.publishedRequirementRe.test(publishedRequirement)
  ) {
    throw new Error(
      `publishedRequirement must be ${rules.publishedRequirementRule}.`,
    );
  }
  if (
    developmentRef !== null &&
    (typeof developmentRef !== "string" ||
      !DEVELOPMENT_REF_RE.test(developmentRef))
  ) {
    throw new Error(
      "developmentRef must be null or a full lowercase 40-character commit SHA.",
    );
  }

  return { publishedRequirement, developmentRef };
}

/** Load and validate a versioned dependency manifest. */
export function loadDependencyManifest(
  packageName = "sigima",
  path = packageRules(packageName).manifest,
) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${path}: ${detail}`);
  }
  return validateDependencyManifest(manifest, packageName);
}

/** Throw when a development snapshot would leak into a release. */
export function assertReleaseReady(manifest, packageName = "sigima") {
  const rules = packageRules(packageName);
  const config = validateDependencyManifest(manifest, packageName);
  if (config.developmentRef !== null) {
    throw new Error(
      `Release blocked: a ${rules.label} development snapshot is still active.\n` +
        `Configured SHA: ${config.developmentRef}\n` +
        `Published target: ${config.publishedRequirement}\n` +
        `${rules.remedy}, then set developmentRef to null in ` +
        `${packageName}-dependency.json.`,
    );
  }
  return config;
}

/** Check every repository manifest and return the release-safe configs. */
export function checkReleaseDependencies() {
  return Object.fromEntries(
    Object.keys(PACKAGES).map((packageName) => [
      packageName,
      assertReleaseReady(loadDependencyManifest(packageName), packageName),
    ]),
  );
}

function main() {
  try {
    const configs = checkReleaseDependencies();
    const pins = Object.values(configs)
      .map((config) => config.publishedRequirement)
      .join(", ");
    console.log(`Dependency release guard passed: ${pins} (published).`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[dependency-release] ${message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
