# Temporary shims: registry & version audit

DataLab-Web runs [Sigima](https://github.com/DataLab-Platform/Sigima) and [guidata](https://github.com/PlotPyStack/guidata) inside Pyodide, installed at runtime from PyPI by `micropip` (plus the scientific stack — `numpy`, `scipy`, `h5py` — bundled with the pinned Pyodide build). Because the browser pulls _released_ wheels, we occasionally need to **backport** a feature or **patch a bug** that is already fixed upstream but not yet shipped in a release. Those patches are **temporary shims**: they must disappear the moment the runtime resolves an upstream version that ships the feature natively.

This page documents the mechanism that keeps those shims discoverable, traceable and auditable. It is written for both human contributors and AI coding agents.

## TL;DR

- **One source of truth**: every backport shim is declared once in [src/runtime/shims/registry.ts](../src/runtime/shims/registry.ts) (`SHIM_REGISTRY`).
- **Sentinel markers** in the source: inline shims are wrapped in `# TEMPORARY SHIM` / `# END TEMPORARY SHIM`, and every shim carries a `@shim-registry: <id>` tag pointing back to its registry entry.
- **Anti-drift test** ([tests/ts/shims/shim-registry.test.ts](../tests/ts/shims/shim-registry.test.ts)) runs in `npm test`, needs no network, and **fails CI** if the registry, the on-disk sources and the markers drift apart — in particular when a new `TEMPORARY SHIM` block is added without registering it.
- **Version audit** ([tests/ts/shims/shim-audit.spec.ts](../tests/ts/shims/shim-audit.spec.ts)) is **report-only**, hits the network, and is run on demand via `npm run audit:shims` or the **🔍 Audit shims (versions)** VS Code task. It tells you which shims are now removable.
- **Ground-truth probe** ([tests/e2e/shim_versions_probe.spec.ts](../tests/e2e/shim_versions_probe.spec.ts)) boots a real Pyodide instance and reads the versions actually installed (`DataLabRuntime.getInstalledVersions()`), then classifies each shim against them and writes `audit/runtime-versions.json`.

## What counts as a shim

| Kind                                                                                                                                                                                | `kind`            | In the registry?            | Audited?                                                                                          | Examples |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------- | -------- |
| **Backport** — patches/backports a feature into a released upstream package; expected to be deleted at a known (or yet-unknown) upstream version                                    | `"backport"`      | **Yes**                     | `guidata.dataset.backends` shim, the Sigima `xyarray` edit-preservation shim                      |
| **Architectural / portability** — a permanent, Qt-free reimplementation needed because the browser environment differs from the desktop; **never** expires with an upstream release | `"architectural"` | No (intentionally excluded) | `src/runtime/dlplugins/datalab/**`, `dlw_title_format.py`, the vendored `scripts/run_with_env.py` |

Only **backport** shims belong in `SHIM_REGISTRY`. Architectural layers are deliberately left out — auditing them against an upstream version would be meaningless.

## How versions are resolved

The audit mirrors exactly how the browser obtains each package, encoded in `PACKAGE_VERSION_SOURCES`:

| Package                  | How the runtime gets it                                           | Audit source                                                                                                         |
| ------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `guidata`, `sigima`      | `micropip.install([...])` **without a pin** → latest PyPI release | PyPI JSON API (`https://pypi.org/pypi/<pkg>/json` → `info.version`)                                                  |
| `numpy`, `scipy`, `h5py` | bundled with the pinned Pyodide build (`py.loadPackage`)          | `pyodide-lock.json` of the pinned `PYODIDE_VERSION` (from [src/runtime/workerBase.ts](../src/runtime/workerBase.ts)) |

The fast audit infers these versions **without booting Pyodide**, so it is cheap and CI-friendly. The ground-truth probe instead reads the versions actually resolved inside a live Pyodide instance via `DataLabRuntime.getInstalledVersions()` (backed by `importlib.metadata`), which is authoritative but pays the Pyodide cold-start cost. Both feed the same `classifyShim` logic.

A shim's `removableFrom` is the **minimum upstream version that ships the feature natively**. The audit compares it with the resolved installed version and classifies each shim:

- **`ready-to-remove`** — installed ≥ `removableFrom`: the shim can be deleted.
- **`pending`** — installed < `removableFrom`: keep it for now.
- **`unknown`** — `removableFrom` is `null` (the upstream change has not landed / been versioned yet).
- **`skipped`** — the version could not be resolved (e.g. offline).

## For contributors

### Adding a new temporary shim

1. **Write the shim** next to the code it patches. For an **inline** block, wrap it in sentinels and add the tag:

   ```python
   # ===========================================================================
   # TEMPORARY SHIM — REMOVE WHEN <package> >= <version> IS THE MINIMUM REQUIREMENT
   # ---------------------------------------------------------------------------
   # @shim-registry: my-shim-id
   # Why the shim exists, what upstream change fixes it, and a removal checklist.
   # ===========================================================================
   ...
   # ===========================================================================
   # END TEMPORARY SHIM
   # ===========================================================================
   ```

   For a **whole-file** shim, put the `# @shim-registry: <id>` tag in the module header comment (see [\_guidata_backends_shim.py](../src/runtime/_guidata_backends_shim.py)).

2. **Register it** in [src/runtime/shims/registry.ts](../src/runtime/shims/registry.ts) by appending a `ShimDescriptor` to `SHIM_REGISTRY`:
   - `id` — must match the `@shim-registry:` tag in the source.
   - `kind: "backport"`.
   - `targetPackage` — must be a key of `PACKAGE_VERSION_SOURCES` (add it there if the package is new).
   - `files` (whole-file shims) **or** `block` (inline shims, with the exact `startMarker` / `endMarker`).
   - `removableFrom` — the upstream version that makes it removable, or `null` if not yet known.
   - `upstreamRef`, `loadedBy` — for reviewers.

3. **Run `npm test`.** The anti-drift test will fail until the registry, the markers and the source agree. This is the safety net that prevents an unregistered shim from slipping in.

### Removing a shim once upstream catches up

1. Run **🔍 Audit shims (versions)** (`npm run audit:shims`). When a shim shows **`ready-to-remove`**, the installed upstream release already ships the feature.
2. Delete the shim source (the sentinel-delimited block or the whole file), inline any code that called it, and bump the relevant floor in [requirements-dev.txt](../requirements-dev.txt) if appropriate.
3. Remove its `ShimDescriptor` from `SHIM_REGISTRY`.
4. Run `npm test` (anti-drift must stay green) and the relevant Python / Playwright tests for the touched path.

### Running the audit

```powershell
npm run audit:shims          # report-only; needs network
```

or run the **🔍 Audit shims (versions)** task from the VS Code task list. The audit prints a table and never fails on an outdated shim — deciding _when_ to remove a shim is a human call.

## For AI agents

When you touch the runtime Python (`src/runtime/*.py`) and find yourself working around a bug or a missing feature in a _released_ `guidata` / `sigima` / scientific-stack version:

- **Treat it as a registry-tracked shim, not an ad-hoc patch.** Follow _Adding a new temporary shim_ above: sentinel markers + `@shim-registry: <id>` tag + a `ShimDescriptor` in `SHIM_REGISTRY`. The anti-drift test in `npm test` will reject the change otherwise.
- **Do not register architectural / portability code** (`dlplugins/datalab/**`, `dlw_title_format.py`, vendored `run_with_env.py`). Those are permanent; `SHIM_REGISTRY` is only for backports that expire at an upstream version.
- **Set `removableFrom` honestly.** Use the exact upstream version that ships the fix when you can verify it (check the sibling `guidata` / `Sigima` checkout's `__version__` and changelog); use `null` when the upstream change has not been released or versioned.
- **Never widen the audit to fail on outdated shims.** The version audit ([shim-audit.spec.ts](../tests/ts/shims/shim-audit.spec.ts)) is report-only by design; only the network-free anti-drift test ([shim-registry.test.ts](../tests/ts/shims/shim-registry.test.ts)) is allowed to fail CI.
- **Keep `.spec.ts` vs `.test.ts` straight.** The default `npm test` (Vitest `include: ["tests/ts/**/*.test.{ts,tsx}"]`) runs the anti-drift `*.test.ts` but **not** the network audit `*.spec.ts`. The audit runs only through `vitest.audit.config.ts`.
- **After any change here, run `npm test`** and confirm the anti-drift suite is green before declaring the work done.

## Files at a glance

| File                                                                              | Role                                                                                                  |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [src/runtime/shims/registry.ts](../src/runtime/shims/registry.ts)                 | Single source of truth: `SHIM_REGISTRY`, `PACKAGE_VERSION_SOURCES`, `compareVersions`, `classifyShim` |
| [tests/ts/shims/shim-registry.test.ts](../tests/ts/shims/shim-registry.test.ts)   | Network-free anti-drift test (part of `npm test`, **fails CI** on drift)                              |
| [tests/ts/shims/shim-audit.spec.ts](../tests/ts/shims/shim-audit.spec.ts)         | Report-only version audit (network; `npm run audit:shims`)                                            |
| [vitest.audit.config.ts](../vitest.audit.config.ts)                               | Vitest config that targets only the audit spec                                                        |
| [tests/e2e/shim_versions_probe.spec.ts](../tests/e2e/shim_versions_probe.spec.ts) | Ground-truth probe (boots Pyodide, writes `audit/runtime-versions.json`)                              |
