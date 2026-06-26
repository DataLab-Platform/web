# Roadmap

## Short-term

- Generic results-table view aligned with the desktop _Results_ panel.
- Richer image data preview (numeric grid with virtualised scrolling).
- Move the main `DataLabRuntime` off the UI thread (macros already run in a dedicated Web Worker; the main computation Pyodide instance still lives on the main thread).
- Additional file formats through `sigima.io` (currently focused on text and HDF5).

## Longer-term

- Remote control bridge to a real DataLab desktop instance via the Web API.
- Collaborative sessions through shared workspace files.
