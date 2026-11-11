# Welcome to DataLab-Web

DataLab-Web is the **browser-native** sibling of the DataLab desktop application. It runs the same scientific computation engine — **Sigima** — entirely client-side via [Pyodide](https://pyodide.org/) (CPython compiled to WebAssembly). Processing your data never requires sending it anywhere: network services are used only when you enable them, such as the AI assistant (which sends your requests and the context you share to the provider you configure) or a capsule registry (to which capsules and their reviews are sent only when you publish them).

## What you can do here

- Load **signals** (1D curves) and **images** (2D arrays) from the file system.
- Apply Sigima processings from the menus: arithmetic, filtering, FFT, fitting, peak detection, morphology, segmentation, ROI extraction…
- Interact with results via [Plotly.js](https://plotly.com/javascript/) plots (zoom, pan, hover, export to PNG).
- Organise objects into groups, switch between **Signal** and **Image**
  panels, persist your workspace as an HDF5 file.
- See where each result comes from, check and verify it, and exchange it with DataLab Desktop as a capsule (see [Provenance and capsules](provenance-and-capsules.md)).
- Automate workflows with **macros** and **notebooks** running in dedicated
  Web Workers so the UI stays responsive.
- Play automated live demos of the application, for example on a conference booth screen, with the [Showcase mode](showcase-mode.md).
- Extend the application with **Python plugins** (portable `PluginBase` classes, hosted through a browser shim of the desktop plugin API) and a **TypeScript SDK** for embedding DataLab-Web in third-party apps.

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
