import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "workspace.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 480_000,
  outputDir: "../../build/wasm64/test-results",
  use: {
    baseURL: "http://127.0.0.1:49139/web-wasm64/",
    locale: "en-US",
    actionTimeout: 20_000,
  },
  webServer: {
    command:
      "npm run preview -- --outDir build/wasm64/demo --base /web-wasm64/ --host 127.0.0.1 --port 49139 --strictPort",
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    url: "http://127.0.0.1:49139/web-wasm64/",
    reuseExistingServer: false,
  },
});
