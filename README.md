# DataLab Web

Full-Web reimplementation of the [DataLab](https://datalab-platform.com/) scientific
data-processing platform.

DataLab Web runs **entirely in the browser**: the [Sigima](https://github.com/DataLab-Platform/Sigima)
computation engine is loaded as Python (CPython compiled to WebAssembly via
[Pyodide](https://pyodide.org/)), exactly like [JupyterLite](https://jupyterlite.readthedocs.io/).
The user interface is a dedicated React/TypeScript application inspired by the
desktop Qt DataLab — not a JupyterLab clone — with [Plotly.js](https://plotly.com/javascript/)
as the plotting backend (Qt-based PlotPy is not available in the browser).

> **Status: experimental MVP.** Only a small subset of DataLab’s signal features
> is wired up so far (synthetic-signal creation + a few 1-to-1 processings).
> The architecture is meant to be extended incrementally toward feature parity.

## Architecture overview

```
 ┌─────────────────────────── Browser ───────────────────────────┐
 │  React / TypeScript UI   ──►   Pyodide (CPython + WASM)        │
 │   • Signal panel             • numpy / scipy                   │
 │   • Plotly.js plot           • sigima (computation engine)     │
 │   • Dialogs / menus          • bootstrap.py (object store +    │
 │                                JS-friendly helper functions)   │
 └────────────────────────────────────────────────────────────────┘
```

* `src/sigima/` — Pyodide loader and Python ↔ JS bridge.
  * `bootstrap.py` — Python module loaded into Pyodide; owns the in-memory
    object store and exposes the helper functions the UI calls
    (`create_signal`, `apply_processing`, …). Plays the role of DataLab’s
    `objectmodel.py` + processor classes, scaled down to MVP.
  * `runtime.ts` — typed wrapper around the Pyodide instance.
  * `SigimaContext.tsx` — React context that loads the runtime once.
* `src/components/` — UI building blocks (menu bar, signal list, plot,
  new-signal dialog).
* `src/App.tsx` — top-level layout (mirrors the desktop layout: menu bar at
  the top, signal list on the left, central plot area).

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

Open http://localhost:5173. The first load downloads Pyodide and installs
Sigima via `micropip`, which can take 30–60 seconds.

### Build a static deployment

```powershell
npm run build
```

The `dist/` folder can be served from any static host (GitHub Pages, S3,
nginx, …). All paths are relative so the app works under sub-paths.

## Roadmap (high-level)

1. **MVP (current):** synthetic signal creation, a handful of 1-to-1
   processings, Plotly visualisation.
2. Image panel (2D arrays, Plotly heatmaps, colormaps).
3. File I/O — load/save signals and images via the browser File API and
   Sigima’s `sigima.io` module.
4. ROI editing — overlay shapes on the Plotly plots and feed them back to
   Sigima objects.
5. Generic processing dispatcher mirroring DataLab’s `register_1_to_1` /
   `register_n_to_1` / … pattern, driven by Sigima introspection.
6. Macros & remote control via a Web Worker running Pyodide off the main
   thread.

## License

BSD 3-Clause, same as DataLab and Sigima.
