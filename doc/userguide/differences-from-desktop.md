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
| Memory          | System RAM (64-bit)        | ~2 GB wasm32 heap, optional OPFS on-disk spill    |
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

## Memory and on-disk storage

This is a concept **exclusive to DataLab-Web** with no desktop equivalent. Desktop DataLab runs on 64-bit system CPython and is limited only by the machine's RAM. DataLab-Web runs on Pyodide, a 32-bit (`wasm32`) WebAssembly build whose linear heap is capped at roughly **2 GB** in practice — and, because Emscripten never returns freed memory to the browser, that heap only ever grows during a session (a page reload resets it). Loading several large images (2048²+ float64) can therefore exhaust the tab where the desktop app would not even notice.

To lift that ceiling, DataLab-Web offers an opt-in **on-disk storage mode**, toggled from **File → Store data on disk (experimental)**:

- When enabled, the heavy NumPy array of every signal and image is **spilled out of the WebAssembly heap to disk** — specifically to the browser's [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) (OPFS), a sandboxed, origin-scoped, browser-managed filesystem. The object model keeps only metadata resident; each array is paged back in just for the duration of the operation that needs it.
- The result is that the working set is bounded by **disk quota instead of the ~2 GB RAM ceiling**, so you can work with datasets far larger than the heap would otherwise allow. The trade-off is a small per-operation latency for the disk round-trip.
- The OPFS store is an **ephemeral cache, not a save format**: the HDF5 workspace remains the single durable source of truth, exactly as in RAM mode. The store is cleared if you clear the site's data, and it is independent of the **File → Save HDF5 workspace…** action you use to persist your work.
- The toggle is only available in **secure contexts that support OPFS** (modern Chromium / Firefox / Safari over `https://` or `localhost`); when unavailable, it is disabled and the app stays in the default in-memory mode.

The desktop application has no analogue because it never hits a memory wall of this kind: this feature exists purely to work around the browser's WebAssembly memory model.

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
