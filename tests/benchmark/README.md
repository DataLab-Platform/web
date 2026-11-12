# DataLab Web vs DataLab Qt — comparative benchmark

Two image-processing benchmarks comparing the **same** processing chain across
runtimes:

- **Bench #1 — Pure processing (no UI):** Sigima as CPython vs Sigima inside
  Pyodide running under Node.js vs Sigima inside Pyodide running in a headless
  browser (raw Pyodide page, no React UI).
- **Bench #2 — Processing + visualization:** the same chain executed inside the
  full DataLab Qt GUI (in-process, `datalab_test_app_context`) vs the full
  DataLab-Web stack driven by Playwright.

The chain is defined once in [`shared/chain.json`](shared/chain.json) and
executed by a single runtime-agnostic module
[`shared/chain_runner.py`](shared/chain_runner.py). The same Python code runs
on CPython and inside Pyodide, so cross-runtime comparisons are apples-to-apples.

## Layout

```
tests/benchmark/
├── README.md
├── shared/
│   ├── chain.json          # chain definition (steps, N, image size, seed)
│   ├── chain_runner.py     # runs in CPython AND Pyodide
│   └── report.py           # aggregates JSON → results/report.md
├── bench1/
│   ├── run_cpython.py
│   ├── run_pyodide_node.mjs
│   ├── browser/index.html  # bare Pyodide host page (no React)
│   └── bench1_browser.spec.ts
├── bench2/
│   ├── run_datalab_qt.py
│   └── bench2_web.spec.ts
├── scripts/
│   ├── build_wheels.mjs    # builds a wheel of the sibling ../Sigima checkout
│   └── run_all.mjs
├── .cache/wheels/          # gitignored local Sigima wheels (npm run bench:wheels)
└── results/                # gitignored output (JSON + report.md)
```

## Quick start

Run the full pipeline (1 warm-up + 1 measured run per backend, then aggregate):

```powershell
npm run bench:run
```

Run only one backend (faster, useful while iterating):

```powershell
# Bench #1 — pure processing
python ../Sigima/scripts/run_with_env.py python tests/benchmark/bench1/run_cpython.py
node tests/benchmark/bench1/run_pyodide_node.mjs
npx playwright test tests/benchmark/bench1/bench1_browser.spec.ts --project=benchmark

# Bench #2 — processing + visualization
python ../DataLab/scripts/run_with_env.py python tests/benchmark/bench2/run_datalab_qt.py
npx playwright test tests/benchmark/bench2/bench2_web.spec.ts --project=benchmark
```

Regenerate the Markdown report from existing JSON files:

```powershell
npm run bench:report
```

## Methodology

- **1 warm-up run discarded + 1 measured run.** A single post-warm-up
  iteration is closer to the steady-state cost a user actually experiences;
  longer multi-iteration loops accumulate Pyodide-GC / DOM / React state
  that is **not representative of interactive use**.
- **Cold-start costs are reported separately** (Pyodide load, micropip install,
  Qt boot, Vite boot) and never folded into processing time.
- **Determinism:** the chain uses a fixed RNG seed; every backend computes the
  same checksum (sum of detected blob counts) so cross-runtime numerical drift
  is detected immediately.
- **Sigima version:** `sigima_version` in [`shared/chain.json`](shared/chain.json) is only reported (`null` appears as "local / latest available" in the report); each result file records the Sigima version actually used. CPython picks up the local `.env`, and the Bench #1 Pyodide backends (Node and browser) install the wheel built from the sibling `../Sigima` checkout by `npm run bench:wheels` (stored under `.cache/wheels/`), or else the latest PyPI release via micropip.
- **Calibration:** `n_images` in `chain.json` is set to 5 so the CPython
  baseline total runs in ~10 s on a reference machine; tune it for your
  hardware (note that Bench #2 Web scales roughly linearly and dominates
  the wall-clock time of the full suite).
- **Headless Chromium throttling:** the `benchmark` Playwright project sets
  `--disable-background-timer-throttling`,
  `--disable-backgrounding-occluded-windows`,
  `--disable-renderer-backgrounding` and
  `--disable-features=CalculateNativeWinOcclusion`. Without these flags,
  Chromium throttles V8/JIT and timers when the window loses focus,
  inflating Pyodide-Browser timings up to ×2.

## Notes & limitations

- Bench #2 visualization timing on the Qt side measures the time between
  `panel.add_object()` and the next `QCoreApplication.processEvents()` cycle
  that completes the plot's `replot()` — there is no direct equivalent of
  Plotly's `afterplot` event in PlotPy.
- The Pyodide-in-Node backend (`run_pyodide_node.mjs`) requires the `pyodide` npm package, a devDependency declared as `^0.26.4` (locked to 0.26.4 in `package-lock.json`): keep it on the release of `PYODIDE_VERSION` (`src/runtime/runtime.ts`, `src/runtime/workerBase.ts`).
