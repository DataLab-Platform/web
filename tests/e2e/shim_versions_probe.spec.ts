import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { waitForRuntimeReady, disableQuickstartTemplate } from "./fixtures";
import type { DataLabRuntime } from "../../src/runtime/runtime";
import {
  SHIM_REGISTRY,
  PACKAGE_VERSION_SOURCES,
  classifyShim,
} from "../../src/runtime/shims/registry";

declare global {
  interface Window {
    runtime: DataLabRuntime;
  }
}

/**
 * Ground-truth shim version audit.
 *
 * The fast audit (``tests/ts/shims/shim-audit.spec.ts``) infers the
 * versions DataLab-Web *will* install from PyPI and the Pyodide lockfile
 * without booting Pyodide. This spec is the authoritative counterpart: it
 * boots a real Pyodide instance, reads the versions actually resolved by
 * ``micropip`` / ``loadPackage`` via :meth:`DataLabRuntime.getInstalledVersions`,
 * and:
 *
 *   * asserts every package tracked by the shim registry is importable,
 *   * writes ``audit/runtime-versions.json`` for diagnostics / bug reports,
 *   * classifies each backport shim against the *live* version and logs
 *     which ones are now removable (report-only).
 *
 * It is report-only on removability — deciding when to delete a shim is a
 * human call — but it DOES fail if a tracked package cannot be resolved,
 * which would mean the runtime is missing a dependency the registry
 * assumes is present.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("runtime ground-truth versions resolve and feed the shim audit", async ({
  page,
}) => {
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);

  const tracked = Object.keys(PACKAGE_VERSION_SOURCES);
  const versions = await page.evaluate(
    (pkgs) => window.runtime.getInstalledVersions(pkgs),
    tracked,
  );

  // Every package the registry tracks must actually be installed.
  for (const pkg of tracked) {
    expect(versions[pkg], `${pkg} should resolve to a version`).toBeTruthy();
  }

  // Persist the ground-truth snapshot for diagnostics.
  const auditDir = join(REPO_ROOT, "audit");
  mkdirSync(auditDir, { recursive: true });
  writeFileSync(
    join(auditDir, "runtime-versions.json"),
    JSON.stringify({ capturedAt: new Date().toISOString(), versions }, null, 2),
  );

  // Classify each backport shim against the live versions (report-only).
  const results = SHIM_REGISTRY.filter((s) => s.kind === "backport").map(
    (shim) => classifyShim(shim, versions[shim.targetPackage] ?? null),
  );
  for (const r of results) {
    console.log(
      `[shim-audit] ${r.status.padEnd(16)} ${r.id} (${r.targetPackage} ${r.installedVersion}) — ${r.detail}`,
    );
  }
  const removable = results.filter((r) => r.status === "ready-to-remove");
  if (removable.length > 0) {
    console.log(
      `[shim-audit] ${removable.length} shim(s) READY TO REMOVE: ${removable
        .map((r) => r.id)
        .join(", ")}`,
    );
  }

  // Sanity: classification covered every backport shim.
  expect(results.length).toBe(
    SHIM_REGISTRY.filter((s) => s.kind === "backport").length,
  );
});
