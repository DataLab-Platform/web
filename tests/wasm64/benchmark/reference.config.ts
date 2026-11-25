import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import reference from "../playwright.config";

/** Reuse A unchanged, but serve the identical private artifact as B. */
export default defineConfig({
  ...reference,
  testDir: fileURLToPath(new URL("../", import.meta.url)),
  outputDir: "../../../build/wasm64/benchmark-reference-results",
  webServer: {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    command:
      "npm run preview -- --outDir build/wasm64/benchmark --base /web-wasm64/ --host 127.0.0.1 --port 49139 --strictPort",
    url: "http://127.0.0.1:49139/web-wasm64/",
    reuseExistingServer: false,
  },
});
