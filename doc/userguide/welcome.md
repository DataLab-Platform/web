# Welcome to DataLab-Web

DataLab-Web is the **browser-native** sibling of the DataLab desktop
application. It runs the same scientific computation engine — **Sigima** —
entirely client-side via [Pyodide](https://pyodide.org/) (CPython compiled to
WebAssembly). No data leaves your browser.

## What you can do here

- Load **signals** (1D curves) and **images** (2D arrays) from the file
  system or drag-and-drop them into the workspace.
- Apply the full Sigima processing catalog: arithmetic, filtering, FFT,
  fitting, peak detection, morphology, segmentation, ROI extraction…
- Interact with results via [Plotly.js](https://plotly.com/javascript/)
  plots (zoom, pan, hover, export to PNG/SVG).
- Organise objects into groups, switch between **Signal** and **Image**
  panels, persist your workspace as an HDF5 file.
- Automate workflows with **macros** and **notebooks** running in dedicated
  Web Workers so the UI stays responsive.
- Extend the application with **Python plugins** (Qt-compatible
  `PluginBase` API, shared with the desktop DataLab) and a
  **TypeScript SDK** for embedding DataLab-Web in third-party apps.

## Where to find help

This in-app **User guide** focuses on what is specific to DataLab-Web. For
everything that is shared with the desktop application — and that is the
majority — refer to the
[DataLab project website](https://datalab-platform.com/), keeping in mind
its desktop-centric framing.

When in doubt, the **AI assistant** (open it from the right edge of the
workspace) can answer most questions interactively.

## Reporting issues, contributing

DataLab-Web is open source. Issues and pull requests are welcome on
[github.com/DataLab-Platform/web](https://github.com/DataLab-Platform/web).
