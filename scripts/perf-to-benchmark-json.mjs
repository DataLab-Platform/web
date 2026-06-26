// @ts-check
/**
 * Convert the raw perf-benchmark result JSON files (written by the
 * ``perf`` Playwright project under ``tests/benchmark/results/``) into the
 * flat ``customSmallerIsBetter`` format consumed by
 * ``benchmark-action/github-action-benchmark``.
 *
 * Two output files are produced so the on-demand ``perf`` workflow can
 * track them with different alerting policies:
 *
 *   - ``bench-determinist.json`` — memory / payload-size metrics. These
 *     are deterministic with respect to the code (they do not depend on
 *     wall-clock timing) and therefore make trustworthy regression
 *     gates: a real increase means a genuine memory/serialisation
 *     regression. The workflow alerts (and fails on PRs) on these.
 *
 *   - ``bench-timings.json`` — millisecond timings. Kept for trend
 *     inspection only: on shared CI runners they vary run-to-run, so the
 *     workflow tracks them with a wide threshold and never fails on them.
 *
 * For each benchmark the most recent ``<prefix>_<timestamp>.json`` file
 * is used (the timestamp embedded in the filename sorts lexicographically).
 *
 * Usage:
 *   node scripts/perf-to-benchmark-json.mjs [resultsDir] [outDir]
 *
 * Both arguments default to ``tests/benchmark/results``.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const resultsDir =
  process.argv[2] || join(repoRoot, "tests", "benchmark", "results");
const outDir = process.argv[3] || resultsDir;

/** @typedef {{ name: string, unit: string, value: number }} Metric */

/** Mean of a numeric array (0 when empty). */
function mean(xs) {
  if (!xs || xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

const MiB = 1024 * 1024;

/**
 * Latest ``<prefix>*.json`` file in ``resultsDir`` (by filename sort), or
 * ``null`` when none is present.
 */
function latest(prefix) {
  if (!existsSync(resultsDir)) return null;
  const matches = readdirSync(resultsDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort();
  if (matches.length === 0) return null;
  const file = join(resultsDir, matches[matches.length - 1]);
  return { file, data: JSON.parse(readFileSync(file, "utf8")) };
}

const determinist = /** @type {Metric[]} */ ([]);
const timings = /** @type {Metric[]} */ ([]);
const used = [];

function cfgLabel(r) {
  return `${r.side}² ×${r.n} ${r.dtype}`;
}

// --- image_perf -----------------------------------------------------
{
  const got = latest("image_perf_");
  if (got) {
    used.push(got.file);
    const r = got.data.result;
    // Deterministic: approximate JSON payload for the batched fetch.
    determinist.push({
      name: `image_perf · payload (${r.imageCount} imgs)`,
      unit: "MB",
      value: +(r.payloadBytesApprox / 1e6).toFixed(3),
    });
    // Timings (trend only).
    timings.push({
      name: "image_perf · multi-select → grid",
      unit: "ms",
      value: +r.multiSelectToGridMs.toFixed(1),
    });
    timings.push({
      name: "image_perf · getImagesData (×4)",
      unit: "ms",
      value: +r.getImagesDataMs.toFixed(1),
    });
    timings.push({
      name: "image_perf · plotly draw",
      unit: "ms",
      value: +r.plotlyDrawMs.toFixed(1),
    });
  }
}

// --- opfs_storage (RAM vs disk) -------------------------------------
{
  const got = latest("opfs_storage_");
  if (got) {
    used.push(got.file);
    for (const r of got.data.results) {
      const label = cfgLabel(r);
      const diskGrowth = (r.disk.createPeak - r.disk.base) / MiB;
      const ramGrowth = (r.ram.createPeak - r.ram.base) / MiB;
      // Deterministic headline: on-disk peak heap growth must stay near
      // zero. A regression (disk mode no longer keeping the heap flat)
      // shows up as this number rising — exactly what smaller-is-better
      // alerting catches.
      determinist.push({
        name: `opfs_storage · disk Δheap [${label}]`,
        unit: "MiB",
        value: +diskGrowth.toFixed(1),
      });
      determinist.push({
        name: `opfs_storage · ram Δheap [${label}]`,
        unit: "MiB",
        value: +ramGrowth.toFixed(1),
      });
      timings.push({
        name: `opfs_storage · disk add [${label}]`,
        unit: "ms",
        value: +mean(r.disk.createMs).toFixed(1),
      });
      timings.push({
        name: `opfs_storage · disk read [${label}]`,
        unit: "ms",
        value: +mean(r.disk.readMs).toFixed(1),
      });
    }
  }
}

// --- opfs_worker (async vs sync) ------------------------------------
{
  const got = latest("opfs_worker_");
  if (got) {
    used.push(got.file);
    for (const r of got.data.results) {
      const label = cfgLabel(r);
      determinist.push({
        name: `opfs_worker · async Δheap [${label}]`,
        unit: "MiB",
        value: +((r.async.createPeak - r.async.base) / MiB).toFixed(1),
      });
      determinist.push({
        name: `opfs_worker · sync Δheap [${label}]`,
        unit: "MiB",
        value: +((r.sync.createPeak - r.sync.base) / MiB).toFixed(1),
      });
      timings.push({
        name: `opfs_worker · async add [${label}]`,
        unit: "ms",
        value: +mean(r.async.createMs).toFixed(1),
      });
      timings.push({
        name: `opfs_worker · sync add [${label}]`,
        unit: "ms",
        value: +mean(r.sync.createMs).toFixed(1),
      });
    }
  }
}

if (used.length === 0) {
  console.error(
    `[perf-to-benchmark] no result files found in ${resultsDir} — did the perf project run?`,
  );
  process.exit(1);
}

const determPath = join(outDir, "bench-determinist.json");
const timingsPath = join(outDir, "bench-timings.json");
writeFileSync(determPath, JSON.stringify(determinist, null, 2));
writeFileSync(timingsPath, JSON.stringify(timings, null, 2));

console.log(`[perf-to-benchmark] sources:\n  ${used.join("\n  ")}`);
console.log(
  `[perf-to-benchmark] wrote ${determinist.length} deterministic metric(s) → ${determPath}`,
);
console.log(
  `[perf-to-benchmark] wrote ${timings.length} timing metric(s) → ${timingsPath}`,
);
