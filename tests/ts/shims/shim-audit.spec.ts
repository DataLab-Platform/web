import { describe, it, expect } from "vitest";

import {
  SHIM_REGISTRY,
  PACKAGE_VERSION_SOURCES,
  classifyShim,
  type ShimAuditResult,
} from "../../../src/runtime/shims/registry";
import { PYODIDE_INDEX } from "../../../src/runtime/workerBase";

/**
 * Opt-in audit (``npm run audit:shims`` / the ``🔍 Audit shims (versions)``
 * VS Code task). It resolves the version of each backport's target package
 * the way the browser does — PyPI for the ``micropip``-installed packages,
 * the pinned Pyodide lockfile for the bundled scientific stack — and reports
 * which shims are now removable.
 *
 * REPORT-ONLY: this spec never fails on an outdated shim (that is a human
 * decision). It only fails on an internal inconsistency. When the machine
 * is offline, version lookups degrade to ``null`` and the corresponding
 * shims are reported as ``skipped``.
 */

const PYPI = "https://pypi.org/pypi";
const TIMEOUT_MS = 15_000;

async function fetchPypiVersion(pkg: string): Promise<string | null> {
  try {
    const res = await fetch(`${PYPI}/${pkg}/json`);
    if (!res.ok) return null;
    const data = (await res.json()) as { info?: { version?: string } };
    return data.info?.version ?? null;
  } catch {
    return null;
  }
}

let lockCache: Record<string, string> | null | undefined;

async function fetchPyodideLockVersions(): Promise<Record<
  string,
  string
> | null> {
  if (lockCache !== undefined) return lockCache;
  try {
    const res = await fetch(`${PYODIDE_INDEX}pyodide-lock.json`);
    if (!res.ok) {
      lockCache = null;
      return lockCache;
    }
    const data = (await res.json()) as {
      packages?: Record<string, { version?: string }>;
    };
    const out: Record<string, string> = {};
    for (const [name, info] of Object.entries(data.packages ?? {})) {
      if (info.version) out[name.toLowerCase()] = info.version;
    }
    lockCache = out;
    return lockCache;
  } catch {
    lockCache = null;
    return lockCache;
  }
}

async function resolveInstalledVersion(pkg: string): Promise<string | null> {
  const source = PACKAGE_VERSION_SOURCES[pkg];
  if (source === "pypi") return fetchPypiVersion(pkg);
  if (source === "pyodide-lock") {
    const lock = await fetchPyodideLockVersions();
    return lock?.[pkg.toLowerCase()] ?? null;
  }
  return null;
}

function renderTable(results: ShimAuditResult[]): string {
  const icon: Record<ShimAuditResult["status"], string> = {
    "ready-to-remove": "✅ REMOVE",
    pending: "⏳ keep",
    unknown: "❔ unknown",
    skipped: "⚠️ skipped",
  };
  const rows = results.map(
    (r) =>
      `  ${icon[r.status].padEnd(11)} ${r.id.padEnd(32)} ` +
      `${r.targetPackage.padEnd(9)} need>=${String(r.removableFrom).padEnd(8)} ` +
      `installed=${String(r.installedVersion)}`,
  );
  return ["", "Shim removability audit:", ...rows, ""].join("\n");
}

describe("shim version audit (report-only)", () => {
  it(
    "reports removability against runtime-resolved versions",
    async () => {
      const backports = SHIM_REGISTRY.filter((s) => s.kind === "backport");
      const versions = new Map<string, string | null>();
      for (const pkg of new Set(backports.map((s) => s.targetPackage))) {
        versions.set(pkg, await resolveInstalledVersion(pkg));
      }

      const results = backports.map((shim) =>
        classifyShim(shim, versions.get(shim.targetPackage) ?? null),
      );

      console.log(renderTable(results));
      for (const r of results) {
        console.log(`  • ${r.id}: ${r.detail}`);
      }

      const removable = results.filter((r) => r.status === "ready-to-remove");
      if (removable.length > 0) {
        console.log(
          `\n${removable.length} shim(s) READY TO REMOVE: ` +
            removable.map((r) => r.id).join(", "),
        );
      }

      // Sanity only — never fail on an outdated shim.
      expect(results.length).toBe(backports.length);
    },
    TIMEOUT_MS,
  );
});
