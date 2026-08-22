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

> **What `git push --tags` triggers** — the [`Release tarballs`](../.github/workflows/release.yml) workflow runs, in order: Sigima release guard and version coherence check (tag ↔ both `package.json` files) → `pytest tests/python` (3.11 + 3.12) and Playwright E2E against the published Sigima pin (in parallel) → lint + Vitest + build + pack the two `.tgz` → publish a GitHub Release with the tarballs and auto-generated notes → deploy `dist/` to GitHub Pages. Any failing gate aborts the release **and** the deploy.

## Distribution: app bundle + SDK tarballs

DataLab-Web is shipped to integrators as **two `.tgz` artefacts** produced by the release pipeline:

| Tarball                                  | Contents                                               | Consumer action                               |
| ---------------------------------------- | ------------------------------------------------------ | --------------------------------------------- |
| `datalab-web-<version>.tgz`              | Static bundle (everything under `dist/`) + `DEPLOY.md` | Unpack under any web server                   |
| `datalab-platform-web-sdk-<version>.tgz` | Host-side TypeScript SDK (`@datalab-platform/web-sdk`) | `npm install ./datalab-platform-web-sdk-…tgz` |

Generate them locally:

```powershell
npm run release:pack   # guard → lint → test → build → SDK pack → app pack
```

Or invoke each step independently (`npm run sdk:pack`, `npm run app:pack`). Output lands in `release/`.

The two artefacts share the same release version. The wire-protocol they negotiate (`MAJOR.MINOR`, exposed as `client.protocolVersion`) is independent: a SDK and a bundle from different release versions inter-operate as long as the protocol `MAJOR` is unchanged. See [examples/angular/README.md](examples/angular/README.md) for the integrator-facing compatibility matrix.
