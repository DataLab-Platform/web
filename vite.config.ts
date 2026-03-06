import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pythonHmr } from "./plugins/vite-plugin-python-hmr";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), pythonHmr()],
  // Static deployment friendly: relative paths so it works from any sub-path
  // (e.g. GitHub Pages project sites).
  base: "./",
  server: {
    port: 5173,
    // NOTE: do NOT enable Cross-Origin-Embedder-Policy=require-corp here.
    // It would block the Pyodide CDN <script> tag (loaded without
    // `crossorigin`) and silently break the whole runtime.  Basic Pyodide
    // does not need cross-origin isolation; only SharedArrayBuffer-based
    // threading does.  Re-enable later together with a `crossorigin`
    // attribute on the <script> tag if we ever opt into Pyodide threading.
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  // Make Python source files importable as raw strings.
  assetsInclude: ["**/*.py"],
});
