/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));

/**
 * Vitest configuration for DataLab-Web.
 *
 * Two test suites live side-by-side:
 *
 * - ``tests/ts/``       → fast unit tests of TypeScript modules that do
 *                         **not** need Pyodide (action registry, menu
 *                         building, theme helpers, trust store, …).
 * - ``tests/pyodide/``  → smoke tests that boot a real Pyodide instance
 *                         under Node and exercise the bridge end-to-end
 *                         (kept opt-in via ``--project pyodide``).
 *
 * The default ``npm test`` only runs the ``ts`` project to keep CI fast.
 */
export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
  // Same Vite plumbing as the app, so ``?raw`` imports of .py files work
  // when components/runtime modules are imported transitively.
  assetsInclude: ["**/*.py"],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/ts/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/ts/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage-ts",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/main.tsx",
        // Python sources are tested under pytest.
        "src/runtime/**/*.py",
        // Pyodide-side runtime cannot be exercised in jsdom.
        "src/runtime/runtime.ts",
        "src/runtime/macroWorker.ts",
        "src/runtime/MacroRuntime.ts",
        "src/runtime/SigimaContext.tsx",
      ],
    },
  },
});
