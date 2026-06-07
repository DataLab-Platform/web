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

Playwright runs serially (`workers: 1`, ~3 min Pyodide boot per spec
file in CI), so adding E2E tests has a real, compounding cost. Treat
them as a scarce resource.

## Default suite vs perf project

The default Playwright project (`chromium`) runs the regression suite
and intentionally **excludes** performance benchmarks and `_repro_*`
throwaway probes. Performance specs live under a separate `perf`
project that must be opted into:

```powershell
npm run test:e2e                       # default chromium suite
npx playwright test --project=perf     # perf benchmarks only
PERF=1 npm run test:e2e                # default suite + PERF-gated tests
```

When you need a perf or budget-style probe, mark it with
`test.skip(!process.env.PERF, "...")` or move the spec under the
`perf` project's `testMatch` glob (currently `image_perf.spec.ts`).

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
   a multi-phase plan.
4. Apply the decision tree above. If promoting, write a single,
   well-named permanent spec covering the invariant. Delete the
   reproduction spec.
5. Briefly justify the decision in the PR description (why permanent
   or why throwaway).
