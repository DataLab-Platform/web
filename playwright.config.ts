import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for DataLab-Web end-to-end tests.
 *
 * The first page load downloads Pyodide (~10 MB) and installs Sigima via
 * micropip, so the CI-friendly defaults below give the boot sequence a
 * generous timeout. The Vite dev server is reused locally and started
 * fresh in CI.
 *
 * Projects are defined, but the costly ones are **opt-in**: a project
 * only exists when it is explicitly requested, either via its
 * ``--project=<name>`` flag or its ``PW_<NAME>`` env var. A bare
 * ``playwright test`` (and therefore the default CI run, which calls
 * ``npm run test:e2e`` → ``--project=chromium``) thus runs the cheap
 * regression suite only — never the multi-minute benchmarks.
 *
 *   * ``chromium`` (default) — the regression suite. Excludes
 *     performance benchmarks and ``_repro_*`` throwaway probes.
 *   * ``perf`` (opt-in) — performance-only specs (``image_perf``,
 *     ``opfs_*_bench``). Run with ``npx playwright test --project=perf``
 *     or ``npm run test:e2e:perf``. The on-demand ``perf`` CI workflow
 *     drives this project (see ``.github/workflows/perf.yml``).
 *   * ``benchmark`` (opt-in) — comparative Web-vs-Qt suite under
 *     ``tests/benchmark/``. Long-running and dependency-heavy; kept
 *     manual (``npm run bench:run`` / ``--project=benchmark``).
 *   * ``repro`` (opt-in, env-gated) — throwaway ``_repro_*`` probes.
 *     The ``chromium`` project ``testIgnore``s ``_repro_*`` so a
 *     forgotten probe never lands in CI, but that also means a probe
 *     can't be run by file path (``testIgnore`` can't be overridden on
 *     the CLI). Rather than renaming the file, set ``PW_REPRO=1`` and
 *     target this project, e.g. (PowerShell):
 *       ``$env:PW_REPRO=1; npx playwright test --project=repro tests/e2e/_repro_x.spec.ts``
 *
 * Each opt-in project below is gated by ``wantsProject(name)`` so that
 * it is present only when explicitly targeted on the CLI or via env.
 */

/**
 * Whether an opt-in project should be registered. True when the project
 * is targeted on the CLI (``--project=<name>`` / ``--project <name>``)
 * or when its ``PW_<NAME>`` env var is set. Keeping the costly ``perf``
 * and ``benchmark`` projects absent otherwise guarantees a bare
 * ``playwright test`` can never resurrect the multi-minute benchmark
 * run in CI.
 *
 * NB: Playwright re-evaluates this config in every **worker** process,
 * where ``process.argv`` no longer carries the ``--project`` flag. To
 * keep the project present in workers we mirror a CLI match into the
 * ``PW_<NAME>`` env var from the main process — child workers inherit
 * the environment at spawn time, so the gate stays consistent.
 */
const cliArgs = process.argv.slice(2).join(" ");
function wantsProject(name: string, envVar: string): boolean {
  if (process.env[envVar]) return true;
  const onCli = new RegExp(`--project(?:=|\\s+)${name}(?:\\s|$)`).test(cliArgs);
  if (onCli) {
    process.env[envVar] = "1";
    return true;
  }
  return false;
}
const includePerf = wantsProject("perf", "PW_PERF");
const includeBenchmark = wantsProject("benchmark", "PW_BENCH");
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // The image-display benchmark is a perf probe, not a regression
      // invariant; it lives under the ``perf`` project to keep the
      // default CI run cheap. ``_repro_*`` throwaway specs are also
      // excluded so a forgotten reproduction probe never lands in CI.
      testIgnore: [
        /image_perf\.spec\.ts/,
        /opfs_storage_bench\.spec\.ts/,
        /opfs_sync_spike\.spec\.ts/,
        /opfs_worker_bench\.spec\.ts/,
        /_repro_.*\.spec\.ts/,
        /tests[\\/]benchmark[\\/]/,
        // The demo-recording spec is opt-in: it is driven by its own
        // ``playwright.demo.config.ts`` (video on) via ``npm run demo:gif``
        // and must never run as part of the regression suite.
        /demo[\\/]demo\.spec\.ts/,
      ],
    },
    // Opt-in performance project — only present when targeted via
    // ``--project=perf`` or ``PW_PERF`` (see ``wantsProject`` above), so
    // a bare ``playwright test`` / the default CI run never pays for it.
    ...(includePerf
      ? [
          {
            name: "perf",
            use: { ...devices["Desktop Chrome"] },
            testMatch: [
              /image_perf\.spec\.ts/,
              /opfs_storage_bench\.spec\.ts/,
              /opfs_sync_spike\.spec\.ts/,
              /opfs_worker_bench\.spec\.ts/,
            ],
            timeout: 600_000,
          },
        ]
      : []),
    // Comparative benchmark suite (DataLab Web vs DataLab Qt). Opt-in
    // only — these specs run for tens of minutes and produce JSON
    // result files under ``tests/benchmark/results/``. Run with
    // ``npx playwright test --project=benchmark`` or via
    // ``npm run bench:run`` (orchestrator script). Gated by
    // ``wantsProject`` so it never runs unless explicitly requested.
    ...(includeBenchmark
      ? [
          {
            name: "benchmark",
            // Headless Chromium with explicit flags to defeat background-tab
            // throttling. By default a non-focused window (or any headless
            // window) gets throttled timers and de-prioritised V8 JIT, which
            // inflates Pyodide-Browser timings ×2 vs CPython. Disabling the
            // throttling brings the ratio down to ~×1.25 (in line with
            // Pyodide-Node) and is reproducible regardless of focus.
            use: {
              ...devices["Desktop Chrome"],
              launchOptions: {
                args: [
                  "--disable-background-timer-throttling",
                  "--disable-backgrounding-occluded-windows",
                  "--disable-renderer-backgrounding",
                  "--disable-features=CalculateNativeWinOcclusion",
                ],
              },
            },
            testDir: "./tests/benchmark",
            timeout: 120 * 60_000,
          },
        ]
      : []),
    // Opt-in throwaway-probe project — only present when ``PW_REPRO``
    // is set (see the file header for the rationale and the exact
    // command). Lets ``_repro_*`` probes run without renaming them,
    // while keeping them out of every CI run (CI runs a bare
    // ``playwright test`` and never sets ``PW_REPRO``).
    ...(process.env.PW_REPRO
      ? [
          {
            name: "repro",
            use: { ...devices["Desktop Chrome"] },
            testMatch: [/_repro_.*\.spec\.ts/],
          },
        ]
      : []),
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
