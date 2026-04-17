import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pythonHmr } from "./plugins/vite-plugin-python-hmr";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Absolute path to the slim Plotly dist file. ``react-plotly.js``
// hardcodes ``require("plotly.js/dist/plotly")`` (the *full* package),
// but we ship the much smaller ``plotly.js-dist-min``. The two expose
// the same default export shape, so redirecting the bare specifier is
// safe — both the main resolver and esbuild's dep optimizer need the
// alias (see ``resolve.alias`` and ``optimizeDeps.esbuildOptions``).
const PLOTLY_DIST_MIN = resolve(
  __dirname,
  "node_modules/plotly.js-dist-min/plotly.min.js",
);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), pythonHmr()],
  // Static deployment friendly: relative paths so it works from any sub-path
  // (e.g. GitHub Pages project sites).
  base: "./",
  resolve: {
    alias: {
      // See ``PLOTLY_DIST_MIN`` above.
      "plotly.js/dist/plotly": PLOTLY_DIST_MIN,
    },
  },
  optimizeDeps: {
    // Vite pre-bundles ``react-plotly.js`` with esbuild on the first
    // request; that pass uses its *own* resolver, independent of
    // ``resolve.alias`` above. Replicate the alias here so the dep
    // optimizer also redirects ``plotly.js/dist/plotly`` to the slim
    // dist package.
    esbuildOptions: {
      plugins: [
        {
          name: "alias-plotly-dist",
          setup(build) {
            build.onResolve(
              { filter: /^plotly\.js\/dist\/plotly$/ },
              () => ({ path: PLOTLY_DIST_MIN }),
            );
          },
        },
      ],
    },
  },
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
