# Notebooks

DataLab-Web ships an in-browser notebook environment that lets you
script DataLab from Python without leaving the page. Cells run inside
the same [Pyodide](https://pyodide.org/) kernel that powers the rest
of the application, so all of [Sigima](https://datalab-platform.com/)
is available out of the box.

## Opening the panel

Click the **Notebooks** tab in the side panel switcher. The first
time you open it, a bundled **Quickstart** notebook walks you through
generating a synthetic signal, displaying it, and running a
moving-average filter.

### Creating new notebooks

Three entry points create a fresh notebook:

* The **+** button at the right of the notebook tab strip opens a
  small dropdown with two choices:
  * **Empty notebook** — a single empty code cell.
  * **Quickstart template** — the same bundled tutorial as the
    first-launch notebook (`SignalObj` creation, `display(…)` and
    `sps.moving_average`).
* **File → Notebook → New notebook** mirrors the first option.
* **File → Notebook → New notebook from template → Quickstart**
  mirrors the second.

New notebooks are not persisted until you make the first edit
(autosave then kicks in — see *Multi-tab + persistence* below).

## Cell types

* **Code cells** — Python source executed by Pyodide. Use
  `Shift+Enter` to run, `Ctrl+Enter` to run-without-advancing.
* **Markdown cells** — rendered with [marked](https://marked.js.org/)
  and sanitised with [DOMPurify](https://github.com/cure53/DOMPurify).
  Double-click a rendered cell to edit it again; commit with
  `Ctrl+Enter`.

The toolbar exposes **+ Code**, **+ Markdown**, **Convert** (toggles
the active cell's type), **Delete**, **Run**, **Run All** and
**Restart**.

## Pre-injected names

Every code cell shares one persistent namespace. The following names
are pre-injected so you can use them without imports:

| Name        | Description                                                  |
| ----------- | ------------------------------------------------------------ |
| `np`        | NumPy                                                        |
| `proxy`     | Sigima runtime proxy (same one DataLab macros use)           |
| `display`   | Renders a `SignalObj` / `ImageObj` / Plotly figure / table   |
| `show_signal`, `show_image` | Lower-level display helpers                  |

`SignalObj`, `ImageObj`, and the `sigima.proc.*` modules are not
pre-imported — `import sigima.proc.signal as sps` etc. as you would
in a regular Python file.

`proxy` mirrors DataLab desktop's :class:`RemoteProxy` and is fully
**asynchronous**: every call must be `await`-ed (e.g.
`oid = await proxy.add_signal("sine", x, y)`). Pyodide automatically
wraps top-level `await` in cells, so this works out of the box.

## Multi-tab + persistence

* Each tab is an independent notebook with its own cell list and
  execution counter, but **all tabs share a single kernel**. State
  variables defined in one notebook are visible from the others.
* Notebooks are auto-saved to your browser's IndexedDB ~600 ms after
  any edit. Empty / pristine notebooks are not persisted.
* The **Browser… (N)** menu in the toolbar lists every saved
  notebook; clicking an entry focuses its tab if it is already open.
* Closing the last tab spawns a fresh empty notebook so the panel is
  never empty.

> **What survives a reload?** The IndexedDB cache is a *roll-over
> recovery cache*, not durable storage. Notebook **content** is
> rehydrated automatically on the next page load (and surfaced
> through a one-time recovery banner so you know the workspace was
> reseeded from the cache). To make a complete workspace durable
> — including signals, images, groups and metadata — use **File →
> Save HDF5 workspace…**. See *Persistence model* in the README.

## File compatibility (`.ipynb`)

DataLab-Web reads and writes the standard
[nbformat v4.5](https://nbformat.readthedocs.io/) format used by
Jupyter, JupyterLab, VS Code and GitHub. Use:

* **File → Notebook → Open notebook…** (or the toolbar's **Open…**) to
  import a `.ipynb` from disk.
* **File → Notebook → Save notebook as…** (or the toolbar's **Save
  as…**) to download the active notebook.

The notebook name is preserved through round-trips via a
`metadata.dlw.name` entry; everything else follows the standard
schema and renders correctly in any nbformat-aware viewer.

## Renaming a notebook

* Click the toolbar's **✎ Rename** button or
* Double-click the active tab title, or
* Use **File → Notebook → Rename notebook…**.

An inline input replaces the tab title. Press **Enter** to commit or
**Escape** to cancel. (We avoid `window.prompt` because it is
silently no-op in some embedded webviews — notably the VS Code Simple
Browser.)

## Keyboard shortcuts (cell editor focus)

| Shortcut       | Action                                  |
| -------------- | --------------------------------------- |
| `Shift+Enter`  | Run the current cell, advance focus     |
| `Ctrl+Enter`   | Run the current cell, stay              |
| `Esc`          | Leave edit mode (markdown cells)        |

## Converting to / from a DataLab macro

Notebooks and macros share the same `proxy.*` API, so any code-cell
workflow can be turned into a one-shot macro and vice versa:

* **Notebook panel → Convert to macro** opens the active notebook as
  a fresh macro in the Macros panel and switches you to it. Each
  cell becomes a labelled block:
  * Code cells are emitted under a `# %%` separator.
  * Markdown cells are emitted under `# %% [markdown]` with each
    line prefixed by `# ` so the file remains valid Python.
* **Macro panel → Convert to notebook** does the inverse: it splits
  the macro source on those same `# %%` / `# %% [markdown]`
  markers, restores markdown cells, and opens the result in the
  Notebook panel. A macro that contains no marker simply yields a
  single code cell with the full source.

The markers follow the de-facto convention used by Spyder and the
VS Code Python extension, so you can also drop into a regular `.py`
file, add separators by hand, and use **Convert to notebook** to
turn it into a structured workflow. The conversion is intentionally
lossy on outputs and execution counts — only cell *structure* and
*source* round-trip.
