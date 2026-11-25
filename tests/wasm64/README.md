# Browser qualification for the WASM64 prototype

These tests are opt-in. They do not publish a site and do not allocate a large image.

## Same-origin storage and capabilities

The demo uses a separate `dlw-wasm64-demo.` prefix for browser preferences, trust decisions, session credentials, IndexedDB databases, OPFS directories and their locks. Both demo engines share this profile; the stable build keeps its historical keys. The WASM64 engine runs in RAM and does not start Pyodide macro/notebook workers, restore plugins, connect the assistant/remote bridge or install packages for optional analyses. Scripts in an HDF5 workspace remain data. These restrictions do not apply to a deliberate `?engine=pyodide` restart. The verified WASM64 loader currently disables its package cache; if enabled later, use `storageName` with an architecture- and lock-specific cache name, including for the bytecode cache.

To clear demo browser data, save your HDF5 first, close other demo tabs and navigate the remaining demo tab to `?reset-demo-storage=1`. Confirm there to clear only demo storage (session storage is tab-local). Opening the URL alone does not clear data. This is not the File → New workspace command and does not delete downloaded files.

For a lightweight coexistence check, serve two **production app shells** at `/web/` and `/web-wasm64/` in the same Chromium profile. The test deliberately blocks interpreter downloads; it does not qualify scientific boot, HDF5 or the production artifact. It exercises real browser storage and confirmed reset rather than mocks.

```powershell
$env:VITE_WASM64_DEMO = "1"
npx vite build --outDir build/coexistence/web-wasm64 --sourcemap false
Remove-Item Env:VITE_WASM64_DEMO
npx vite build --outDir build/coexistence/web --sourcemap false
npx playwright test --config tests/wasm64/coexistence.config.ts
```

The local shell server uses `python -m http.server`; activate `.venv` or put its Python on `PATH` first. For the pre-publication check against two complete static artifacts already served on one origin, set `DLW_COEXISTENCE_ORIGIN` to that origin (e.g. `http://127.0.0.1:8000`) and run the same Playwright command. Serve `.mjs` as `text/javascript` (Windows MIME defaults may give `text/plain`) and `.wasm` as `application/wasm`. This mode does not intercept interpreter downloads. It checks the active engine and kernel-worker placement for stable default, demo default, demo Pyodide fallback and explicit stable `?engine=pyodide&runtime=main`; the Pyodide boots must not fetch WASM64 assets.

## Reference workspace (real application, both engines)

Run from the DataLab-Web source root, with the pinned npm dependencies, Playwright Chromium and an isolated Python environment. The native checker uses the published Sigima version in `sigima-dependency.json`, not a sibling development checkout.

```powershell
npm ci
npx playwright install chromium
uv venv --python 3.12 .venv
uv pip install --python .\.venv\Scripts\python.exe "sigima==1.4.1" "guidata==3.17.3" "datalab-capsule==0.2.0"
.\.venv\Scripts\python.exe -I tests\wasm64\native_workspace.py generate build\wasm64\fixtures\source.h5
# First prepare the verified bundle as described in ../../tools/wasm64/README.md.
npm run wasm64:build
npm run wasm64:test:a
$env:DLW_TEST_ENGINE = "pyodide"
npm run wasm64:test:a
Remove-Item Env:DLW_TEST_ENGINE
```

The test serves `build/wasm64/demo/` at `/web-wasm64/`. It opens the generated workspace, runs the Gaussian filter through the menu (`sigma=1.25`), refuses an invalid file without changing the working data, cancels a save, downloads the HDF5, reloads the page and opens the downloaded file. The independent Python check reads that file, including its provenance block, and compares all pixels against native Sigima. A separate check with a missing manifest requires a visible error, not an automatic engine switch. `DLW_REFERENCE_PYTHON` can select a different native Python executable. WASM64 is served locally; the explicit Pyodide reference needs its normal package servers. Neither run demonstrates large-memory capacity. See the [private addition qualification](./benchmark/README.md) for the separate dedicated-machine handoff.

On baseline `03d74b50`, the generated input was 218,268 bytes (SHA-256 `b102ccd7079b23f843d5e0792be150e1aa470b5a68299f3d68769577a99db51d` with the tested native stack). Every filtered pixel matched the native result. The production bundle was emitted, but `npm run build` returned nonzero at the pre-existing initial JavaScript budget check (400.2 KiB gzip; limit 400 KiB). Running the UI check against those emitted files does not waive that check for release.

## Standalone WASM64 worker

```powershell
npm ci --prefix tools\wasm64
node tests\wasm64\qualify-worker.mjs --core-only
```

This diagnostic serves the npm package locally under the project URL prefix. It checks Memory64, starts CPython in a module worker, calls Python with keyword arguments, round-trips a JS promise to the page, and transfers two owned bytes. It does not import Sigima or validate HDF5. The `core-only` result must not be reported as a scientific pass.

The full worker probe is `node tests\wasm64\qualify-worker.mjs` (no flag). It requires the verified scientific bundle in `build/wasm64/public/` and fails if it is missing; it never falls back to the core test or another engine. With the [artifact-specific build option](../../tools/wasm64/README.md), Chromium 156.0.8078.4 imported Matplotlib, solved two constraints with kiwisolver, applied Sigima's Gaussian filter after a guidata form reply, and reread its output from HDF5. This qualifies the standalone worker, not the application UI, deployment, or large-memory case.
