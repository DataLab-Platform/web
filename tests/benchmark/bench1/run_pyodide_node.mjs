#!/usr/bin/env node
/**
 * Bench #1 — Pyodide in Node.js driver.
 *
 * Boots Pyodide standalone (no browser, no DataLab-Web React UI), installs
 * Sigima + guidata via micropip, then runs the shared chain runner.
 *
 * Requires the ``pyodide`` npm package, version-pinned to match
 * ``src/runtime/runtime.ts``'s ``PYODIDE_VERSION`` (currently ``v0.26.4``).
 * Install on demand with::
 *
 *     npm install --save-dev pyodide@0.26.4
 *
 * Usage::
 *
 *     node tests/benchmark/bench1/run_pyodide_node.mjs [--runs N] [--warmup N]
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHARED = resolve(HERE, "..", "shared");
const RESULTS = resolve(HERE, "..", "results");
const WHEELS = resolve(HERE, "..", ".cache", "wheels");

function findLocalSigimaWheel() {
  if (!existsSync(WHEELS)) return null;
  const hit = readdirSync(WHEELS).find(
    (f) => f.startsWith("sigima-") && f.endsWith(".whl"),
  );
  return hit ? resolve(WHEELS, hit) : null;
}

function parseArgs() {
  const args = { runs: null, warmup: null, tag: "" };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--runs") args.runs = Number(argv[++i]);
    else if (a === "--warmup") args.warmup = Number(argv[++i]);
    else if (a === "--tag") args.tag = String(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs();

  let loadPyodide;
  try {
    ({ loadPyodide } = await import("pyodide"));
  } catch (err) {
    console.error(
      "[bench1/pyodide_node] The `pyodide` npm package is not installed.\n" +
        "Install it first:  npm install --save-dev pyodide@0.26.4\n" +
        "Original error:    " + err.message,
    );
    process.exit(2);
  }

  const chainJson = await readFile(resolve(SHARED, "chain.json"), "utf-8");
  const chain = JSON.parse(chainJson);
  const chainRunner = await readFile(
    resolve(SHARED, "chain_runner.py"),
    "utf-8",
  );

  const nWarmup = args.warmup ?? Number(chain.warmup_runs ?? 1);
  const nRuns = args.runs ?? Number(chain.measured_runs ?? 5);

  console.log(
    `[bench1/pyodide_node] Booting Pyodide… (warmup=${nWarmup} measured=${nRuns} ` +
      `N=${chain.n_images} size=${chain.image_size}²)`,
  );

  const tColdStart = performance.now();
  const py = await loadPyodide();
  // Pin the Pyodide locale to ``C`` to mirror DataLab-Web (gettext
  // returns the original English msgid strings, so labels are stable).
  await py.runPythonAsync(`
import os
os.environ["LANG"] = "C"
os.environ["LANGUAGE"] = "C"
`);
  await py.loadPackage([
    "numpy",
    "scipy",
    "scikit-image",
    "pandas",
    "pywavelets",
    "h5py",
    "micropip",
  ]);

  const wheelPath = findLocalSigimaWheel();
  if (wheelPath) {
    const wheelBytes = await readFile(wheelPath);
    const wheelName = wheelPath.split(/[\\/]/).pop();
    py.FS.writeFile(`/tmp/${wheelName}`, wheelBytes);
    py.globals.set("__bench_wheel", `/tmp/${wheelName}`);
    await py.runPythonAsync(`
import micropip
await micropip.install(["guidata", "makefun"])
import sys
if __bench_wheel not in sys.path:
    sys.path.insert(0, __bench_wheel)
import sigima  # verify
`);
    console.log(`[bench1/pyodide_node] Using local Sigima wheel: ${wheelName}`);
  } else {
    await py.runPythonAsync(`
import micropip
await micropip.install(["sigima", "guidata"])
`);
    console.log(
      "[bench1/pyodide_node] Using PyPI Sigima (run scripts/build_wheels.mjs to pin local).",
    );
  }
  // Make the shared chain_runner importable.
  py.FS.writeFile("/home/pyodide/chain_runner.py", chainRunner);
  await py.runPythonAsync(`
import sys
if "/home/pyodide" not in sys.path:
    sys.path.insert(0, "/home/pyodide")
import chain_runner  # warm import (parse + first-touch caches)
`);
  const coldStartMs = performance.now() - tColdStart;
  const sigmaVer = await py.runPythonAsync(
    "import sigima; sigima.__version__",
  );
  console.log(
    `[bench1/pyodide_node] Pyodide ready (sigima=${sigmaVer}, cold-start=${coldStartMs.toFixed(0)} ms).`,
  );

  await mkdir(RESULTS, { recursive: true });
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

  for (let runIdx = 0; runIdx < nWarmup + nRuns; runIdx += 1) {
    const isWarmup = runIdx < nWarmup;
    const label = isWarmup ? "warmup" : `run ${runIdx - nWarmup + 1}/${nRuns}`;

    // Pass the chain JSON through Python globals to avoid f-string escaping.
    py.globals.set("__bench_chain_json", chainJson);
    const t0 = performance.now();
    const resultJson = await py.runPythonAsync(`
from chain_runner import run_chain_from_json_str
run_chain_from_json_str(__bench_chain_json)
`);
    const wallMs = performance.now() - t0;
    const result = JSON.parse(resultJson);

    const payload = {
      bench: "bench1",
      backend: "pyodide_node",
      warmup: isWarmup,
      run_index: runIdx,
      wall_ms: wallMs,
      cold_start_ms: isWarmup && runIdx === 0 ? coldStartMs : null,
      pyodide_version: py.version,
      node_version: process.version,
      platform: `${process.platform}-${process.arch}`,
      sigima_version: sigmaVer,
      timestamp_utc: timestamp,
      ...result,
    };

    const suffix = args.tag ? `_${args.tag}` : "";
    const fileName =
      `bench1_pyodide_node_${timestamp}_r${String(runIdx).padStart(2, "0")}` +
      `${isWarmup ? "_warmup" : ""}${suffix}.json`;
    const out = resolve(RESULTS, fileName);
    await writeFile(out, JSON.stringify(payload, null, 2), "utf-8");
    console.log(
      `  ${label.padStart(14)}: total=${result.total_ms.toFixed(0).padStart(8)} ms ` +
        `(wall=${wallMs.toFixed(0).padStart(8)} ms)  blobs=${result.blob_checksum}  → ${fileName}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
