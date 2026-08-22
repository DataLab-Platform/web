/** Ensure a DataLab-Web release uses an exact published Sigima version. */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_MANIFEST = resolve(ROOT, "sigima-dependency.json");

const EXPECTED_KEYS = new Set(["publishedRequirement", "developmentRef"]);
const PUBLISHED_REQUIREMENT_RE = /^sigima==[0-9]+\.[0-9]+\.[0-9]+$/;
const DEVELOPMENT_REF_RE = /^[0-9a-f]{40}$/;

/** Validate and normalize a parsed dependency manifest. */
export function validateSigimaDependencyManifest(manifest) {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  ) {
    throw new Error("Sigima dependency manifest must be a JSON object.");
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
      `Invalid Sigima dependency manifest: ${details.join("; ")}.`,
    );
  }

  const { publishedRequirement, developmentRef } = manifest;
  if (
    typeof publishedRequirement !== "string" ||
    !PUBLISHED_REQUIREMENT_RE.test(publishedRequirement)
  ) {
    throw new Error(
      'publishedRequirement must be an exact stable pin such as "sigima==1.3.0".',
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

/** Load and validate the versioned dependency manifest. */
export function loadSigimaDependencyManifest(path = DEFAULT_MANIFEST) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${path}: ${detail}`);
  }
  return validateSigimaDependencyManifest(manifest);
}

/** Throw when a development snapshot would leak into a release. */
export function assertSigimaReleaseReady(manifest) {
  const config = validateSigimaDependencyManifest(manifest);
  if (config.developmentRef !== null) {
    throw new Error(
      "Release blocked: a Sigima development snapshot is still active.\n" +
        `Configured SHA: ${config.developmentRef}\n` +
        `Published target: ${config.publishedRequirement}\n` +
        "Publish and qualify that exact Sigima version, then set " +
        "developmentRef to null in sigima-dependency.json.",
    );
  }
  return config;
}

/** Check the repository manifest and return its release-safe configuration. */
export function checkSigimaRelease(path = DEFAULT_MANIFEST) {
  return assertSigimaReleaseReady(loadSigimaDependencyManifest(path));
}

function main() {
  try {
    const config = checkSigimaRelease();
    console.log(
      `Sigima release guard passed: ${config.publishedRequirement} (published).`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sigima-release] ${message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
