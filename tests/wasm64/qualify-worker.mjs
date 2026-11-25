import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";

const coreOnly = process.argv[2] === "--core-only";
if (process.argv.length !== (coreOnly ? 3 : 2))
  throw new Error("Expected [--core-only]");
const root = new URL(
  coreOnly
    ? "../../tools/wasm64/node_modules/@derthorsten/pyjs/"
    : "../../build/wasm64/public/",
  import.meta.url,
);
if (!coreOnly) await readFile(new URL("environment.json", root));
const probe = await readFile(new URL("./worker-probe.mjs", import.meta.url));
const server = await preview({
  configFile: false,
  envFile: false,
  base: "/web-wasm64/",
  build: { outDir: fileURLToPath(root) },
  preview: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "standalone-worker-probe",
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = req.url?.split("?", 1)[0];
          if (path === "/web-wasm64/") {
            res.setHeader("Content-Type", "text/html");
            res.end("<title>Worker qualification</title>");
          } else if (path === "/web-wasm64/worker-probe.mjs") {
            res.setHeader("Content-Type", "text/javascript");
            res.end(probe);
          } else next();
        });
      },
    },
  ],
});
try {
  const { port } = server.httpServer.address();
  const base = `http://127.0.0.1:${port}/web-wasm64/`;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const blocked = [];
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      blocked.push(url);
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(base);
    const report = await page.evaluate(
      (core) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(
            core ? "./worker-probe.mjs?core" : "./worker-probe.mjs",
            { type: "module" },
          );
          const timeout = setTimeout(
            () => finish(new Error("worker timeout")),
            150_000,
          );
          let edited = false;
          function finish(error, value) {
            clearTimeout(timeout);
            worker.terminate();
            if (error) reject(error);
            else resolve(value);
          }
          worker.onerror = (event) => finish(new Error(event.message));
          worker.onmessage = ({ data }) => {
            if (data.kind === "edit") {
              if (edited || !data.schema || typeof data.schema !== "object")
                return finish(new Error("Invalid dialog"));
              edited = true;
              worker.postMessage({ sigma: 1.25 });
            } else if (data.kind === "done" && edited) {
              finish(null, { ...data, bytes: Array.from(data.bytes) });
            } else {
              finish(new Error(data.detail ?? "Unexpected worker event"));
            }
          };
        }),
      coreOnly,
    );
    assert.equal(report.arch, "wasm64");
    assert.equal(report.pointerBytes, 8);
    assert.equal(report.tier, coreOnly ? "core-only" : "science");
    assert.deepEqual(report.bytes, [3, 254]);
    assert.deepEqual(blocked, []);
    console.log(
      JSON.stringify({ browser: browser.version(), ...report }, null, 2),
    );
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
