import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Set this only for a server hosting the complete, assembled artifacts.
const qualificationOrigin = process.env.DLW_COEXISTENCE_ORIGIN;

// Two static app builds on ONE origin. No Vite middleware or runtime hook.
export default defineConfig({
  testDir: ".",
  testMatch: "coexistence.spec.ts",
  workers: 1,
  retries: 0,
  outputDir: "../../build/coexistence-results",
  use: {
    baseURL: qualificationOrigin || "http://127.0.0.1:49143",
    locale: "en-US",
    colorScheme: "light",
  },
  webServer: qualificationOrigin
    ? undefined
    : {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        command:
          "python -m http.server 49143 --bind 127.0.0.1 --directory build/coexistence",
        url: "http://127.0.0.1:49143/web-wasm64/",
        reuseExistingServer: false,
      },
});
