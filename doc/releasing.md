# Releasing & distribution

## Versioning

The application version is declared in `package.json`, kept aligned with `packages/sdk/package.json`, and injected into the bundle at build time via Vite's `define` option (see `vite.config.ts`). The _Help → About_ dialog reads it from `import.meta.env.VITE_APP_VERSION`.

Use the release helper to bump both packages, promote the changelog, create one commit and tag it `vX.Y.Z`:

```powershell
node scripts/release.mjs patch   # bug fix:  0.1.0 → 0.1.1
node scripts/release.mjs minor   # feature:  0.1.0 → 0.2.0
node scripts/release.mjs major   # breaking: 0.1.0 → 1.0.0
```

The push remains manual, providing a final checkpoint before the release workflow starts.

## Sigima release qualification

[`sigima-dependency.json`](../sigima-dependency.json) separates the exact
published requirement from the temporary integration snapshot. Before
preparing a DataLab-Web release:

1. Confirm that `publishedRequirement` is an exact pin such as
   `sigima==1.3.0` and is available on PyPI.
2. Run pytest and Playwright without a sibling Sigima `PYTHONPATH`, local wheel
   or `VITE_SIGIMA_INSTALL_SPEC`.
3. Confirm the live Pyodide runtime reports that exact Sigima version.
4. Set `developmentRef` to `null` only after those checks pass.

`npm run release:guard` performs the network-free structural checks. It blocks
while any snapshot SHA is active and is called before `release:pack`, before
the release helper mutates files, and by the release workflow before its other
jobs. The release Python tests explicitly install `publishedRequirement`, and
the release browser tests never build or export a development wheel.
`release:pack` uses `build:release`, whose release mode ignores even an
accidental `VITE_SIGIMA_INSTALL_SPEC` from the developer's ignored `.env`.

The guard applies the same rule to [`guidata-dependency.json`](../guidata-dependency.json): a non-null guidata `developmentRef` blocks the release until a guidata version providing the required changes is published and `publishedRequirement` requires it (for example `guidata>=X.Y.Z`). Release builds also ignore `VITE_GUIDATA_INSTALL_SPEC`.

It also covers [`datalab-capsule-dependency.json`](../datalab-capsule-dependency.json). During development, DataLab-Capsule may stay unpublished (`publishedRequirement: null`, provenance then follows `developmentRef` or stays off). A release requires an exact published pin such as `datalab-capsule==0.1.0` and `developmentRef: null`; the release workflow then runs pytest and Playwright with that published version and provenance required, and release builds ignore `VITE_DATALAB_CAPSULE_INSTALL_SPEC`.

> **What `git push --tags` triggers** — the [`Release tarballs`](../.github/workflows/release.yml) workflow runs, in order: Sigima, guidata and DataLab-Capsule release guard and version coherence check (tag ↔ both `package.json` files) → `pytest tests/python` (3.11 + 3.12) and Playwright E2E against the published pins, provenance required (in parallel) → lint + Vitest + build + pack the two `.tgz` → publish a GitHub Release with the tarballs and auto-generated notes → deploy `dist/` to GitHub Pages. Any failing gate aborts the release **and** the deploy.

## Development, candidate and release

Three contexts give three different kinds of evidence. A delivery names the one its checks were obtained in.

| Context                 | Python packages in the browser                                                                                                                                                         | How to build                                                                                                                                                                                                  | What it shows                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Development             | `developmentRef` snapshots, or local wheels through `VITE_*_INSTALL_SPEC`                                                                                                              | `npm run dev`; E2E tests drive the development server and its `window.runtime` hook                                                                                                                           | The branch works with the sibling checkouts                                                                        |
| Candidate qualification | Wheels built from the `developmentRef` pins (`python scripts/sigima_dependency.py prepare-pyodide`, `python scripts/capsule_dependency.py prepare-pyodide`), served from `dist/wheels` | `npm run build`, then `npm run app:pack`; the bundle extracted from `release/datalab-web-<version>.tgz` is served by a static server and checked through its interface only (`window.runtime` is not exposed) | The production bundle works with the packages about to be published; `release:guard` still refuses it, as expected |
| Release                 | `publishedRequirement` pins only                                                                                                                                                       | `npm run release:pack` (guard, lint, tests, `build:release`, tarballs)                                                                                                                                        | The published combination; repeat the interface checks on the released tarball                                     |

Users of a release need none of the development tools: the static bundle is enough. The browser still loads Pyodide from its CDN and the Python packages from PyPI or the Pyodide CDN when the application starts: there is no offline mode. The browser cache may avoid downloading them again, but working without network is not a supported procedure. Data and computations stay in the browser.

The candidate check of 17 Oct 2026 followed the second line of the table: production build with `VITE_*_INSTALL_SPEC` pointing to `/wheels/` (Sigima 1.3.0, guidata 3.16.0 and DataLab-Capsule 0.1.0.dev0 candidate wheels copied to `dist/wheels`), `npm run app:pack`, tarball extracted and served by `python -m http.server 5173`, then `DLW_RELEASE_BUILD=1 DLW_RELEASE_CANDIDATE=1 DLW_RELEASE_CAPSULE=<capsule exported by DataLab Desktop> npx playwright test --project=chromium tests/e2e/release_build.spec.ts`: the capsule is intact, opens, replays exactly, and a step verifies from the Provenance tab, without registry and without development server.

## Distribution: app bundle + SDK tarballs

DataLab-Web is shipped to integrators as **two `.tgz` artefacts** produced by the release pipeline:

| Tarball                                  | Contents                                                           | Consumer action                               |
| ---------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------- |
| `datalab-web-<version>.tgz`              | Static bundle (everything under `dist/`) + `DEPLOY.md` + `LICENSE` | Unpack under any web server                   |
| `datalab-platform-web-sdk-<version>.tgz` | Host-side TypeScript SDK (`@datalab-platform/web-sdk`) + `LICENSE` | `npm install ./datalab-platform-web-sdk-…tgz` |

Generate them locally:

```powershell
npm run release:pack   # guard → lint → test → build → SDK pack → app pack
```

Or invoke each step independently (`npm run sdk:pack`, `npm run app:pack`). Output lands in `release/`.

The two artefacts share the same release version. The wire-protocol they negotiate (`MAJOR.MINOR`, exposed as `client.protocolVersion`) is independent: a SDK and a bundle from different release versions inter-operate as long as the protocol `MAJOR` is unchanged. See [examples/angular/README.md](examples/angular/README.md) for the integrator-facing compatibility matrix.
