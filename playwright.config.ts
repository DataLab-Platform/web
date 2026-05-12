import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for DataLab-Web end-to-end tests.
 *
 * The first page load downloads Pyodide (~10 MB) and installs Sigima via
 * micropip, so the CI-friendly defaults below give the boot sequence a
 * generous timeout. The Vite dev server is reused locally and started
 * fresh in CI.
 *
 * Two projects are defined:
 *
 *   * ``chromium`` (default) — the regression suite. Excludes
 *     performance benchmarks and ``_repro_*`` throwaway probes.
 *   * ``perf`` (opt-in) — performance-only specs (``image_perf``,
 *     and any ``PERF``-gated tests). Run with
 *     ``npx playwright test --project=perf``.
 */
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
        /_repro_.*\.spec\.ts/,
        /tests[\\/]benchmark[\\/]/,
      ],
    },
    {
      name: "perf",
      use: { ...devices["Desktop Chrome"] },
      testMatch: [/image_perf\.spec\.ts/],
      timeout: 600_000,
    },
    {
      // Comparative benchmark suite (DataLab Web vs DataLab Qt). Opt-in
      // only — these specs run for tens of minutes and produce JSON
      // result files under ``tests/benchmark/results/``. Run with
      // ``npx playwright test --project=benchmark`` or via
      // ``npm run bench:run`` (orchestrator script).
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
