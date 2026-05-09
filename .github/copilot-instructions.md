# DataLab-Web AI Coding Agent Instructions

DataLab-Web is the **browser-native** sibling of the DataLab desktop application.
It runs the [Sigima](https://github.com/DataLab-Platform/Sigima) computation
engine in [Pyodide](https://pyodide.org/) (CPython compiled to WebAssembly,
JupyterLite-style) and renders a custom React + TypeScript UI inspired by the
desktop Qt application.

## Generative AI policy (mandatory)

This project follows the [NLnet GenAI
policy](https://nlnet.nl/foundation/policies/generativeAI/). When you produce
code, tests or documentation that ends up in a commit, the human author must
add an `Assisted-by: <Model> <Version>` trailer to the commit message
(e.g. `Assisted-by: Claude Opus 4.7`). Human review remains mandatory before
any commit; structural decisions stay under human responsibility. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for the full rules.

## Architecture in one picture

```
React/TS UI  ──►  src/runtime/runtime.ts  ──►  Pyodide  ──►  bootstrap.py  ──►  Sigima
```

* **`src/runtime/bootstrap.py`** is the only Python file. It is loaded once into
  Pyodide and owns:
  * an in-memory object store (`_STORE: dict[str, SignalObj]`) — the MVP’s
    equivalent of DataLab’s `ObjectModel`;
  * the `_PROCESSINGS` catalogue — the MVP’s equivalent of DataLab’s
    `register_1_to_1` machinery;
  * thin helpers (`create_signal`, `list_signals`, `get_signal_xy`,
    `apply_processing`, `delete_signal`, `list_processings`) that the JS layer
    calls. Every helper returns JSON-serialisable values.
* **`src/runtime/runtime.ts`** is the only place that touches the Pyodide API.
  All Python calls go through `DataLabRuntime`; the rest of the UI consumes a
  typed interface (`SignalMeta`, `SignalData`, `ProcessingDescriptor`, …).
* **`src/runtime/RuntimeContext.tsx`** loads the runtime exactly once via React
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
* **No business logic in components**: components consume `useRuntime()` data
  and call back into `App.tsx`, which orchestrates the runtime.
* **JSON across the bridge**: prefer plain dicts/lists in Python helpers
  (`tolist()` on arrays) over passing PyProxies to JS.
* **Path strategy**: Vite is configured with `base: "./"` so the build is
  drop-in deployable to GitHub Pages and other sub-path hosts. Don’t introduce
  absolute URLs.
* **Pyodide version is pinned** (`PYODIDE_VERSION` in `runtime.ts` and the
  `<script>` tag in `index.html`). Bump both together; Pyodide’s wheel index
  is version-specific.

## Testing

DataLab-Web has three test layers (pytest in Pyodide, Vitest + RTL,
Playwright). Pick the cheapest layer that can express the behaviour;
the full decision tree, promotion criteria, and authoring rules for
permanent E2E specs live in [`doc/testing-strategy.md`](../doc/testing-strategy.md).

**Mandatory rule for UI changes**: every change that touches the UI
— bug fix, feature, or **any phase** of a multi-phase implementation —
must be exercised end-to-end with Playwright before it is declared
done. Type-checks, unit tests, and "looks fine in the dev server" are
not enough; Pyodide round-trips and async state interactions silently
break in ways only a browser-driven test catches reliably. Use a
throwaway probe (`tests/e2e/_repro_*.spec.ts`, deleted afterwards) when
the change does not warrant a permanent regression spec.

## Git workflow

* **Never commit without explicit approval.** Before running `git commit`,
  always submit the proposed commit message to the user (subject + body) and
  wait for confirmation. The user may edit the message or reject the commit
  outright.
* Prefer Conventional-Commits-style subjects (`feat:`, `fix:`, `refactor:`,
  `docs:`, `chore:`, …) but defer to the user's preference.
* Group related changes in a single commit; split unrelated changes.
* Never use `git push --force`, `git reset --hard`, or `--no-verify` without
  explicit user instruction.

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
