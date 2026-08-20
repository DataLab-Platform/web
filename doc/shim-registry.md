# Temporary shims: registry & version audit

DataLab-Web runs [Sigima](https://github.com/DataLab-Platform/Sigima) and [guidata](https://github.com/PlotPyStack/guidata) inside Pyodide, installed at runtime from PyPI by `micropip` (plus the scientific stack — `numpy`, `scipy`, `h5py` — bundled with the pinned Pyodide build). Because the browser pulls _released_ wheels, we occasionally need to **backport** a feature or **patch a bug** that is already fixed upstream but not yet shipped in a release. Those patches are **temporary shims**: they must disappear once the runtime resolves an upstream version that ships the feature and focused tests establish native behavioral parity.

This page documents the mechanism that keeps those shims discoverable, traceable and auditable. It is written for both human contributors and AI coding agents.

## TL;DR

- **One source of truth**: every backport shim is declared once in [src/runtime/shims/registry.ts](../src/runtime/shims/registry.ts) (`SHIM_REGISTRY`).
- **Sentinel markers** in the source: inline shims are wrapped in `# TEMPORARY SHIM` / `# END TEMPORARY SHIM`, and every shim carries a `@shim-registry: <id>` tag pointing back to its registry entry.
- **Anti-drift test** ([tests/ts/shims/shim-registry.test.ts](../tests/ts/shims/shim-registry.test.ts)) runs in `npm test`, needs no network, and **fails CI** if the registry, the on-disk sources and the markers drift apart — in particular when a new `TEMPORARY SHIM` block is added without registering it.
- **Fast version pre-audit** ([tests/ts/shims/shim-audit.spec.ts](../tests/ts/shims/shim-audit.spec.ts)) is **report-only**, hits the network, and is run on demand via `npm run audit:shims` or the **🔍 Audit shims (versions)** VS Code task. It identifies candidates using versions inferred from PyPI and `pyodide-lock.json`; it does not prove what `micropip` installed or that the APIs are behaviorally equivalent.
- **Live version audit** ([tests/e2e/shim_versions_probe.spec.ts](../tests/e2e/shim_versions_probe.spec.ts)) boots a real Pyodide instance, reads the versions actually installed (`DataLabRuntime.getInstalledVersions()`), classifies each shim, and writes `audit/runtime-versions.json`. Run it with `npm run audit:shims:runtime` or the **🔬 Audit shims (live Pyodide)** task.
- **Behavioral proof** is the final gate: focused Python contract tests or browser E2E tests must exercise the native API that replaces the shim before it is removed.
- An empty `SHIM_REGISTRY` is valid. The anti-drift and classification tests remain useful even when there are no active backports.

## What counts as a shim

| Kind                                                                                                                                                                                | `kind`            | In the registry?            | Current examples                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Backport** — patches/backports a feature into a released upstream package; expected to be deleted at a known (or yet-unknown) upstream version                                    | `"backport"`      | **Yes**                     | `_guidata_jsonschema_shim.py`, which adds two browser-required `FloatArrayItem` hints missing from guidata's native exporter |
| **Architectural / portability** — a permanent, Qt-free reimplementation needed because the browser environment differs from the desktop; **never** expires with an upstream release | `"architectural"` | No (intentionally excluded) | `src/runtime/dlplugins/datalab/**`, `dlw_title_format.py`, the vendored `scripts/run_with_env.py`                            |

Only **backport** shims belong in `SHIM_REGISTRY`. Architectural layers are deliberately left out — auditing them against an upstream version would be meaningless.

## Current guidata state

DataLab-Web requires guidata 3.15 or later. That release provides `guidata.dataset.backends`, `DataSet.edit_async()`, and the public JSON Schema export API natively, so the former backend shim has been deleted. The remaining `_guidata_jsonschema_shim.py` does not replace the exporter: it augments guidata's native `FloatArrayItem` converter with `x-guidata-variable-size` and `x-guidata-minmax`, which the browser array editor consumes. No released upstream version currently provides those two hints, so its registry entry intentionally uses `removableFrom: null`.

## How versions are resolved

`PACKAGE_VERSION_SOURCES` records where the fast audit can obtain a useful version estimate:

| Package                  | How the runtime gets it                                  | Fast-audit source                                                                                                    |
| ------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `guidata`                | `micropip.install("guidata>=3.15.0")`                    | Latest PyPI release from `https://pypi.org/pypi/guidata/json`                                                        |
| `sigima`                 | `micropip.install("sigima>=1.1.6")`                      | Latest PyPI release from `https://pypi.org/pypi/sigima/json`                                                         |
| `numpy`, `scipy`, `h5py` | Bundled with the pinned Pyodide build (`py.loadPackage`) | `pyodide-lock.json` of the pinned `PYODIDE_VERSION` (from [src/runtime/workerBase.ts](../src/runtime/workerBase.ts)) |

The fast audit infers these versions **without booting Pyodide**, so it is cheap and useful for routine monitoring. For PyPI packages it does not execute dependency resolution, so the latest release is only an approximation of what `micropip` will select. The live audit instead reads the versions actually resolved inside Pyodide via `DataLabRuntime.getInstalledVersions()` (backed by `importlib.metadata`), which is authoritative but pays the cold-start cost. Both feed the same `classifyShim` logic.

A shim's `removableFrom` is the **minimum upstream version that ships the feature natively**. The audit compares it with the resolved installed version and classifies each shim:

- **`ready-to-remove`** — installed ≥ `removableFrom`: the shim is a removal candidate; native behavioral parity still has to be proved.
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

   For a **whole-file** shim, put the `# @shim-registry: <id>` tag in the module header comment (see [\_guidata_jsonschema_shim.py](../src/runtime/_guidata_jsonschema_shim.py)).

2. **Register it** in [src/runtime/shims/registry.ts](../src/runtime/shims/registry.ts) by appending a `ShimDescriptor` to `SHIM_REGISTRY`:
   - `id` — must match the `@shim-registry:` tag in the source.
   - `kind: "backport"`.
   - `targetPackage` — must be a key of `PACKAGE_VERSION_SOURCES` (add it there if the package is new).
   - `files` (whole-file shims) **or** `block` (inline shims, with the exact `startMarker` / `endMarker`).
   - `removableFrom` — the upstream version that makes it removable, or `null` if not yet known.
   - `upstreamRef`, `loadedBy` — for reviewers.

3. **Run `npm test`.** The anti-drift test will fail until the registry, the markers and the source agree. This is the safety net that prevents an unregistered shim from slipping in.

### Removing a shim once upstream catches up

1. Run **🔍 Audit shims (versions)** (`npm run audit:shims`). A **`ready-to-remove`** result makes the shim a candidate for deeper verification.
2. Run **🔬 Audit shims (live Pyodide)** (`npm run audit:shims:runtime`) and confirm that the actual browser runtime also reports **`ready-to-remove`**.
3. Inspect the released upstream implementation and run focused contract or E2E tests through the native path. Version and symbol presence are not sufficient: required fields, callbacks, and round trips must remain intact. If only part of the shim is now native, reduce it to the smallest missing behavior and set `removableFrom` to `null` until the remainder is released upstream.
4. Delete the fully superseded shim source (the sentinel-delimited block or the whole file), remove its loader calls, and bump the relevant floor in [requirements-dev.txt](../requirements-dev.txt) if appropriate.
5. Remove its `ShimDescriptor` from `SHIM_REGISTRY` and run `npm test`, the relevant Python tests, and browser E2E coverage for the touched path.

### Running the audit

```powershell
npm run audit:shims          # fast inferred pre-audit; report-only; needs network
npm run audit:shims:runtime  # authoritative installed-version audit; boots Pyodide
```

The equivalent VS Code tasks are **🔍 Audit shims (versions)** and **🔬 Audit shims (live Pyodide)**. Both audits print classifications and never fail merely because a shim is old. Removal remains a human decision backed by the focused behavior tests for that integration.

## For AI agents

When you touch the runtime Python (`src/runtime/*.py`) and find yourself working around a bug or a missing feature in a _released_ `guidata` / `sigima` / scientific-stack version:

- **Treat it as a registry-tracked shim, not an ad-hoc patch.** Follow _Adding a new temporary shim_ above: sentinel markers + `@shim-registry: <id>` tag + a `ShimDescriptor` in `SHIM_REGISTRY`. The anti-drift test in `npm test` will reject the change otherwise.
- **Do not register architectural / portability code** (`dlplugins/datalab/**`, `dlw_title_format.py`, vendored `run_with_env.py`). Those are permanent; `SHIM_REGISTRY` is only for backports that expire at an upstream version.
- **Set `removableFrom` honestly.** Use the exact upstream version that ships the fix when you can verify it (check the sibling `guidata` / `Sigima` checkout's `__version__` and changelog); use `null` when the upstream change has not been released or versioned.
- **Never widen the audit to fail on outdated shims.** The version audit ([shim-audit.spec.ts](../tests/ts/shims/shim-audit.spec.ts)) is report-only by design; only the network-free anti-drift test ([shim-registry.test.ts](../tests/ts/shims/shim-registry.test.ts)) is allowed to fail CI.
- **Do not delete from version evidence alone.** Run the live Pyodide audit, inspect the released upstream implementation, and execute focused contract or E2E tests through the replacement path.
- **Keep `.spec.ts` vs `.test.ts` straight.** The default `npm test` (Vitest `include: ["tests/ts/**/*.test.{ts,tsx}"]`) runs the anti-drift `*.test.ts` but **not** the network audit `*.spec.ts`. The audit runs only through `vitest.audit.config.ts`.
- **After any change here, run `npm test`** and confirm the anti-drift suite is green before declaring the work done.

## Files at a glance

| File                                                                                        | Role                                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [src/runtime/shims/registry.ts](../src/runtime/shims/registry.ts)                           | Single source of truth: `SHIM_REGISTRY`, `PACKAGE_VERSION_SOURCES`, `compareVersions`, `classifyShim`   |
| [tests/ts/shims/shim-registry.test.ts](../tests/ts/shims/shim-registry.test.ts)             | Network-free anti-drift test (part of `npm test`, **fails CI** on drift)                                |
| [tests/ts/shims/shim-classification.test.ts](../tests/ts/shims/shim-classification.test.ts) | Network-free unit coverage for version comparison and every classification state                        |
| [tests/ts/shims/shim-audit.spec.ts](../tests/ts/shims/shim-audit.spec.ts)                   | Report-only version audit (network; `npm run audit:shims`)                                              |
| [vitest.audit.config.ts](../vitest.audit.config.ts)                                         | Vitest config that targets only the audit spec                                                          |
| [tests/e2e/shim_versions_probe.spec.ts](../tests/e2e/shim_versions_probe.spec.ts)           | Ground-truth probe (boots Pyodide, writes `audit/runtime-versions.json`; `npm run audit:shims:runtime`) |
