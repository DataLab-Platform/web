/**
 * Split the Playwright regression suite into CI jobs of similar duration.
 *
 * Playwright's ``--shard`` hands out consecutive files by *test count*. Here a
 * test's cost is dominated by the cold Pyodide boots it performs, not by its
 * number of assertions, so count-based shards end up very unbalanced. This
 * script assigns whole spec files instead, weighted by the durations measured
 * in CI (``tests/e2e/shard-timings.json``):
 *
 *   * the spec list comes from ``playwright test --list --project=chromium``,
 *     so ``testIgnore`` and opt-in projects are honoured exactly and every
 *     regression spec is assigned to exactly one shard;
 *   * specs sharing the worker-scoped ``warmPage`` fixture
 *     (``fixtures-warm.ts``) stay together, as in a serial run, so they keep
 *     sharing a single boot;
 *   * a spec without a measured duration is estimated from its test count.
 *
 * Usage:
 *
 *   node scripts/e2e-shards.mjs plan --shard 2/4 [--output specs.txt]
 *       Print the spec paths of shard 2 of 4, one per line.
 *
 *   node scripts/e2e-shards.mjs timings results-1.json ... [--output file]
 *       Rebuild the duration table from the Playwright JSON reports of every
 *       shard (the CI ``End-to-end report`` job publishes it as the
 *       ``e2e-shard-timings`` artifact); commit it to rebalance the shards.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMINGS = resolve(ROOT, "tests", "e2e", "shard-timings.json");
const WARM_IMPORT_RE = /from\s+["']\.\/fixtures-warm(?:\.ts)?["']/;

function fail(message) {
  console.error(`e2e-shards: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split("=", 2);
      options[key] = inline ?? argv[++i];
      if (options[key] === undefined) fail(`missing value for --${key}`);
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

function toPosix(path) {
  return path.split("\\").join("/");
}

function readTimings() {
  return existsSync(TIMINGS) ? JSON.parse(readFileSync(TIMINGS, "utf8")) : {};
}

function writeOutput(text, output) {
  if (output) writeFileSync(output, text);
  else process.stdout.write(text);
}

/** List the regression specs with their test counts, as Playwright sees them. */
function listSpecs() {
  const run = spawnSync(
    "npx",
    ["playwright", "test", "--list", "--project=chromium", "--reporter=json"],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      shell: process.platform === "win32",
    },
  );
  if (run.status !== 0) {
    fail(`playwright --list failed:\n${run.stderr || run.stdout}`);
  }
  const report = JSON.parse(run.stdout);
  const countTests = (suite) =>
    (suite.specs ?? []).reduce((n, spec) => n + spec.tests.length, 0) +
    (suite.suites ?? []).reduce((n, child) => n + countTests(child), 0);
  return report.suites.map((suite) => ({
    file: toPosix(suite.file),
    path: toPosix(relative(ROOT, join(report.config.rootDir, suite.file))),
    tests: countTests(suite),
  }));
}

/** Longest-processing-time assignment of weighted units to *total* shards. */
function assign(units, total) {
  const shards = Array.from({ length: total }, () => ({ load: 0, units: [] }));
  const ordered = [...units].sort(
    (a, b) => b.weight - a.weight || a.name.localeCompare(b.name),
  );
  for (const unit of ordered) {
    const target = shards.reduce((best, shard) =>
      shard.load < best.load ? shard : best,
    );
    target.load += unit.weight;
    target.units.push(unit);
  }
  return shards;
}

function plan({ options }) {
  const match = /^(\d+)\/(\d+)$/.exec(options.shard ?? "");
  if (!match) fail("expected --shard <current>/<total>, e.g. --shard 1/4");
  const [current, total] = [Number(match[1]), Number(match[2])];
  if (total < 1 || current < 1 || current > total) {
    fail(`invalid shard ${options.shard}`);
  }

  const specs = listSpecs();
  if (specs.length === 0) fail("Playwright listed no spec file");
  const timings = readTimings();
  const known = specs.filter((spec) => spec.file in timings);
  const knownTests = known.reduce((n, spec) => n + spec.tests, 0);
  const knownSeconds = known.reduce((s, spec) => s + timings[spec.file], 0);
  const perTest = knownTests > 0 ? knownSeconds / knownTests : 20;
  const unknown = specs.filter((spec) => !(spec.file in timings));
  if (unknown.length > 0) {
    console.error(
      `No measured duration for ${unknown.map((s) => s.file).join(", ")}; ` +
        `estimated at ${perTest.toFixed(1)} s per test. Refresh ` +
        "tests/e2e/shard-timings.json from the e2e-shard-timings CI artifact.",
    );
  }
  const weightOf = (spec) => timings[spec.file] ?? spec.tests * perTest;

  const warm = [];
  const units = [];
  for (const spec of specs) {
    const source = readFileSync(resolve(ROOT, spec.path), "utf8");
    if (WARM_IMPORT_RE.test(source)) warm.push(spec);
    else units.push({ name: spec.file, specs: [spec], weight: weightOf(spec) });
  }
  if (warm.length > 0) {
    units.push({
      name: "fixtures-warm",
      specs: warm,
      weight: warm.reduce((s, spec) => s + weightOf(spec), 0),
    });
  }

  const shards = assign(units, total);
  shards.forEach((shard, index) => {
    const names = shard.units.map((u) =>
      u.specs.length > 1
        ? `[${u.specs.map((s) => s.file).join(", ")}]`
        : u.name,
    );
    const marker = index + 1 === current ? "*" : " ";
    console.error(
      `${marker} shard ${index + 1}/${total}: ~${(shard.load / 60).toFixed(1)} min, ` +
        names.sort().join(", "),
    );
  });
  const selected = shards[current - 1].units
    .flatMap((unit) => unit.specs.map((spec) => spec.path))
    .sort();
  if (selected.length === 0) {
    // An empty file filter would make Playwright run the whole suite.
    fail(`shard ${current}/${total} is empty; use fewer shards`);
  }
  writeOutput(selected.join("\n") + "\n", options.output);
}

/**
 * Wall-clock cost of each spec file in one serial (``workers: 1``) report.
 *
 * Each result is charged the time elapsed since the previous one ended, so a
 * ``beforeAll`` hook counts for its file. A worker-scoped fixture (the
 * ``warmPage`` boot) is set up after its first test's ``startTime`` but
 * outside its ``duration``: it is charged to the next test of the same worker
 * group, or to the last test for the time remaining until the run ends. The
 * costs of a report thus add up to its wall-clock duration.
 */
function measure(report) {
  const results = [];
  const collect = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        for (const result of test.results) {
          const start = Date.parse(result.startTime);
          results.push({ file, start, end: start + result.duration });
        }
      }
    }
    for (const child of suite.suites ?? []) collect(child, file);
  };
  for (const suite of report.suites) collect(suite, toPosix(suite.file));
  results.sort((a, b) => a.start - b.start);
  const costs = {};
  const runStart = Date.parse(report.stats?.startTime ?? "");
  let previousEnd = Number.isNaN(runStart) ? null : runStart;
  for (const { file, start, end } of results) {
    const elapsed = previousEnd === null ? end - start : end - previousEnd;
    costs[file] = (costs[file] ?? 0) + Math.max(end - start, elapsed);
    previousEnd = Math.max(previousEnd ?? end, end);
  }
  const runEnd = runStart + (report.stats?.duration ?? NaN);
  const last = results.at(-1);
  if (last && !Number.isNaN(runEnd) && runEnd > previousEnd) {
    costs[last.file] += runEnd - previousEnd;
  }
  return costs;
}

function timings({ positional, options }) {
  if (positional.length === 0) fail("expected Playwright JSON report files");
  const merged = readTimings();
  for (const reportPath of positional) {
    const costs = measure(JSON.parse(readFileSync(reportPath, "utf8")));
    const seconds = Object.values(costs).reduce((s, ms) => s + ms, 0) / 1000;
    console.error(`${reportPath}: ${(seconds / 60).toFixed(1)} min`);
    for (const [file, ms] of Object.entries(costs)) {
      merged[file] = Math.round(ms / 1000);
    }
  }
  const testDir = dirname(TIMINGS);
  const sorted = Object.fromEntries(
    Object.keys(merged)
      .filter((file) => existsSync(join(testDir, file)))
      .sort()
      .map((file) => [file, merged[file]]),
  );
  writeOutput(JSON.stringify(sorted, null, 2) + "\n", options.output);
}

const [command, ...rest] = process.argv.slice(2);
const commands = { plan, timings };
if (!(command in commands)) {
  fail("usage: e2e-shards.mjs plan --shard N/M | timings <report.json>...");
}
commands[command](parseArgs(rest));
