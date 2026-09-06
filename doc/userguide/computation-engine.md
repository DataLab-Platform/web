# Computation engine (Sigima)

The engine that actually computes signals and images is
[**Sigima**](https://github.com/DataLab-Platform/Sigima), a headless Python
library shared between desktop DataLab and DataLab-Web. Whatever the host
application, the algorithms, parameters and numerical results are the same.

## Where the documentation lives

There is **no separate Sigima documentation for the Web**, by design. The
existing reference on the
[DataLab project website](https://datalab-platform.com/) — even though its
screenshots show the Qt desktop UI — describes the same parameters and the
same outputs as those exposed here.

Useful entry points (desktop-framed but Web-relevant):

- [Signal processing reference](https://datalab-platform.com/en/features/signal/index.html)
- [Image processing reference](https://datalab-platform.com/en/features/image/index.html)
- [Sigima API reference](https://sigima.readthedocs.io/)

## How processings appear in DataLab-Web

The menu bar is populated **automatically** by introspecting Sigima's
catalog (`build_signal_catalog()` / `build_image_catalog()`). When a new
processing is added to Sigima upstream, it shows up in DataLab-Web at the
next release without any UI code change.

## Parameter dialogs

Each processing's parameters are described by a
[`guidata.DataSet`](https://guidata.readthedocs.io/) schema. DataLab-Web
reads that schema and renders the dialog automatically — the same data
model that the desktop application uses to draw its Qt forms.

Eligible bounded numeric parameters also get a slider beside the exact
numeric input. The slider never replaces typed entry and is omitted when the
schema does not provide safe finite bounds.

Compatible one-input/one-output processings expose an optional **Preview**
checkbox, initially off. Enabling it reuses the already-loaded computation
runtime to process a private copy of the source; it does not add an object,
alter history, or mark the workspace as modified. Edits are debounced while
typing and sampled while dragging a slider, with an immediate refresh when the
slider is released. If several objects were selected, **Preview source**
chooses the representative input without changing the selection or the final
batch operation.

**Cancel** and **Esc** discard the temporary result and any waiting refresh.
An already-running computation finishes in the background and its late result
is ignored. **OK** runs the normal processing path from the original source
and current parameters. Preview is hidden in the `runtime=main` fallback to
avoid running this interactive work on the UI thread. The Processing tab in
the object side panel retains its explicit **Apply** and **Reset** controls;
editing that tab never republishes a result automatically.

## What the desktop docs do **not** cover

- The **runtime constraints** of the browser (memory limits, OPFS,
  cross-origin isolation) — see
  [Differences from desktop DataLab](differences-from-desktop.md).
- DataLab-Web-specific UI affordances (Plotly toolbar, macro / notebook
  workers, plugin loader).
- The TypeScript SDK for embedding DataLab-Web in another web app.

For everything else — operators, filters, fits, detection algorithms,
units, ROI semantics, HDF5 file format — the desktop documentation is
authoritative.
