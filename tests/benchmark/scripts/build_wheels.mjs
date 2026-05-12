#!/usr/bin/env node
/**
 * Build a wheel of the local ``../Sigima`` checkout and stash it under
 * ``tests/benchmark/.cache/wheels/`` so the Pyodide-Node and Pyodide-Browser
 * benches install the *same* Sigima version that the CPython baseline picks
 * up via ``.env``.
 *
 * Re-run after every Sigima change you want reflected in the bench. The
 * existing wheel for the current ``sigima.__version__`` is left untouched
 * unless ``--force`` is passed.
 *
 * Usage::
 *
 *     node tests/benchmark/scripts/build_wheels.mjs           # idempotent
 *     node tests/benchmark/scripts/build_wheels.mjs --force   # rebuild
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH = resolve(HERE, "..");
const WHEELS = resolve(BENCH, ".cache", "wheels");
const SIGIMA_SRC = resolve(BENCH, "..", "..", "..", "Sigima");

const force = process.argv.includes("--force");

function pythonExe() {
  // Prefer the Python that DataLab-Web's .venv uses, fall back to PATH.
  const venv = resolve(BENCH, "..", "..", ".venv", "Scripts", "python.exe");
  if (existsSync(venv)) return venv;
  return process.platform === "win32" ? "python" : "python3";
}

function buildSigimaWheel() {
  if (!existsSync(SIGIMA_SRC)) {
    console.warn(`[wheels] Local Sigima checkout not found at ${SIGIMA_SRC}; skipping.`);
    return null;
  }
  mkdirSync(WHEELS, { recursive: true });

  if (force) {
    for (const f of readdirSync(WHEELS)) {
      if (f.startsWith("sigima-") && f.endsWith(".whl")) {
        rmSync(resolve(WHEELS, f));
      }
    }
  } else {
    const existing = readdirSync(WHEELS).find(
      (f) => f.startsWith("sigima-") && f.endsWith(".whl"),
    );
    if (existing) {
      console.log(`[wheels] Reusing existing ${existing} (use --force to rebuild).`);
      return resolve(WHEELS, existing);
    }
  }

  console.log(`[wheels] Building Sigima wheel from ${SIGIMA_SRC}…`);
  const py = pythonExe();
  const res = spawnSync(
    py,
    ["-m", "build", "--wheel", SIGIMA_SRC, "--outdir", WHEELS],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (res.status !== 0) {
    throw new Error(`python -m build failed (exit ${res.status})`);
  }
  const built = readdirSync(WHEELS).find(
    (f) => f.startsWith("sigima-") && f.endsWith(".whl"),
  );
  if (!built) throw new Error("Wheel build reported success but no wheel file found.");
  console.log(`[wheels] OK → ${built}`);
  return resolve(WHEELS, built);
}

function main() {
  const wheel = buildSigimaWheel();
  if (wheel) {
    console.log(`[wheels] Sigima wheel ready at: ${wheel}`);
  }
}

main();
