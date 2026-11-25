import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const baseURL = "http://127.0.0.1:49149/web-wasm64/";
export default defineConfig({
  testDir: ".",
  testMatch: "addition.spec.ts",
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: 30 * 60_000,
  outputDir: process.env.DLW_B_OUTPUT
    ? `${process.env.DLW_B_OUTPUT}/playwright`
    : "../../../build/wasm64/b-discovery",
  use: {
    baseURL,
    locale: "en-US",
    actionTimeout: 20_000,
    serviceWorkers: "block",
    channel: process.env.DLW_B_TIER === "smoke" ? undefined : "msedge",
  },
  webServer: {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    command:
      "npm run preview -- --outDir build/wasm64/benchmark --base /web-wasm64/ --host 127.0.0.1 --port 49149 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
  },
});
