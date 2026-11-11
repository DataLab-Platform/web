import { defineConfig, devices } from "@playwright/test";

/**
 * Check harness of the Showcase mode (``src/showcase/``).
 *
 * The showcase plays inside DataLab Web itself (started by its URL, no
 * Playwright driving): ``tests/e2e/showcase/showcase.spec.ts`` only opens
 * ``/?showcase=…`` and checks the results published by the player in
 * ``window.__showcase``. Opt-in, never exercised by the regression suite
 * (the main ``playwright.config.ts`` ignores ``showcase/``):
 *
 *   * ``showcase-check`` (``npm run showcase:check``): headless, check mode
 *     (no pauses, no overlays, one pass) — keeps the demos working;
 *   * ``showcase-headed`` (``npm run showcase:headed``): headed, at human
 *     pace with the overlays, for a visual review.
 */
const BASE_URL = "http://localhost:5173";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [/showcase[\\/]showcase\.spec\.ts/],
  outputDir: "./test-results/showcase",
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "showcase-check",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: "showcase-headed",
      timeout: 60 * 60_000,
      use: {
        ...devices["Desktop Chrome"],
        headless: false,
        viewport: { width: 1600, height: 900 },
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
