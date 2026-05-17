#!/usr/bin/env node
/**
 * Run every benchmark backend sequentially, then aggregate.
 *
 * Best-effort: each backend that fails (missing deps, etc.) is logged but
 * does NOT abort the pipeline — the report is generated from whatever
 * succeeded. This makes it easy to iterate on a single backend.
 *
 * Usage::
 *
 *     node tests/benchmark/scripts/run_all.mjs           # all backends
 *     node tests/benchmark/scripts/run_all.mjs --skip pyodide_node,datalab_qt
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");

function parseArgs() {
  const args = { skip: new Set() };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--skip") {
      const list = String(argv[++i] || "")
        .split(",")
        .map((s) => s.trim());
      list.filter(Boolean).forEach((s) => args.skip.add(s));
    }
  }
  return args;
}

function runStep(label, command, cmdArgs, opts = {}) {
  return new Promise((resolveStep) => {
    console.log(`\n=== ${label} ===`);
    console.log(`> ${command} ${cmdArgs.join(" ")}`);
    const child = spawn(command, cmdArgs, {
      stdio: "inherit",
      shell: process.platform === "win32",
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, ...(opts.env ?? {}) },
    });
    child.on("close", (code) => {
      if (code === 0) {
        console.log(`✓ ${label}`);
      } else {
        console.warn(`✗ ${label} (exit ${code}) — continuing`);
      }
      resolveStep(code);
    });
    child.on("error", (err) => {
      console.warn(`✗ ${label} (spawn error: ${err.message}) — continuing`);
      resolveStep(-1);
    });
  });
}

async function main() {
  const { skip } = parseArgs();

  const PY = (() => {
    // Prefer the local venv (npm scripts don't inherit the activated
    // shell, so plain ``python`` would resolve to the Microsoft Store
    // stub on Windows).
    const venv =
      process.platform === "win32"
        ? resolve(ROOT, ".venv", "Scripts", "python.exe")
        : resolve(ROOT, ".venv", "bin", "python");
    if (existsSync(venv)) return venv;
    return process.platform === "win32" ? "python" : "python3";
  })();

  // The DataLab Qt bench needs a venv with Qt bindings (PyQt5 / PySide6),
  // which the headless DataLab-Web venv doesn't have. Use ``../DataLab/.venv``
  // when present so the Qt path picks up its own scientific stack and Qt.
  const PY_QT = (() => {
    const venv =
      process.platform === "win32"
        ? resolve(ROOT, "..", "DataLab", ".venv", "Scripts", "python.exe")
        : resolve(ROOT, "..", "DataLab", ".venv", "bin", "python");
    return existsSync(venv) ? venv : PY;
  })();

  const steps = [
    {
      id: "cpython",
      label: "Bench #1 — CPython baseline",
      cmd: PY,
      args: [
        "../Sigima/scripts/run_with_env.py",
        PY,
        "tests/benchmark/bench1/run_cpython.py",
      ],
    },
    {
      id: "pyodide_node",
      label: "Bench #1 — Pyodide in Node.js",
      cmd: "node",
      args: ["tests/benchmark/bench1/run_pyodide_node.mjs"],
    },
    {
      id: "pyodide_browser",
      label: "Bench #1 — Pyodide in headless browser",
      cmd: "npx",
      args: [
        "playwright",
        "test",
        "tests/benchmark/bench1/bench1_browser.spec.ts",
        "--project=benchmark",
        "--reporter=list",
      ],
    },
    {
      id: "datalab_qt",
      label: "Bench #2 — DataLab Qt (in-process)",
      cmd: PY_QT,
      // Bypass ``run_with_env.py``: it overrides PYTHONPATH from
      // DataLab-Web's .env (which doesn't include ../DataLab). We set
      // the full PYTHONPATH here so ``import datalab`` resolves.
      args: ["tests/benchmark/bench2/run_datalab_qt.py"],
      env: {
        PYTHONPATH: [
          ".",
          resolve(ROOT, "..", "Sigima"),
          resolve(ROOT, "..", "guidata"),
          resolve(ROOT, "..", "PlotPy"),
          resolve(ROOT, "..", "PythonQwt"),
          resolve(ROOT, "..", "DataLab"),
        ].join(process.platform === "win32" ? ";" : ":"),
      },
    },
    {
      id: "datalab_web",
      label: "Bench #2 — DataLab-Web full stack",
      cmd: "npx",
      args: [
        "playwright",
        "test",
        "tests/benchmark/bench2/bench2_web.spec.ts",
        "--project=benchmark",
        "--reporter=list",
      ],
    },
  ];

  for (const step of steps) {
    if (skip.has(step.id)) {
      console.log(`\n--- Skipping ${step.id} ---`);
      continue;
    }
    await runStep(step.label, step.cmd, step.args, { env: step.env });
  }

  // Aggregate — always run, even if some backends failed.
  await runStep("Report aggregation", PY, ["tests/benchmark/shared/report.py"]);

  console.log(`\nReport: tests/benchmark/results/report.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
