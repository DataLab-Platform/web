/**
 * Centralised registry of DataLab-Web "temporary shims".
 *
 * A *temporary shim* is a piece of Python (or, rarely, TS) glue that
 * backports a feature into a released upstream package (``guidata``,
 * ``sigima``, …) until a new upstream release ships it natively. Each
 * such shim therefore becomes removable once the runtime resolves an
 * upstream version ``>= removableFrom``.
 *
 * This module is the single source of truth: every backport shim is
 * declared here exactly once. Two consumers rely on it:
 *
 * 1. ``tests/ts/shims/shim-registry.test.ts`` — a network-free anti-drift
 *    test (part of ``npm test``) that keeps the registry, the on-disk
 *    sources and the sentinel markers in sync, and fails CI when a new
 *    inline ``TEMPORARY SHIM`` block is added without a registry entry.
 * 2. ``tests/ts/shims/shim-audit.spec.ts`` — an opt-in, fast pre-audit (run
 *    via the ``🔍 Audit shims (versions)`` VS Code task /
 *    ``npm run audit:shims``) that compares ``removableFrom`` with versions
 *    inferred from PyPI for ``micropip`` packages and the Pyodide lockfile
 *    for the bundled scientific stack. The live Pyodide audit and behavior
 *    tests remain mandatory before removal.
 *
 * Convention for new shims (so the anti-drift scanner can find them):
 * wrap inline shims in ``# TEMPORARY SHIM`` / ``# END TEMPORARY SHIM``
 * sentinel comments and add a ``# @shim-registry: <id>`` tag line next to
 * the opening marker (or in the module docstring for whole-file shims).
 */

/** How the fast audit infers the version of a target package. */
export type VersionSource = "pypi" | "pyodide-lock";

/** Whether a shim is a removable backport or a permanent portability layer. */
export type ShimKind = "backport" | "architectural";

/** An inline sentinel-delimited shim block inside a larger source file. */
export interface ShimBlock {
  /** File containing the block (workspace-relative, POSIX separators). */
  file: string;
  /** Opening sentinel marker (must appear verbatim in the file). */
  startMarker: string;
  /** Closing sentinel marker (must appear verbatim in the file). */
  endMarker: string;
}

/** A single registered shim. */
export interface ShimDescriptor {
  /** Stable machine id; mirrored in the source via ``@shim-registry: <id>``. */
  id: string;
  /** Human-readable one-liner. */
  summary: string;
  /** ``backport`` shims are auditable; ``architectural`` ones never expire. */
  kind: ShimKind;
  /** Upstream package the shim patches/backports. */
  targetPackage: string;
  /**
   * Whole-file shim sources (workspace-relative, POSIX separators). Empty
   * for purely inline shims declared through {@link block}.
   */
  files: string[];
  /** Inline block location, when the shim lives inside a larger file. */
  block?: ShimBlock;
  /**
   * Minimum upstream version that ships the feature natively, i.e. the
   * version at/after which this shim can be deleted. ``null`` when the
   * upstream change has not landed / been versioned yet.
   */
  removableFrom: string | null;
  /** Where the native upstream implementation lives (for reviewers). */
  upstreamRef?: string;
  /** Entry points that load the shim into a Pyodide instance. */
  loadedBy: string[];
}

/**
 * Version-resolution strategy per target package.
 *
 * ``guidata`` and ``sigima`` carry lower-bound pins (see ``runtime.ts`` and
 * ``workerBase.ts``). The fast audit uses their latest PyPI releases as an
 * approximation; the live audit confirms what ``micropip`` actually resolved.
 * ``numpy``/``scipy``/``h5py`` are bundled with Pyodide, so their version is
 * fixed by the pinned Pyodide build and read from its ``pyodide-lock.json``.
 */
export const PACKAGE_VERSION_SOURCES: Record<string, VersionSource> = {
  guidata: "pypi",
  sigima: "pypi",
  numpy: "pyodide-lock",
  scipy: "pyodide-lock",
  h5py: "pyodide-lock",
};

/**
 * The registry. Only ``backport`` shims need a {@link ShimDescriptor};
 * permanent portability layers (the ``datalab.*`` package under
 * ``dlplugins/``, ``dlw_title_format.py``, the vendored
 * ``run_with_env.py``) are intentionally *not* listed here — they are
 * not expected to disappear with an upstream release.
 */
export const SHIM_REGISTRY: ShimDescriptor[] = [
  {
    id: "guidata-jsonschema",
    summary:
      "Adds FloatArrayItem variable-size and min/max hints missing from " +
      "guidata's native JSON Schema exporter.",
    kind: "backport",
    targetPackage: "guidata",
    files: ["src/runtime/_guidata_jsonschema_shim.py"],
    removableFrom: null,
    upstreamRef: "guidata/guidata/dataset/jsonschema.py",
    loadedBy: ["src/runtime/runtime.ts", "src/runtime/macroWorker.ts"],
  },
];

/**
 * Compare two dotted numeric version strings (e.g. ``"1.1.2"`` vs
 * ``"1.1.10"``). Non-numeric / pre-release suffixes on a segment are
 * ignored (``"3.15.0rc1"`` → ``[3, 15, 0]``). Returns ``-1`` / ``0`` /
 * ``1`` for ``a < b`` / ``a == b`` / ``a > b``.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string): number[] =>
    v.split(".").map((seg) => parseInt(seg.replace(/[^0-9].*$/, ""), 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

/** Audit verdict for a single backport shim. */
export type ShimAuditStatus =
  | "ready-to-remove"
  | "pending"
  | "unknown"
  | "skipped";

export interface ShimAuditResult {
  id: string;
  targetPackage: string;
  removableFrom: string | null;
  installedVersion: string | null;
  status: ShimAuditStatus;
  detail: string;
}

/**
 * Classify a shim given a candidate version of its target package. The fast
 * audit supplies an inferred version; the live audit supplies the installed
 * version. Pure (no I/O) so it is unit-testable on its own.
 */
export function classifyShim(
  shim: ShimDescriptor,
  installedVersion: string | null,
): ShimAuditResult {
  const base = {
    id: shim.id,
    targetPackage: shim.targetPackage,
    removableFrom: shim.removableFrom,
    installedVersion,
  };
  if (shim.removableFrom === null) {
    return {
      ...base,
      status: "unknown",
      detail: "No upstream removal version recorded yet.",
    };
  }
  if (installedVersion === null) {
    return {
      ...base,
      status: "skipped",
      detail: "Could not resolve the installed version.",
    };
  }
  const cmp = compareVersions(installedVersion, shim.removableFrom);
  if (cmp >= 0) {
    return {
      ...base,
      status: "ready-to-remove",
      detail:
        `Version ${installedVersion} >= ${shim.removableFrom}: ` +
        "verify native behavioral parity before removal.",
    };
  }
  return {
    ...base,
    status: "pending",
    detail: `Version ${installedVersion} < ${shim.removableFrom}: keep the shim.`,
  };
}
