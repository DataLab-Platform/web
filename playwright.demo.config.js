import { defineConfig, devices } from "@playwright/test";
/**
 * Dedicated Playwright configuration for the marketing demo recording.
 *
 * This config is **opt-in** and is never exercised by the regression
 * suite (the main ``playwright.config.ts`` explicitly ignores
 * ``demo/demo.spec.ts``). It is driven by ``scripts/make-demo-gif.mjs``
 * (``npm run demo:gif``), which runs the single scripted demo with video
 * recording forced on, then converts the resulting WebM to an optimised
 * animated GIF with gifski.
 *
 * The viewport is fixed to a 16:10 desktop frame so the recording is
 * deterministic and crops cleanly when scaled down for the GIF.
 */
const VIEWPORT = { width: 1280, height: 800 };
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [/demo[\\/]demo\.spec\.ts/],
  outputDir: "./test-results/demo",
  // The demo drives a full Pyodide boot (~30-60 s) plus several
  // computation round-trips. 4 minutes is plenty for a healthy run while
  // still failing fast if a selector hangs (instead of waiting 10 min).
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    viewport: VIEWPORT,
    trace: "off",
    screenshot: "off",
    video: { mode: "on", size: VIEWPORT },
  },
  projects: [
    {
      name: "demo",
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORT },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
