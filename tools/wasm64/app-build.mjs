import { build } from "vite";
import { cp, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const benchmark = process.argv.includes("--benchmark");
const root = fileURLToPath(new URL("../../", import.meta.url));
const outDir = resolve(
  root,
  `build/wasm64/${benchmark ? "benchmark" : "demo"}`,
);
const assets = resolve(root, "build/wasm64/public");
await readFile(resolve(assets, "environment.json")); // No incomplete demo.
process.env.VITE_WASM64_DEMO = "1";
process.env.VITE_WASM64_BENCHMARK = benchmark ? "1" : "0";
await build({
  root,
  mode: "release",
  build: { outDir, emptyOutDir: true, sourcemap: false },
});
await cp(assets, outDir, { recursive: true });
for (const [source, target] of [
  ["LICENSE", "LICENSE.txt"],
  ["tools/wasm64/THIRD-PARTY.txt", "THIRD-PARTY.txt"],
  ["tools/wasm64/environment.lock.json", "package-inventory.json"],
])
  await cp(resolve(root, source), resolve(outDir, target));
