# Differences from desktop DataLab

DataLab-Web shares the **computation engine** (Sigima) and the **processing
catalog** with the desktop application: results are bit-for-bit identical for
the same inputs. The differences listed below are about the **runtime
environment** and a few UI surfaces, not about the science.

## Runtime

| Topic           | Desktop DataLab            | DataLab-Web                                       |
| --------------- | -------------------------- | ------------------------------------------------- |
| Python          | System CPython             | Pyodide (CPython compiled to WebAssembly)         |
| GUI toolkit     | Qt + PlotPy                | React + TypeScript + Plotly.js                    |
| Plotting        | PlotPy (Qt)                | Plotly.js                                         |
| Multi-threading | Native threads / processes | Web Workers (one per macro / notebook)            |
| File system     | Native I/O                 | Browser file picker, drag-and-drop, OPFS          |
| Persistence     | HDF5 on disk               | HDF5 download / upload, IndexedDB workspace cache |
| Remote control  | XML-RPC, FastAPI Web API   | In-browser proxy, optional postMessage SDK        |

The first load downloads Pyodide (~10 MB) and installs Sigima via
`micropip`; expect 30–60 s on a cold cache. Subsequent loads are served
from the browser cache.

## What is intentionally different

- **No native dialogs**. File open / save go through the browser's own
  pickers; HDF5 workspaces are downloaded as files rather than written
  in place.
- **No Qt-only widgets**. PlotPy interactive tools (rotation, polygon
  picker…) are not available; equivalent flows are reimplemented with
  Plotly + React when applicable.
- **Plugins are Python only**. The Qt-compatible `PluginBase` API is
  shared with the desktop DataLab — the same plugin source runs in
  both, provided dialogs use `await param.edit_async(...)`. See
  [Plugins](#plugins).
- **Macros and notebooks run in Web Workers**. They have their own Pyodide
  instance and communicate with the main runtime through a structured
  proxy (`MacroRuntime`, `proxyBridge`). Long-running computations no
  longer freeze the UI.
- **Web API server is replaced by the in-browser SDK**. Embedding
  DataLab-Web in another web app is done via the
  [`@datalab-platform/web-sdk`](https://github.com/DataLab-Platform/web/tree/main/packages/sdk)
  package and `postMessage`, not HTTP / XML-RPC.

## What is intentionally **not** different

- The **object model** (`SignalObj`, `ImageObj`, ROI, groups) is identical.
- The **processing catalog** is discovered from Sigima — every function
  registered there appears in the menu bar with the same parameters.
- **Parameter dialogs** are auto-generated from the same guidata `DataSet`
  schemas as in the desktop app.
- **HDF5 workspace files** are interoperable: a workspace saved in
  desktop DataLab can be opened in DataLab-Web (and vice versa, within
  the limits of available processings).

## Plugins

Built-in Python plugins live under `src/runtime/builtin_plugins/` and
are discovered automatically at startup; user plugins are loaded from a
local `.py` file via _Plugins → Manage plugins…_. Both are registered
through the same hook system as the desktop app. See
[Plugins](plugins.md) for the practical guide.

## Macros and notebooks

See [Notebooks](notebooks.md) for the architecture and behaviour of the
notebook subsystem. Macros follow the same model: a dedicated Pyodide
worker, a proxy bridge to the main runtime, structured cell results.

## Performance

Running Python in WebAssembly is not free, but the cost is moderate:
on a typical processing chain (`gaussian_filter` → `moving_median` →
`magnitude_spectrum` → `opening` → `threshold` → `blob_log`, applied to
five 1024×1024 images), DataLab-Web is **~25% slower** than the same
Sigima pipeline on native CPython.

| Backend               | Pure processing time | vs CPython |
| --------------------- | -------------------- | ---------- |
| CPython 3.12 (native) | 7.8 s                | ×1.00      |
| Pyodide in Node.js    | 9.7 s                | ×1.24      |
| Pyodide in Chromium   | 9.8 s                | ×1.27      |

**Key takeaways:**

- The browser and Node.js backends perform almost identically — the
  WebAssembly engine is the dominant factor, not the host.
- Cold-start is the main visible difference: ~10 s for the Pyodide
  bootstrap + Sigima install on a cold cache, vs ~2 s for native
  Python startup. Subsequent operations run at full WASM speed.
- Visualization (Plotly.js) adds an overhead per displayed object
  comparable to the desktop PlotPy renderer for typical signals and
  images.

In practice, for the interactive workflows DataLab-Web targets
(load 1–3 objects, apply 1–2 processings, observe), the runtime cost
is dominated by Pyodide cold-start and is invisible once the
application is loaded.

The benchmark suite that produced these numbers lives under
[`tests/benchmark/`](https://github.com/DataLab-Platform/web/tree/main/tests/benchmark)
and can be reproduced with `npm run bench:run`.
