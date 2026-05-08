# DataLab Web

Full-Web reimplementation of the [DataLab](https://datalab-platform.com/) scientific data-processing platform — the entire computation engine and processing catalog run **inside the browser**.

DataLab Web embeds the [Sigima](https://github.com/DataLab-Platform/Sigima) computation engine in [Pyodide](https://pyodide.org/) (CPython compiled to WebAssembly, JupyterLite-style) and pairs it with a dedicated React / TypeScript user interface modelled on the desktop Qt DataLab application. Plotting is delegated to [Plotly.js](https://plotly.com/javascript/) since Qt-based PlotPy is not available in the browser.

![DataLab Web — 2D sinc image with statistics and contrast tools](doc/images/screenshot-image-sinc2d.png)

## Features

DataLab Web mirrors a large portion of the desktop application surface:

- **Signal panel** — 1D curves with synthetic generators (Gaussian, Lorentzian, Voigt, Planck blackbody, sine, sawtooth, triangle, square, sinc, chirp, step, exponential, logistic, pulses, polynomial, custom expressions, noise distributions…) and full Plotly visualisation with cross-hair markers and annotations.
- **Image panel** — 2D arrays with synthetic generators (2D Gaussian, ramp, checkerboard, sinusoidal grating, ring pattern, Siemens star, 2D sinc, uniform / normal / Poisson noise…), zoomable Plotly heatmap, contrast adjustment, cross profiles and stats area tools.
- **Processing** — operations, transforms, filters, fitting, FFT/PSD, stability analyses and many other Sigima 1-to-1 / 2-to-1 / n-to-1 processings, exposed automatically through the menu bar by introspecting Sigima's catalog.
- **Analysis** — measurements producing scalar results and result tables; interactive fit dialog; profile extraction (line / segment / average / radial) with graphical parameter editing.
- **ROI management** — segment / rectangular / circular / polygonal regions of interest with a dedicated editor and grid view.
- **Object tree** — multi-group workspace with drag & drop, properties, metadata editor, statistics card and computation history.
- **Macros** — embedded Python editor (CodeMirror with autocompletion and search) plus a console, mirroring DataLab's macro system. Macros run in a dedicated Web Worker (their own Pyodide instance) and call an async `proxy` API that mirrors DataLab's `RemoteProxy`.
- **Notebooks** — multi-tab notebook panel with code & markdown cells, persistent in-browser autosave (IndexedDB), full nbformat v4.5 `.ipynb` import / export, a bundled Quickstart template and bidirectional **Convert to macro** / **Convert to notebook** actions (Spyder-style `# %%` / `# %% [markdown]` separators). See [doc/notebooks.md](doc/notebooks.md).
- **Plugins** — Qt-compatible `PluginBase` API. The same plugin source runs in DataLab desktop and DataLab Web provided dialogs use `await param.edit_async(...)`. See [doc/plugins.md](doc/plugins.md).
- **I/O** — HDF5 browser (via `h5py` running in Pyodide), text import wizard and per-directory save dialog.
- **UI niceties** — light / dark theme, resizable splitters with persisted layout, pop-out result panel, contextual help dialog.

## Architecture overview

```text
 ┌─────────────────────────── Browser ───────────────────────────┐
 │  React / TypeScript UI   ──►   Pyodide (CPython + WASM)        │
 │   • Signal & image panels    • numpy / scipy / scikit-image    │
 │   • Plotly.js plots          • h5py                            │
 │   • Menus / dialogs          • sigima (computation engine)     │
 │   • Macro editor             • bootstrap.py (object store +    │
 │   • Plugin manager             JS-friendly helper functions)   │
 └────────────────────────────────────────────────────────────────┘
```

Code organisation:

- `src/runtime/` — Pyodide loader and Python ↔ JS bridge.
  - `bootstrap.py` — Python module loaded into Pyodide; owns the hierarchical in-memory object model (panels, groups, objects) and exposes the helper functions the UI calls.
  - `processor.py` — Sigima catalog introspection: discovers processings, applies overrides and exposes them to the UI.
  - `runtime.ts` — typed wrapper around the Pyodide instance.
  - `RuntimeContext.tsx` — React context that loads the runtime once.
  - `macroWorker.ts` — dedicated Web Worker hosting a second Pyodide instance for macro execution, isolated from the main UI thread.
  - `dlplugins/datalab/` — portable plugin shim providing the `PluginBase` API so DataLab desktop plugins run unchanged.
  - `dlw_h5browser.py`, `dlw_interactive_fit.py`, … — Python helpers backing specific dialogs.
- `src/components/` — UI building blocks (menu bar, object tree, plots, dialogs, macro panel, side panels…), including `DialogBridge.tsx` which routes Python dialog requests to React components.
- `src/actions/` — action registry that maps Sigima features to menu items.
- `src/plugins/` — host-side support for the Qt-compatible plugin API.
- `src/macros/` — macro editor and execution helpers (templates, autocompletion bindings).
- `src/App.tsx` — top-level layout (menu bar at the top, object tree on the left, central plot area, results panel on the right) with persisted splitter sizes.

## Persistence model

DataLab-Web treats the **HDF5 workspace file as the single durable
source of truth**. Everything else — IndexedDB caches, the recent
notebooks/macros menus, even the in-memory Python `_STORE` — is
ephemeral and reset on a hard reload of the Pyodide instance.

| Asset class           | Survives F5 reload?                                | How to make durable |
| --------------------- | -------------------------------------------------- | ------------------- |
| Signals & images      | **No** — wiped with Pyodide                        | **File → Save HDF5 workspace…** |
| Groups, ROIs, metadata, plot annotations | **No** — wiped with Pyodide     | **File → Save HDF5 workspace…** |
| Macro **content**     | Yes — IndexedDB *recovery cache*                   | **File → Save HDF5 workspace…** for the full workspace, or download individually |
| Notebook **content**  | Yes — IndexedDB *recovery cache*                   | **File → Save HDF5 workspace…**, or **Save notebook as…** for a `.ipynb` |
| Notebook **outputs / execution counters** | **No** — outputs aren't cached       | Save HDF5 workspace (outputs are persisted there too) |

How this surfaces in the UI:

- The window title shows `DataLab-Web — <filename or "Untitled">`,
  with a `•` marker as soon as the workspace contains unsaved
  changes. A `(recovered)` hint is added when the macros / notebooks
  panels rehydrated from the IndexedDB cache; both clear on the next
  **Open / Save HDF5 workspace…**.
- A `beforeunload` confirmation prompt fires only when the workspace
  is dirty.
- A one-time recovery banner appears at cold start if the IndexedDB
  cache reseeded macros or notebooks, reminding you that the
  workspace is not yet durable. **Dismiss** hides the banner;
  **Save HDF5 workspace…** promotes the recovered state to a real
  file.
- Fresh sessions are labelled **Untitled**. The first
  **File → Save HDF5 workspace…** proposes a timestamped name
  (`workspace-YYYYMMDD-HHMMSS.h5`); subsequent saves reuse the last
  filename associated with the session.

The behaviour mirrors DataLab desktop: closing without saving loses
unsaved work; opening an HDF5 workspace replaces the in-memory state.

## Comparison with related projects

| Project        | Purpose                                              | Runs where      |
| -------------- | ---------------------------------------------------- | --------------- |
| DataLab        | Reference desktop app (Qt + PlotPy)                  | Native          |
| DataLab-Kernel | Jupyter kernel exposing DataLab to notebooks         | Local Python    |
| **DataLab-Web**| **Full browser app, Sigima in WASM (this project)**  | **Browser**     |
| Sigima         | Headless computation engine (signals/images)         | Anywhere Python |

## Development

Prerequisites: Node.js ≥ 18.

```powershell
npm install
npm run dev
```

Open <http://localhost:5173>. The first load downloads Pyodide (~10 MB) and installs Sigima via `micropip`, which can take 30–60 seconds. Subsequent loads are cached by the browser.

### Build a static deployment

```powershell
npm run build
```

The `dist/` folder can be served from any static host (GitHub Pages, S3, nginx, …). Vite is configured with `base: "./"` so all paths are relative and the app works under sub-paths.

### Useful scripts

```powershell
npm run lint     # ESLint
npm run format   # Prettier
npm run preview  # Serve the production build locally
```

### Releasing a new version

The application version is declared **once**, in `package.json`, and is injected into the bundle at build time via Vite's `define` option (see `vite.config.ts`). The *Help → About* dialog reads it from `import.meta.env.VITE_APP_VERSION`.

To bump the version, use the standard npm command (it edits `package.json`, creates a commit, and tags it `vX.Y.Z`):

```powershell
npm version patch   # bug fix:  0.1.0 → 0.1.1
npm version minor   # feature:  0.1.0 → 0.2.0
npm version major   # breaking: 0.1.0 → 1.0.0
```

The next `npm run dev` or `npm run build` automatically picks up the new value — no other file needs to be edited.

> **Keep `packages/sdk/package.json` in sync** — bump its `version` to the same value before tagging. The release CI fails if the two `package.json` files disagree.

### Distribution: app bundle + SDK tarballs

DataLab-Web is shipped to integrators as **two `.tgz` artefacts** produced by the release pipeline:

| Tarball                                 | Contents                                                        | Consumer action                                  |
| --------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| `datalab-web-<version>.tgz`             | Static bundle (everything under `dist/`) + `DEPLOY.md`          | Unpack under any web server                      |
| `datalab-platform-web-sdk-<version>.tgz`| Host-side TypeScript SDK (`@datalab-platform/web-sdk`)          | `npm install ./datalab-platform-web-sdk-…tgz`    |

Generate them locally:

```powershell
npm run release:pack   # lint → test → build → SDK pack → app pack → summary
```

Or invoke each step independently (`npm run sdk:pack`, `npm run app:pack`). Output lands in `release/`.

The two artefacts share the same release version. The wire-protocol they negotiate (`MAJOR.MINOR`, exposed as `client.protocolVersion`) is independent: a SDK and a bundle from different release versions inter-operate as long as the protocol `MAJOR` is unchanged. See [doc/examples/angular/README.md](doc/examples/angular/README.md) for the integrator-facing compatibility matrix.

## Testing

DataLab-Web ships a four-layer test pyramid that mirrors the engineering rigour of the DataLab desktop pytest suite:

| Layer        | Tooling                      | Scope                                                    | Speed   |
| ------------ | ---------------------------- | -------------------------------------------------------- | ------- |
| Python       | pytest + coverage (CPython)  | `src/runtime/bootstrap.py` and `processor.py` headlessly | Fastest |
| TypeScript   | Vitest + jsdom               | Pure-logic TS modules (action registry, theme, …)        | Fast    |
| End-to-end   | Playwright (Chromium)        | Real browser boot of Pyodide + UI smoke tests            | Slow    |
| Continuous   | GitHub Actions (`tests.yml`) | All three layers on every push / PR                      | —       |

The Python layer runs `bootstrap.py` directly under CPython through fixtures that stub the Pyodide-only modules (`js`, `pyodide.ffi`); this gives fast feedback and high coverage without booting WebAssembly.

Run everything locally:

```powershell
# One-time: copy the environment template and create the project venv
# (Python 3.11 or 3.12 — earlier versions trip a quirk in
# ``isinstance(list[T], type)`` that breaks Sigima's processor
# introspection).
Copy-Item .env.template .env
py -3.11 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-dev.txt

# Python unit tests + coverage report (htmlcov-python/)
.\.venv\Scripts\python -m pytest tests/python --cov=src/runtime --cov-report=html:htmlcov-python

# TypeScript unit tests + coverage report (coverage-ts/)
npm test
npm run test:cov

# End-to-end browser tests (boots Pyodide in Chromium ~1.5 min)
npx playwright install chromium   # one-time
npm run test:e2e

# Performance benchmarks (opt-in — ~5 min). Includes the image-display
# benchmark and the 50k-sample binary transfer probe.
npx playwright test --project=perf
PERF=1 npm run test:e2e
```

Test layout:

```text
tests/
├── python/          # pytest suite — exercises bootstrap.py headlessly
├── ts/              # Vitest suite — pure TypeScript modules
└── e2e/             # Playwright specs — real browser smoke tests
```

VS Code tasks are provided under `.vscode/tasks.json` (`🚀 Pytest`, `🟢 Vitest`, `🎭 Playwright`, …). The default test task (`Ctrl+Shift+P → Run Test Task`) launches the Python suite.

## Plugins

DataLab-Web ships a Qt-compatible plugin system. The same `PluginBase` subclass can run unchanged in DataLab desktop and DataLab-Web, provided parameter dialogs use `await param.edit_async(self.main)` instead of the synchronous `param.edit(self.main)`. See [doc/plugins.md](doc/plugins.md) for details, hot-reload behaviour and the bundled vitrine plugin.

## Internationalisation

### Current state

The DataLab-Web UI is **English-only**. There is no React-side i18n layer yet (no `react-i18next`, no `useTranslation` hook): all menu labels, dialog titles, button captions and tooltips that originate in the TypeScript/React code are hard-coded English strings.

However, a non-trivial fraction of what the user sees comes from **Python**, not from React: the `Create > Signal` and `Create > Image` submenus, the *Processing* / *Operations* / *Analysis* menu entries, parameter labels in computation dialogs, etc. Those labels are produced by Sigima and guidata through `gettext _()` wrappers (e.g. `SignalTypes` and `ImageTypes` in [`sigima.objects.signal.creation`](https://github.com/DataLab-Platform/Sigima) / `sigima.objects.image.creation`).

When `LANG` is unset, [`guidata.configtools.get_translation`](https://github.com/PlotPyStack/guidata) falls back to the browser's preferred language via `get_system_lang()`. On a French-locale browser, this used to surface translated entries (e.g. *Gaussienne*, *Sinusoïde*, *Sinus cardinal*) inside the otherwise-English UI — an inconsistency reported by users.

To keep the UI consistent today, both Pyodide instances pin the locale to the POSIX `C` locale **before** importing guidata or sigima:

- [`src/runtime/runtime.ts`](src/runtime/runtime.ts) — main Pyodide instance, immediately after `loadPyodide(...)` and before `loadPackage` / `micropip.install` / the guidata shims.
- [`src/runtime/macroWorker.ts`](src/runtime/macroWorker.ts) — secondary Pyodide instance for macros.
- [`src/runtime/bootstrap.py`](src/runtime/bootstrap.py) carries a defensive comment reminding maintainers that `LANG` is already pinned by `runtime.ts` by the time the module runs, and that setting it from Python would be too late (guidata caches its translation object at import time).

`LANG=C` (rather than `LANG=en` or `LANG=en_US`) is chosen because `C` is the canonical "no translation" POSIX locale: gettext returns the original English `msgid` strings without searching for an `en.mo` catalog that may not be packaged in the Sigima/guidata wheels.

### Perspective: full multi-language support (option 2)

A proper internationalisation story would require coordinated work on both sides of the Pyodide bridge. A possible roadmap:

1. **Add a React i18n layer.** Either adopt `react-i18next` (mature, route-aware, lazy-loadable namespaces) or implement a lightweight `useTranslation()` hook backed by JSON catalogs. All hard-coded English strings in `src/components/`, `src/actions/`, dialog titles, menu separators, status-bar messages and error toasts must be migrated to keys looked up through that layer.
2. **Extract translatable strings.** Run an extraction pass (e.g. `i18next-parser`) to seed `src/locales/<lang>.json` catalogs. Mirror the guidata/Sigima `.po` workflow conceptually so contributors only have to learn one mental model.
3. **Expose a language selector.** Add an entry in a *Preferences* dialog (or accept a `?lang=fr` URL parameter) and persist the choice in `localStorage`. Default to the browser's preferred language when nothing is stored.
4. **Propagate the locale to Pyodide.** Before the *first* guidata import, set `os.environ["LANG"]` (and `LANGUAGE`) to the chosen value. Because `SignalTypes` and `ImageTypes` cache their `.label` attributes at class-definition time (`LabeledEnum` evaluates `_()` once, eagerly), changing the language **after** start-up cannot be done in place — it would require either:
   - rebuilding the enum labels by re-evaluating each `_()` call (intrusive, brittle, would require Sigima cooperation), **or**
   - simpler and recommended: trigger a full page reload when the user picks a new language, so a fresh Pyodide instance boots with the new `LANG`.
5. **Ship additional `.mo` catalogs.** Today Sigima/guidata `.mo` files travel inside the wheels installed by `micropip`. To support languages not bundled there, a small loader could prefetch `.mo` files (or wheels with extra catalogs) and place them on Pyodide's virtual filesystem before the first import.
6. **Localise the documentation.** Reuse the Sphinx + sphinx-intl workflow already established for the desktop DataLab to translate the contents of `doc/` (signal/image processing references, plugin guide, etc.).
7. **Coordinate catalogs with the desktop app.** Open question: should DataLab-Web share translation catalogs with the desktop DataLab (single source of truth, but UI surfaces differ — many strings would not apply on either side), or maintain separate catalogs (more duplication, but each project can iterate independently)? A shared **glossary** of recurring terms (Signal, Image, ROI, FFT, Gaussian…) is probably the right middle ground.

Until that work happens, please keep all new UI strings in English and treat the `LANG=C` pin as a load-bearing piece of infrastructure.

## Roadmap

Short-term:

- Generic results-table view aligned with the desktop *Results* panel.
- Richer image data preview (numeric grid with virtualised scrolling).
- Move the main `DataLabRuntime` off the UI thread (macros already run in a dedicated Web Worker; the main computation Pyodide instance still lives on the main thread).
- Additional file formats through `sigima.io` (currently focused on text and HDF5).

Longer-term:

- Remote control bridge to a real DataLab desktop instance via the Web API.
- Collaborative sessions through shared workspace files.

## License

BSD 3-Clause, same as DataLab and Sigima.
