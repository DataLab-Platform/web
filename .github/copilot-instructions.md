# DataLab-Web AI Coding Agent Instructions

DataLab-Web is the **browser-native** sibling of the DataLab desktop application.
It runs the [Sigima](https://github.com/DataLab-Platform/Sigima) computation
engine in [Pyodide](https://pyodide.org/) (CPython compiled to WebAssembly,
JupyterLite-style) and renders a custom React + TypeScript UI inspired by the
desktop Qt application.

## Architecture in one picture

```
React/TS UI  ──►  src/sigima/runtime.ts  ──►  Pyodide  ──►  bootstrap.py  ──►  Sigima
```

* **`src/sigima/bootstrap.py`** is the only Python file. It is loaded once into
  Pyodide and owns:
  * an in-memory object store (`_STORE: dict[str, SignalObj]`) — the MVP’s
    equivalent of DataLab’s `ObjectModel`;
  * the `_PROCESSINGS` catalogue — the MVP’s equivalent of DataLab’s
    `register_1_to_1` machinery;
  * thin helpers (`create_signal`, `list_signals`, `get_signal_xy`,
    `apply_processing`, `delete_signal`, `list_processings`) that the JS layer
    calls. Every helper returns JSON-serialisable values.
* **`src/sigima/runtime.ts`** is the only place that touches the Pyodide API.
  All Python calls go through `SigimaRuntime`; the rest of the UI consumes a
  typed interface (`SignalMeta`, `SignalData`, `ProcessingDescriptor`, …).
* **`src/sigima/SigimaContext.tsx`** loads the runtime exactly once via React
  context.
* **`src/components/`** holds presentational components (no Pyodide imports).

### Plotting

Qt-based PlotPy is unavailable in the browser. Use **Plotly.js** (via
`react-plotly.js`). Mirror the conventions of `DataLab-Kernel/datalab_kernel/plotly_backend.py`
when extending plot features (curve styles, ROI overlays, geometry results).

## Adding a new processing

1. In `bootstrap.py`, register an entry in `_PROCESSINGS`:
   ```python
   "moving_average": {
       "label": "Moving average",
       "func": sips.moving_average,
       "kwargs": {"n": 5},
   },
   ```
2. Nothing else is needed for 1-to-1 fixed-parameter processings — the menu bar
   picks it up automatically through `list_processings()`.
3. For parametrised processings, extend the catalogue entry with a parameter
   schema and add a dialog under `src/components/`.

## Adding a new signal generator

1. Add a branch to `create_signal()` in `bootstrap.py`.
2. Add the kind to the `KINDS` array and (if needed) input fields in
   `src/components/NewSignalDialog.tsx`.
3. Extend the `SignalCreationParams["kind"]` union in `runtime.ts`.

## Conventions

* **Type-safety end-to-end**: never widen a Pyodide return value beyond the
  declared `SignalMeta` / `SignalData` / … types. Add new fields in the Python
  helper *and* the TS interface in lockstep.
* **No business logic in components**: components consume `useSigima()` data
  and call back into `App.tsx`, which orchestrates the runtime.
* **JSON across the bridge**: prefer plain dicts/lists in Python helpers
  (`tolist()` on arrays) over passing PyProxies to JS.
* **Path strategy**: Vite is configured with `base: "./"` so the build is
  drop-in deployable to GitHub Pages and other sub-path hosts. Don’t introduce
  absolute URLs.
* **Pyodide version is pinned** (`PYODIDE_VERSION` in `runtime.ts` and the
  `<script>` tag in `index.html`). Bump both together; Pyodide’s wheel index
  is version-specific.

## Related projects (siblings in the multi-root workspace)

| Folder              | Role                                                |
| ------------------- | --------------------------------------------------- |
| `../DataLab/`       | Reference Qt desktop app — copy patterns, not code  |
| `../DataLab-Kernel/`| Jupyter kernel — `plotly_backend.py` is a goldmine  |
| `../Sigima/`        | The computation engine running inside Pyodide       |
| `../PlotPy/`        | Desktop plotting (do not import — Qt-only)          |

## Useful commands

```powershell
npm install      # one-time
npm run dev      # Vite dev server (http://localhost:5173)
npm run build    # static bundle in dist/
npm run lint     # ESLint
npm run format   # Prettier
```

The first dev-server load downloads Pyodide (~10 MB) and installs Sigima via
`micropip` — expect 30–60 s. Subsequent loads are cached by the browser.
