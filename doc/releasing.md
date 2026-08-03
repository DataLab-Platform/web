# Releasing & distribution

## Versioning

The application version is declared **once**, in `package.json`, and is injected into the bundle at build time via Vite's `define` option (see `vite.config.ts`). The _Help → About_ dialog reads it from `import.meta.env.VITE_APP_VERSION`.

To bump the version, use the standard npm command (it edits `package.json`, creates a commit, and tags it `vX.Y.Z`):

```powershell
npm version patch   # bug fix:  0.1.0 → 0.1.1
npm version minor   # feature:  0.1.0 → 0.2.0
npm version major   # breaking: 0.1.0 → 1.0.0
```

The next `npm run dev` or `npm run build` automatically picks up the new value — no other file needs to be edited.

> **Keep `packages/sdk/package.json` in sync** — bump its `version` to the same value before tagging. The release CI fails if the two `package.json` files disagree.

> **What `git push --tags` triggers** — the [`Release tarballs`](../.github/workflows/release.yml) workflow runs, in order: version coherence check (tag ↔ both `package.json` files) → `pytest tests/python` (3.11 + 3.12) and Playwright E2E (in parallel) → lint + Vitest + build → pack the online app, SDK and offline app → run the staged offline E2E guard → publish all artifacts in one GitHub Release → deploy `dist/` to GitHub Pages. Any failing gate aborts the release **and** the deploy.

## Distribution artifacts

The release pipeline preserves the two lightweight integration artifacts and
adds a self-contained intranet package:

| Tarball                                  | Contents                                                                  | Consumer action                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `datalab-web-<version>.tgz`              | Static bundle (everything under `dist/`) + `DEPLOY.md`                    | Unpack under any web server                                       |
| `datalab-web-offline-<version>.zip`      | Static bundle + complete Pyodide + exact Python wheels + deployment guide | Verify its `.sha256`, then unpack under an intranet static server |
| `datalab-platform-web-sdk-<version>.tgz` | Host-side TypeScript SDK (`@datalab-platform/web-sdk`)                    | `npm install ./datalab-platform-web-sdk-…tgz`                     |

Generate them locally:

```powershell
npm run release:pack   # lint → test → build → SDK + online + offline packs
```

Or invoke each step independently (`npm run sdk:pack`, `npm run app:pack`,
`npm run app:pack:offline`). Run `npm run test:e2e:offline` to serve a verified
staging directory under `/tools/datalab/` and reject every external request.
Output lands in `release/`; the large downloads are cached by exact version
under `.cache/offline/`.

All artifacts share the same release version and are attached atomically. The
wire-protocol negotiated by the SDK and either app distribution (`MAJOR.MINOR`,
exposed as `client.protocolVersion`) remains independent: releases
inter-operate while the protocol `MAJOR` is unchanged. See
[examples/angular/README.md](../examples/angular/README.md) for the matrix.
