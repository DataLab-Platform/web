# Private WASM64 addition qualification

**This is a hand-off, not a claim that a >4 GiB operation passed.** Do not publish this build, run it on a shared workstation, or add these commands to CI. There is no benchmark at startup. The public demo and Pyodide do not install the generator. The private build only installs two fixed scientific commands in the actual WASM64 kernel on `127.0.0.1`; neither accepts Python or arbitrary shapes. The generator cannot run twice in one worker. The oracle does not perform the addition.

## Preflight and bounded check

From the repository root, prepare the [locked scientific assets](../../../tools/wasm64/README.md), npm dependencies, [native HDF5 reference and Chromium](../README.md). On the dedicated Windows x64 workstation also install stable 64-bit Edge. Do not use memory or experimental browser flags. The tree digest below identifies the exact local static artifact, including scientific assets, independently of the Git checkout.

```powershell
npm run wasm64:build -- --benchmark
node tools\wasm64\site-digest.mjs build\wasm64\benchmark
.\node_modules\.bin\playwright.cmd test --config tests\wasm64\benchmark\reference.config.ts
node tests\wasm64\benchmark\run.mjs smoke --small-only
```

The first test is the small HDF5 UI reference A on the same artifact. The second is an independent 577² smoke test; it exercises real selection, Properties, multiselection, Operations → Sum, automatic result selection and the bounded checker. Both use fresh static pages under `/web-wasm64/`, not the Vite development server. Repeat the small case separately if collecting timings; report browser, cache state, raw values and median. Do not extrapolate RAM limits or address witnesses from these cases.

**Bounded evidence, 2026-11-25:** Chromium 156.0.8078.4, static tree SHA-256 `2fa5e2bfbe3c38f55974f3db838f2a8e16e56356dc7b1278c6cc6b75ebbca0a5`. The 577² run verified all three arrays (5,326,864 bytes total, zero mismatches, extrema `[0,4608]`, zero provenance capture failures). Both boundaries recorded 1,048,576 / 2,097,152 / 1,048,576 bytes across the three interactions. The heap observation after verification was 346,554,368 bytes. The Windows renderer sampler produced a CSV. There was no UI tick strictly inside this short calculation; that witness is mandatory at the target tier. No dedicated tier was executed for this evidence.

## Dedicated run: one tier at a time

The person reserving the machine makes the go/no-go decision and personally runs each command. Close competing workloads. Record system/CPU, installed and **available** RAM, system commit and remaining commit capacity, effective process/job limit and how it was checked; use a 32 GiB or larger dedicated workstation with verified headroom. The guards check available physical and commit headroom (2/6/16 GiB respectively), not just installed memory. They are conservative floors, not an allocation guarantee. Stop if headroom is unclear. Use the same machine and unchanged build for every tier.

```powershell
$env:DLW_PROCESS_LIMIT_NOTE = Read-Host "Effective process/job limit and method used to check it"
node tests\wasm64\benchmark\run.mjs 2048 --dedicated=2048
```

Inspect the printed run directory and report before deciding whether to continue. Each higher tier requires the path to the preceding **successful** report for the identical artifact. Do not paste the following as a batch. A lock, single worker and zero retries prevent concurrent/automatic attempts. If the machine or test crashes, preserve the failed run and stop. Only clear a stale `build\wasm64\qualification.lock` after verifying that the prior runner, sampler and browser have actually exited; do not bypass a failure to start a higher tier.

```powershell
$previous = Read-Host "Full path to the reviewed 2048 report.json"
node tests\wasm64\benchmark\run.mjs 8192 --dedicated=8192 "$previous"
```

**Stop again.** Only after reviewing the 8192 measurements, rechecking available RAM and commit, and explicitly reserving the machine for the target run:

```powershell
$previous = Read-Host "Full path to the reviewed 8192 report.json"
node tests\wasm64\benchmark\run.mjs 18432 --dedicated=18432 "$previous"
```

## Evidence to retain

- `build/wasm64/runs/<UTC>-<tier>/report.json` records artifact SHA-256, browser/host, stage times, linear heap observations, logical resident array bytes and per-operation binary sizes at both boundaries. `renderer.csv` samples the test browser's renderer PIDs via CDP and Windows `Get-Process` approximately every 250 ms: timestamps, working set, lifetime peak working set and private bytes. `.host` records OS available bytes, commit and commit limit. Separate renderer PIDs; do not sum shared RSS and call it a process peak. The worker mirror cannot observe a transient allocation during synchronous `np.add`.
- Inputs are resident C-contiguous `float32` arrays, `A[i,j]=2i+j`, `B[i,j]=i+4j`, filled by bands. The normal `image:addition` catalogue path must record the `sigima.image.addition` contract, with provenance enabled and no capture failure. The unchanged `float64` result must be distinct and unaliased. The checker independently scans both sources and the result by bounded bands, verifies `3i+5j`, records extrema, and samples real element addresses including both sides of a crossing when present.
- The target requires exactly 5,435,817,984 final resident array bytes, extrema `[0,147448]`, zero mismatches, linear heap >2³², a checked operand or result element at an address ≥2³² and an actual main-thread tick inside the worker computation interval. The theoretical simultaneous minimum is **8,153,726,976 bytes** (two inputs plus two `float64` destinations), before runtime, provenance and UI. It is neither a measured RSS peak nor available memory.
- The image UI ships at most 512² `float32` samples per image, including the current image. Min/max are exact over finite native data; mean, standard deviation and median are explicitly not calculated at this scale. Contrast may be sampled. No exact pixel inspection, matrix copy/edit, graphical ROI, profile or pixel zoom uses preview values. The report checks distinct backing-buffer bytes, not just view lengths or the `postMessage` transfer list; the per-interaction maxima and totals must be 1 MiB, 2 MiB, 1 MiB at **each** boundary for first selection, pair selection and result selection. HDF5 transfer in A is separate.
- Archive the report and raw CSV even on failure. Missing output, OOM, timeouts, mismatches, a wrong engine, missing proof or unexpected transfers are failures. Report the last actually successful tier; a small pass does not qualify B. The command suitable for an optional `wasm64:test:b` npm alias is `node tests/wasm64/benchmark/run.mjs` (arguments follow `--`).
