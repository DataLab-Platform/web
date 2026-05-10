# Differences from desktop DataLab

DataLab-Web shares the **computation engine** (Sigima) and the **processing
catalog** with the desktop application: results are bit-for-bit identical for
the same inputs. The differences listed below are about the **runtime
environment** and a few UI surfaces, not about the science.

## Runtime

| Topic | Desktop DataLab | DataLab-Web |
| --- | --- | --- |
| Python | System CPython | Pyodide (CPython compiled to WebAssembly) |
| GUI toolkit | Qt + PlotPy | React + TypeScript + Plotly.js |
| Plotting | PlotPy (Qt) | Plotly.js |
| Multi-threading | Native threads / processes | Web Workers (one per macro / notebook) |
| File system | Native I/O | Browser file picker, drag-and-drop, OPFS |
| Persistence | HDF5 on disk | HDF5 download / upload, IndexedDB workspace cache |
| Remote control | XML-RPC, FastAPI Web API | In-browser proxy, optional postMessage SDK |

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
- **Plugins are JavaScript or Python**. JavaScript plugins live alongside
  the React app; Python plugins are installed into Pyodide at runtime.
  See [Plugins](#plugins).
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

JavaScript plugins are loaded from `plugins/` at startup; Python plugins
are installed via `micropip` and registered through the same hook system
as the desktop app. See [Plugins](plugins.md) for the practical guide.

## Macros and notebooks

See [Notebooks](notebooks.md) for the architecture and behaviour of the
notebook subsystem. Macros follow the same model: a dedicated Pyodide
worker, a proxy bridge to the main runtime, structured cell results.
