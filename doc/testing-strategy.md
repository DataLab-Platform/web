# DataLab-Web testing strategy

> **Audience**: contributors and AI coding agents working on
> DataLab-Web. Read this before adding a new test layer for a bug fix
> or feature.

DataLab-Web has three test layers, each with very different
cost/coverage trade-offs:

| Layer                     | Tool         | Typical cost  | Best for                                          |
| ------------------------- | ------------ | ------------- | ------------------------------------------------- |
| Python (in-Pyodide logic) | pytest       | ~ms           | `bootstrap.py` helpers, JSON shapes, Sigima glue  |
| Component (TS/React)      | Vitest + RTL | ~10–100 ms    | Form behaviour, reducers, runtime mocks           |
| End-to-end (browser)      | Playwright   | ~10–60 s each | Multi-component interactions, runtime round-trips |

Playwright runs serially (`workers: 1`) and most of its time is spent booting Pyodide in fresh browser contexts (about 10–25 s per boot depending on the CI runner), so adding E2E tests has a real, compounding cost. Treat them as a scarce resource. CI splits the suite into parallel shards to keep its duration in check (see [CI shards](#ci-shards)).

A continuous layer ties the three together: GitHub Actions (`tests.yml`) runs all three on every push / PR. The Python layer runs `bootstrap.py` directly under CPython through fixtures that stub the Pyodide-only modules (`js`, `pyodide.ffi`); this gives fast feedback and high coverage without booting WebAssembly.

## Running the suites locally

```powershell
# One-time: copy the environment template and create the project venv
# (Python 3.11 or 3.12 — earlier versions trip a quirk in
# ``isinstance(list[T], type)`` that breaks Sigima's processor
# introspection).
Copy-Item .env.template .env
py -3.11 -m venv .venv
.\.venv\Scripts\python scripts\sigima_dependency.py install

# Python unit tests + coverage report (htmlcov-python/)
.\.venv\Scripts\python -m pytest tests/python --cov=src/runtime --cov-report=html:htmlcov-python

# TypeScript unit tests + coverage report (coverage-ts/)
npm test
npm run test:cov

# End-to-end browser tests (boots Pyodide in Chromium ~1.5 min)
npx playwright install chromium   # one-time
npm run test:e2e

# Performance benchmarks (opt-in). Includes image and signal display
# baselines plus the OPFS transfer/storage probes.
npx playwright test --project=perf

# Run a throwaway `_repro_*` probe (the default suite ignores them).
$env:PW_REPRO=1; npx playwright test --project=repro tests/e2e/_repro_x.spec.ts
```

The resolver reads [sigima-dependency.json](../sigima-dependency.json). Normal
test and performance CI use its `developmentRef` when one is configured;
release CI explicitly selects `publishedRequirement`. The browser receives a
development snapshot only as a wheel through `VITE_SIGIMA_INSTALL_SPEC`.
For rapid local iteration, the ignored `.env` may point to a wheel built from
the sibling checkout, and its `PYTHONPATH` may prioritize sibling Python
sources, but neither alters the versioned CI selection. Remove those local
overrides when qualifying the exact manifest-selected dependency.

The resolver applies the same rules to [guidata-dependency.json](../guidata-dependency.json), installing its `developmentRef` in CPython and exporting the matching browser wheel through `VITE_GUIDATA_INSTALL_SPEC`.

When qualifying a published Sigima version for release, use a clean environment
without `..\Sigima` in `PYTHONPATH` and without `VITE_SIGIMA_INSTALL_SPEC`.
This ensures both pytest and Playwright exercise the exact PyPI version rather
than a sibling checkout or cached local wheel.

Test layout:

```text
tests/
├── python/          # pytest suite — exercises bootstrap.py headlessly
├── ts/              # Vitest suite — pure TypeScript modules
└── e2e/             # Playwright specs — real browser smoke tests
```

VS Code tasks are provided under `.vscode/tasks.json` (`🚀 Pytest`, `🟢 Vitest`, `🎭 Playwright`, …). The default test task (`Ctrl+Shift+P → Run Test Task`) launches the Python suite.

## Default suite vs perf project

The default Playwright project (`chromium`) runs the regression suite and intentionally **excludes** performance benchmarks and `_repro_*` throwaway probes. The costly `perf` and `benchmark` projects are **opt-in**: each is registered only when explicitly requested, either via its `--project=<name>` flag or its `PW_<NAME>` env var (see `wantsProject` in [playwright.config.ts](../playwright.config.ts)). A bare `playwright test` — and therefore the default CI run, which calls `npm run test:e2e` (`--project=chromium`) — never pays for them.

```powershell
npm run test:e2e                       # default chromium suite (CI default)
npm run test:e2e:perf                  # perf benchmarks only (--project=perf)
npx playwright test --project=perf     # same, explicit form
```

When you need a perf or budget-style probe, add the spec to the `perf` project's `testMatch` glob (currently `image_perf.spec.ts`, `signal_perf.spec.ts`, `opfs_storage_bench.spec.ts`, `opfs_sync_spike.spec.ts`, `opfs_worker_bench.spec.ts`). The default `chromium` project must ignore the same file so an ordinary E2E run remains cheap.

## CI shards

In [tests.yml](../.github/workflows/tests.yml) and [release.yml](../.github/workflows/release.yml), the `chromium` suite runs as four parallel jobs (`End-to-end (Playwright n/4)`), each on its own runner with the usual serial settings (`workers: 1`, fresh context per test), so each test runs in the same conditions as in a single serial run. Run serially, the suite takes 15 to more than 40 minutes depending on the speed of the runner it lands on.

Playwright's own `--shard` option assigns consecutive files by test count, which is badly unbalanced here because the cost of a spec depends on how many times it boots Pyodide. [scripts/e2e-shards.mjs](../scripts/e2e-shards.mjs) assigns whole spec files instead:

- the spec list comes from `playwright test --list --project=chromium`, so every regression spec runs in exactly one shard and `testIgnore` is honoured;
- files are balanced using the durations recorded in [tests/e2e/shard-timings.json](../tests/e2e/shard-timings.json); a spec missing from that table is estimated from its number of tests;
- specs using the worker-scoped `warmPage` fixture (`fixtures-warm.ts`) stay in the same shard, so they keep sharing one boot as in a serial run.

The `End-to-end (Playwright report)` job merges the shard reports into the usual `playwright-report` artifact and publishes the durations measured in every shard as the `e2e-shard-timings` artifact. When the shards drift apart (for example after adding a costly spec), replace `tests/e2e/shard-timings.json` with that artifact's content. Each shard also logs the runner's CPU model, to tell a slow runner from a slower suite.

```powershell
node scripts/e2e-shards.mjs plan --shard 2/4      # print the spec files of shard 2
```

## Performance benchmarks: on-demand CI and regression tracking

Perf benchmarks take minutes, and only part of what they measure is deterministic: structural metrics (payload and file sizes, point counts, the heap of the disk mode that must stay flat) depend on the code alone, whereas durations and the growth of the WebAssembly heap in RAM mode depend on the runner, the browser and the allocator. Re-running them on every commit (or on a fixed schedule) would add noise, not signal. They are therefore driven by a dedicated, opt-in workflow — [.github/workflows/perf.yml](../.github/workflows/perf.yml) — that runs the `perf` project (`npm run test:e2e:perf`) only when wanted:

- manually via **Run workflow** (`workflow_dispatch`);
- on a pull request labelled `run-perf` (opt-in per PR);
- on every push to `main` (release merges);
- on every `vX.Y.Z` release tag.

Results are tracked over time with [`benchmark-action/github-action-benchmark`](https://github.com/benchmark-action/github-action-benchmark) on the orphan `benchmarks` branch (open `dev/bench/determinist/index.html` or `dev/bench/timings/index.html` from that branch to view the charts). [scripts/perf-to-benchmark-json.mjs](../scripts/perf-to-benchmark-json.mjs) converts the raw result JSON into the action's `customSmallerIsBetter` format, splitting metrics into two groups with different policies:

- **Deterministic** (memory Δheap in MiB of the disk mode, actual typed-array payload bytes, points handed to Plotly, sizes of the saved workspace and of the exported capsules) — these make trustworthy gates. On a `run-perf` pull request, an increase beyond **125 %** of the baseline **fails the check** and comments on the PR. On `main` / tags the value is recorded but never fails (the change is already merged).
- **Trends** (milliseconds, and allocator-dependent memory such as the RAM-mode heap growth) — noisy on shared CI runners, so they are tracked with a wide **200 %** threshold and **never fail**; they exist purely for trend inspection. A duration measured on a shared runner is never turned into a blocking threshold.

`image_perf.spec.ts` separates the runtime queue/bridge measurement from the React grid commit and canvas paint. `signal_perf.spec.ts` covers 10 k, 100 k, 500 k and 1 M samples and records visible latency, Plotly point count, long tasks, hover, pan and zoom. A small `datalab-web:plot-rendered` event is emitted from the existing active-plot registry after `react-plotly` finishes; the shared `tests/e2e/helpers/plotlyMetrics.ts` helper installs its observers before navigation so first renders are not lost.

`provenance_capsule_perf.spec.ts` measures the provenance and capsule paths (captured processing, saving and reopening, consultation, data check, verification, capsule export, inspection and opening, open/close cycles, referenced workspaces, a long ledger and its Local replay list) in a fresh browser context per runtime and storage mode, and writes a report in the format described in DataLab-Capsule's `doc/performance.md`. `DLW_PERF_PROFILE` selects `quick` (default, every mode, small data), `representative` (worker, RAM and disk, 1000-activity ledger), `diagnostic` (main thread, RAM) or `capacity` (worker, close to the 256 MiB capsule limit); the workflow runs `quick`, the other profiles are run on a described computer. The perf workflow prepares DataLab-Capsule as the CI does and requires provenance (`DLW_REQUIRE_PROVENANCE=1`).

The cheap deterministic invariants encoded directly in the specs (data-integrity checksums, spill counts, the heap-decoupling `expect(...)`) still run wherever the `perf` project runs and fail fast on a broken guarantee, independent of the chart thresholds.

### Running a `_repro_*` throwaway probe

Because the `chromium` project `testIgnore`s `_repro_*` (so a forgotten probe never lands in CI) and `testIgnore` can't be overridden on the CLI, `npx playwright test tests/e2e/_repro_x.spec.ts` returns **"No tests found"**. Do **not** rename the file to run it. Instead use the env-gated `repro` project, which only exists when `PW_REPRO` is set (so CI, which runs a bare `playwright test`, is unaffected):

```powershell
$env:PW_REPRO=1; npx playwright test --project=repro tests/e2e/_repro_x.spec.ts
```

Run it from the `DataLab-Web` folder — if the terminal cwd is another workspace folder, `npx` can't find the local Playwright and stalls on a download prompt.

### Worker-mode coverage

The runtime can also run inside a Dedicated Web Worker (opt-in via
`?runtime=worker`; see [architecture.md](architecture.md) §3.3 and DEW
ADR #2). That path has its own failure surface — Pyodide boot in a
module worker, the `postMessage` RPC bridge, transferable buffers, the
synchronous mirror, and workspace-mutation events crossing back to the
main thread — which unit tests cannot reach. `tests/e2e/worker_mode.spec.ts`
is the **permanent** regression suite that exercises it in the default
`chromium` project, so it runs on every CI build. It boots the worker
runtime **once** (`describe.serial` + `beforeAll`) and shares the page
across assertions to amortise the cold boot. This suite is the gate for
ever promoting worker mode to the default execution mode.

## Decision tree for a bug fix

1. **Reproduce the bug with the cheapest possible probe.**
   - If the symptom is purely in `bootstrap.py` (or any
     JSON-serialisable contract): write a pytest test under
     `tests/python/`.
   - If the symptom is a React state/render bug isolatable from the
     runtime: write a Vitest + RTL test under `tests/ts/` (mock the
     runtime via the `DataLabRuntime` interface).
   - Only if neither layer can express the bug — it requires a real
     Pyodide round-trip or multi-component interaction — write a
     **throwaway Playwright spec** under `tests/e2e/_repro_*.spec.ts`.

2. **Fix the bug.**

3. **Decide whether the test becomes permanent**, using the matrix
   below. Default to **throwaway** unless promotion is justified.

### Promote to a permanent test when

- **A cheaper layer cannot express the invariant.** A Vitest test that
  needs to mock half of `DataLabRuntime` and Pyodide's behaviour
  duplicates production code; an E2E is honest in that case.
- **The bug touches a foundational contract** you're now committing to
  (e.g. "the side panel always reflects the selected object", "ROIs
  survive a reload", "running a feature never corrupts the object
  tree"). These are the invariants users would notice immediately if
  broken; permanent tests pay back over many refactors.
- **The mechanism is subtle** (race conditions, stale state across
  async boundaries, Pyodide bridge marshalling) and likely to regress
  silently.

### Keep as a throwaway probe when

- The bug is in **first-implementation code** that's likely to be
  rewritten or restructured soon.
- The fix is **structurally obvious** (e.g. adding a missing `null`
  guard) and unlikely to be undone.
- The bug class is **prevented by a type-system or lint change** —
  prefer the prevention to a test.
- The scenario is **already implicitly covered** by an existing test
  (don't add per-bug duplicates of the same coverage).

## Authoring rules for permanent E2E tests

When you do promote a test to permanent E2E:

- **One spec per invariant, multiple `test()` cases inside.** Spec
  startup (Pyodide boot, page navigation) dominates wall time; sharing
  it across related cases keeps the suite cheap.
- **Test the contract, not the implementation.** Assertions should
  read like product requirements ("size input matches the selected
  signal's backend size"), not like UI snapshots.
- **Use the runtime API for setup**, the UI for the action under test,
  and **both** for assertions. Cross-checking UI vs. backend catches
  the largest class of stale-state bugs.
- **Generous timeouts** (`waitForRuntimeReady`, then explicit polls);
  the suite already runs slowly, retries hide flakes worse than long
  expects.
- **Name the spec after the invariant**, not the bug
  (`side_panel_mirrors_selection.spec.ts`, not
  `fix_creation_form_swap_bug.spec.ts`).

## Mandatory rule for UI changes

**Every change to the UI must be exercised end-to-end with Playwright
before it is considered done.** This applies to:

- Every bug fix that touches a React component or runtime call.
- Every new feature, however small.
- **Every phase** of a multi-phase implementation — not only the final
  phase. If a feature is split into Phase 1 (backend) → Phase 2 (UI
  wiring) → Phase 3 (polish), Phase 2 and Phase 3 each need their own
  Playwright pass before being declared complete.

The Playwright pass can be:

- A **throwaway probe** under `tests/e2e/_repro_*.spec.ts` (deleted
  afterwards) — sufficient for incremental progress, refactors, and
  fixes that don't meet the promotion criteria below.
- A **permanent spec** when the criteria in
  _Promote to a permanent test when_ are met.

The point is not to grow the suite, it is to **never declare a UI
change done based solely on type-checks, unit tests, or "looks fine in
the dev server"** — Pyodide round-trips and async state interactions
silently break in ways only a browser-driven test catches reliably.

## Workflow for AI agents

When asked to implement or fix anything that touches the UI:

1. Reproduce / scope the change with a temporary
   `tests/e2e/_repro_*.spec.ts` (delete afterwards) — confirm the
   starting state and the target behaviour before coding.
2. Apply the change.
3. **Run Playwright** on the temporary spec to verify. **No UI work is
   declared done without this step**, including intermediate phases of
   a multi-phase plan. Run a `_repro_*` probe through the env-gated
   `repro` project (a bare run ignores it):
   `$env:PW_REPRO=1; npx playwright test --project=repro tests/e2e/_repro_x.spec.ts`
   (see _Running a `\_repro_\*` throwaway probe\_ above).
4. Apply the decision tree above. If promoting, write a single,
   well-named permanent spec covering the invariant. Delete the
   reproduction spec.
5. Briefly justify the decision in the PR description (why permanent
   or why throwaway).
