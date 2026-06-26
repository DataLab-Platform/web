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

> **What `git push --tags` triggers** — the [`Release tarballs`](../.github/workflows/release.yml) workflow runs, in order: version coherence check (tag ↔ both `package.json` files) → `pytest tests/python` (3.11 + 3.12) and Playwright E2E (in parallel) → lint + Vitest + build + pack the two `.tgz` → publish a GitHub Release with the tarballs and auto-generated notes → deploy `dist/` to GitHub Pages. Any failing gate aborts the release **and** the deploy.

## Distribution: app bundle + SDK tarballs

DataLab-Web is shipped to integrators as **two `.tgz` artefacts** produced by the release pipeline:

| Tarball                                  | Contents                                               | Consumer action                               |
| ---------------------------------------- | ------------------------------------------------------ | --------------------------------------------- |
| `datalab-web-<version>.tgz`              | Static bundle (everything under `dist/`) + `DEPLOY.md` | Unpack under any web server                   |
| `datalab-platform-web-sdk-<version>.tgz` | Host-side TypeScript SDK (`@datalab-platform/web-sdk`) | `npm install ./datalab-platform-web-sdk-…tgz` |

Generate them locally:

```powershell
npm run release:pack   # lint → test → build → SDK pack → app pack → summary
```

Or invoke each step independently (`npm run sdk:pack`, `npm run app:pack`). Output lands in `release/`.

The two artefacts share the same release version. The wire-protocol they negotiate (`MAJOR.MINOR`, exposed as `client.protocolVersion`) is independent: a SDK and a bundle from different release versions inter-operate as long as the protocol `MAJOR` is unchanged. See [examples/angular/README.md](examples/angular/README.md) for the integrator-facing compatibility matrix.
