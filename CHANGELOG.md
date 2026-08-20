# Changelog

All notable changes to **DataLab-Web** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each pull request that introduces a user-visible change should add an entry to the `[Unreleased]` section; the release script promotes that section to a versioned heading at tag time.

## [Unreleased]

### Changed

- **Guidata compatibility:** browser runtimes now require guidata 3.15 and use
  its native async DataSet backend and JSON Schema exporter. The former
  backend backport has been removed; a focused compatibility patch preserves
  the `FloatArrayItem` sizing hints required by the browser array editor.

## [0.9.0] - 2026-08-11

### Added in 0.9.0

- **Environment report:** Help now exposes a copyable diagnostic snapshot with
  the DataLab-Web build, browser capabilities, Pyodide runtime, and installed
  Python distributions, without including workspace data.
- **Synthetic radiograph spike:** the bundled NDT demo now contains a
  deterministic thickness-varying background, detector noise and artifacts,
  compact and linear indications with varied geometry and contrast, and a
  declared overlap. Versioned JSON ground truth is preserved in the image
  metadata for algorithm-development tests. The data is explicitly synthetic;
  it does not validate radiographic realism, inspection performance, or
  standards compliance.
- **Validated Applications deep links:** documentation and product pages may
  open the bundled Camera quickstart or Pulse 500-shot demo by declaring the
  exact plugin, plugin version, recipe, recipe version, and example in the
  URL. DataLab-Web compares the request with the compatibility manifest loaded
  from its own bundle before replacing the workspace; unknown, unverified, or
  mismatched workflows show an explicit error and never trigger an implicit
  Python package installation.
- **Explicit Camera plugin bundle:** the Web runtime now ships the independent
  Camera characterization package as a versioned, SHA-256-checked wheel and
  can open its packaged HDF5 quickstart through the existing browser byte-I/O
  path. Its 96 x 128 dark frames now expose readout banding, amplifier glow,
  and defects, while its flat frames remain uniform-field acquisitions with
  vignetting, dust shadows, PRNU, and shot noise. Its shared recipe commits
  signals, images, anchored metrics, and
  provenance transactionally; a Chromium/Pyodide gate verifies a visible
  response curve, PRNU map, result table, and bounded demo-workspace memory.
  The separately reviewed manifest reports `verified` for the pinned
  DataLab-Web 0.9.0 / Pyodide 0.26.4 compatibility matrix.
- **Explicit Pulse plugin bundle:** the runtime now ships the independent Pulse
  characterization package as a versioned, SHA-256-checked wheel. Its shared
  recipe transactionally commits amplitude, raw-mean, aligned-mean, metrics,
  and provenance outputs for selected signals. A deterministic 500-shot
  Chromium/Pyodide gate verifies all visible outputs, six explainable status
  classes, 489 aligned shots, exact retained-array growth, and bounded WASM
  memory before the pinned compatibility manifest reports `verified`.

### Fixed in 0.9.0

- **Pyodide startup with scikit-image:** the runtime now loads Pillow
  explicitly before importing Sigima, avoiding a startup failure when
  Pyodide's scikit-image package omits Pillow from its dependency metadata.
- **Signal memory accounting:** the memory indicator no longer counts a
  signal's Y array twice through its equivalent `data` property, so retained
  workspace bytes now reflect the actual X/Y storage.

## [0.8.0] - 2026-08-07

### Added in 0.8.0

- **Demo workspace deep links**: the application can now be opened with a workspace already loaded, via the `?preload=` URL parameter (e.g. `…/web/?preload=demos/ndt.h5`). The workspace is fetched at startup once the runtime is ready; only same-origin files are accepted, so a link cannot make the app load data from a third-party server. Three demo workspaces (spectroscopy, photonics/laser, non-destructive testing) are shipped under `demos/` and back the "try it in your browser" links of the documentation's new use-case pages.
- **Startup panel selection**: the `?panel=signal` / `?panel=image` URL parameter opens the application directly on the requested panel. In addition, after a `?preload=` deep link the application automatically switches to the only non-empty panel, so a workspace containing only images no longer lands on an empty Signal panel.
- **Mixed signal axis groups**: selected signals may now be organized so related curves share one axis while other curves remain on separate vertical or horizontal axes. Compatible X axes stay synchronized, and each selection's organization is restored locally when the same workspace objects are selected again.

## [0.7.0] - 2026-08-03

### Added in 0.7.0

- **Multi-signal plot layouts**: several selected signals can now be displayed as an overlay, as vertically stacked plots with a shared X axis, or as horizontal side-by-side plots. The arrangement is available from the **View** menu and is remembered across sessions.

### Changed in 0.7.0

- **Gaussian, Lorentzian and Voigt interactive fits**: amplitude now consistently means signed peak height above the baseline, in the signal's Y units. Committed fit curves store versioned Sigima parameters, and both the main Pyodide runtime and computation workers require Sigima 1.1.6 or later so an older area-based model cannot be loaded silently.
- **Large-signal rendering**: dense curves now use viewport-aware level-of-detail rendering that keeps interaction responsive from 10,000 to 1,000,000 samples while preserving extrema, NaN gaps and endpoints; zooming in restores the exact samples for the visible range.
- **Large-workspace responsiveness**: plots avoid redundant redraws, multi-image spatial views rasterise each image to the available display budget, and object properties load bounded previews before fetching full arrays on demand. Cached summaries and atomic selection snapshots also reduce repeated Pyodide transfers when navigating between objects.
- **Startup performance**: the initial interface now defers the Pyodide runtime, Plotly views and code editors until needed, while preloading the primary plot during runtime startup. A build-time size budget protects the smaller initial JavaScript bundle from regressions.

### Fixed in 0.7.0

- **Interactive fit commits**: piecewise exponential fits and the other interactive fit types now store validated Sigima metadata, so committed fit curves can be re-evaluated reliably.
- **Object tree navigation**: creating, importing or processing an object now expands its group when necessary and scrolls the new object into view.
- **Plot title editing**: unreliable direct editing inside Plotly charts is now disabled, preventing temporary title changes that were lost or left the chart out of sync; object and axis titles remain editable from their standard property controls.
- **Multi-image spatial zoom**: zooming into the current image now restores its native pixels instead of remaining limited to the 512-pixel multi-image preview resolution.
- **Signal level-of-detail rendering**: dense curves now keep their display point budget aligned with the final plot width after panels resize, avoiding unnecessary points while preserving narrow extrema.
- **Signal, image and HDF5 imports**: importing an object now switches to its matching panel before selecting it, avoiding transient internal errors when an image was imported while the Signals panel was active.

## [0.6.3] - 2026-07-18

### Changed in 0.6.3

- **Image contrast**: images now open with outlier-eliminated contrast by default — the highest and lowest 1% of pixel values (2% total) are excluded from the initial colour range — instead of stretching the full raw min/max, which could wash out the image when a few extreme pixels were present. This matches DataLab desktop's default behavior. The **Auto** button in the contrast panel now resets to this same range rather than the raw data extrema; the contrast sliders still let you reach the full range if needed.
- **Save file / Save signal / Save image…**: on Chromium-based browsers (Chrome, Edge, …), this now opens the native "Save as…" dialog so you choose the destination folder, filename and extension directly — the browser equivalent of DataLab desktop's save dialog — instead of only prompting for a file extension and downloading silently. The same native dialog is now used for exporting metadata, ROIs, HDF5 workspaces, macros, notebooks and AI assistant conversations. On browsers without this API (Firefox, Safari), saving still falls back to downloading into the browser's Downloads folder, but a brief on-screen notification now confirms the file name and destination so it is no longer unclear whether (and where) the file was saved.
- **Save to directory…**: on browsers without a folder-picker API, you are now warned beforehand that each file will be downloaded individually into the Downloads folder, instead of silently falling back to that behavior.
- **Image toolbar**: the grid toggle and the resampling selector are now aligned and sized consistently with the colormap and invert controls.

### Fixed in 0.6.3

- **Saving and opening TIFF images**: saving (or opening) an image in TIFF format no longer fails with an internal `No module named 'tifffile'` error. The library required for TIFF support is now installed alongside the rest of the scientific stack at startup, so `.tif`/`.tiff` files can be written and read like any other image format.
- **Command palette search**: short queries no longer flood the results with unrelated commands. Typing `rota` (looking for _Rotation_) used to also match entries like _Import annotations_, _Polynomial calibration_ or _Horizontal projection_, because the search accepted any command whose letters appeared in order, however scattered. The search now keeps only commands that either contain the query as-is or match it word-by-word (initials), so results stay relevant while still finding commands like `fft` or `fan` → _Fourier analysis_.
- **HDF5 files converted from HDF4**: opening an HDF5 file produced by `h4toh5convert` no longer breaks the Properties panel (with a `could not be cloned` error) nor the display of imported signals and images. Such files carry HDF5 object-reference attributes (e.g. `DIMENSION_LIST`) that could not be transferred out of the computation worker; these attributes are now shown as plain text instead, so the data imports and displays normally.
- **Opening plain HDF5 files**: opening a regular (non-DataLab-workspace) HDF5 file no longer fails with an internal `ArrayBuffer already detached` error before the HDF5 browser could open. Such files now open in the HDF5 browser as expected, so you can pick which datasets to import.

## [0.6.2] - 2026-06-26

### Added in 0.6.2

- **Cancellable batch processing**: when you apply a processing to several selected signals or images at once, it now runs object by object through the progress dialog, whose **Cancel** button (or the **Esc** key) stops it at the next object — keeping the results already computed. Single-object operations and aggregations (which are a single computation) are not interruptible.
- **Busy indicator for long computations**: a single processing that takes more than a moment (e.g. a moving median on a large image) now shows a "Computing…" dialog with an animated bar, instead of only greying the interface.
- **Test data loading in Test Data plugin**: the bundled _Test Data_ plugin now offers menu actions to load a set of standard test signals and images (sine, Gaussian, dot matrix, …) directly, making it easy to explore processing features without importing external files.

### Changed in 0.6.2

- The Pyodide runtime now runs in a background worker **by default**, keeping the interface responsive while computations run. The previous in-thread runtime remains available as a fallback via `?runtime=main` (see [doc/troubleshooting.md](doc/troubleshooting.md)).

## [0.6.1] - 2026-06-26

### Added in 0.6.1

- **AI assistant from the welcome screen**: the welcome screen now offers an **Ask the AI assistant** entry that opens (and expands) the built-in assistant panel directly, so you can start chatting to inspect, create and process your data without hunting for the panel.
- **Image grid toggle**: the image viewer gained a grid toggle whose state is remembered across single-image and multi-image spatial views.

### Changed in 0.6.1

- Macros are no longer silently bulk-restored from the cache on a cold start: like notebooks, they are now reachable through the **Recent…** menus, and pristine template macros are no longer cached. The cold-start banner now points to the **Recent…** menus accordingly.
- Reduced the horizontal clutter of the menu bar and top UI for a cleaner layout.

### Fixed in 0.6.1

- Image regions of interest now update live while you move or resize them with the mouse, instead of only refreshing when the drag ends.
- Reworked image panning and zooming: box-zoom now sticks on release, panning works reliably on image traces (including fixing an inverted vertical pan and keeping square pixels), and the multi-image spatial overlay re-fetches the selected images' coordinates so it updates correctly.

## [0.6.0] - 2026-06-24

### Added in 0.6.0

- **Command palette**: a VSCode-style searchable overlay (opened with **Ctrl/Cmd+K** or the menu-bar button) lists every menu command by its localised path, with fuzzy search and full keyboard navigation, so any action can be found and run without hunting through the menus.
- **Toolbar**: a quick-access toolbar above the plot exposes the most common actions (metadata editing, ROI management, …) as buttons, mirroring DataLab desktop's toolbar.
- **Non-modal ROI editor**: region-of-interest editing now happens in a docked panel that keeps the plot fully visible, replacing the old full-screen modal dialogs that hid the data. It offers a compact ROI list, a single form editing the selected ROI, **draw** buttons that arm the matching plot tool (rectangle, circle, polygon, segment) — usable even when no ROI exists yet — and live two-way sync between the form and the plot overlay.
- **ROI clipboard**: ROIs can now be copied, pasted, imported and exported, making it easy to reuse the same regions across several signals or images.
- **Image profile extraction**: horizontal and vertical line profiles can be extracted interactively from the image viewer, with a freeze state that pins the current profile while you keep exploring the image.
- **Image spatial overlay multi-view**: a spatial overlay view places several images in a shared coordinate system and automatically switches to spatial mode when a geometry tool is used, preserving the current multi-selection after distributing images on a grid or resetting their positions.
- **Processing error dialog**: when a processing or analysis call fails, a copy-pasteable modal now surfaces the full traceback and the context of the failed request instead of failing silently; the traceback is still logged to the browser console.
- **Example plugins**: the _Plugins → Manage plugins…_ dialog now offers a set of bundled example plugins (ported from DataLab desktop) that you can load on demand to explore the plugin API — menus, submenus, message/question/parameter dialogs and a custom image processing.

### Changed in 0.6.0

- Signal ROIs now draw dashed boundary lines marking the region extent, making the selected interval easier to read on the curve.
- The image **Erase area** action moved into the **Processing** menu with a clearer icon, and several ROI-related labels were reworded for clarity.
- The signal plot legend was repositioned and restyled for better readability.
- Edit actions now target the appropriate group selection when operating on objects inside groups.
- The **Plugins** menu now lists plugin-contributed actions first and groups the **Manage plugins…** / **Reload all plugins** entries (now shown with icons) at the end, mirroring DataLab desktop.

## [0.5.0] - 2026-06-12

### Added in 0.5.0

- **Large-image level-of-detail (LOD) rendering**: the single-image viewer now rasterises only the visible viewport at a stride matched to the current zoom, so panning and zooming very large images (4096²+) stays responsive instead of re-rendering the full array on every interaction. Profiles, statistics, histograms and hover read-outs continue to read the full-resolution data, so accuracy is unchanged.
- **Memory indicator and reclamation**: the menu bar shows live memory usage — both the Pyodide WebAssembly heap and the data currently held by the workspace. Clicking the indicator opens a menu gathering the memory-related actions: a **Store data on disk** toggle and a one-click **Free memory** action to reclaim memory that is no longer in use.
- **Metadata editing menu**: a new **Edit → Metadata** submenu groups the metadata actions and adds a **Copy titles** action (mirroring DataLab desktop's "Copy titles to clipboard").
- **Delete all**: a new action removes every group and object at once, behind a confirmation prompt.
- **On-disk storage mode**: a **Store data on disk** toggle (in the menu opened from the menu-bar memory indicator) spills heavy signal/image arrays to the browser's Origin Private File System (OPFS) instead of keeping them in the WebAssembly heap, so the working set is bounded by disk quota rather than the ~2 GB wasm32 memory ceiling. The HDF5 workspace remains the durable source of truth; the on-disk store is an ephemeral cache. Available only in secure contexts that support OPFS; the default stays in-memory.
- **Optional worker-hosted runtime** (developer-facing, opt-in via `?runtime=worker`): the Pyodide runtime can run in a Dedicated Web Worker behind a typed `RuntimeApi` façade, moving computation off the UI thread and enabling synchronous OPFS spills (binary payloads cross the worker boundary zero-copy). The default remains the in-thread runtime, so end-user behaviour is unchanged.
- **"Plot results" action**: a new menu action **Analysis → Plot results** (available for both signals and images) aggregates scalar, statistical, or geometrical results (such as FWHM, centroid, or bounding boxes) from all selected items and plots them automatically as a new 1D signal curve, replicating DataLab desktop's behavior.
- **70 default scientific colormaps**: migrated the application from 8 basic color scales to 70 exact default scientific colormaps. Smooth maps are defined using collinearity-reduced stops to keep the bundle size small (under 24 KB) and are lazily expanded into cached 256-entry RGB lookup tables at runtime.
- **Directory root group naming**: when using the **Open from directory…** feature, files residing directly in the top-level folder are now grouped in a group named after that picked folder (functional parity with DataLab desktop's path-basename fallback) instead of under a generic `(root)` label.
- **Multi-selection group processing**: aligned processing target routing on multi-selection with DataLab desktop. Processing operations on objects within groups now organize the outputs into dedicated, logically linked result groups instead of dropping them flat into the same source group.
- **Multi-selection ROI extraction**: aligned region-of-interest extraction on multiple selected signals or images, allowing users to apply the current object's ROI to all selected objects and grouping the outputs cleanly.
- **Blob detection grouping**: grouped blob detection under the **Analysis** submenu to mirror the DataLab desktop menu organization.

### Changed in 0.5.0

- Menu and toolbar icons are now embedded directly in the bundle instead of being fetched as separate files, so they appear instantly on first paint without a brief flicker and without extra network round-trips.
- **Optimized bundle splitting and lazy-loading**: reduced the initial app bundle footprint from 2.05 MB to ~414 kB gzipped. Heavier vendor dependencies (Plotly, CodeMirror, and React) are now split into dedicated cacheable chunks, and code-editor panels (Macro and Notebook panels) are lazy-loaded after first boot.
- **Fast binary signal serialization**: large signal data arrays are now serialized using raw binary buffers via zero-copy views (`Float64Array`) instead of JSON stringification across the JS/Pyodide boundary, dramatically reducing serialization processing overhead.
- **Offscreen rendering and OPFS paging latency**: parallelized OPFS page-in disk operations via concurrent promises and optimized offscreen canvas paint loops (avoiding redundant pixel-level color allocations), ensuring responsive performance during heavy viewport updates.

### Fixed in 0.5.0

- Changing a displayed object's properties (title, axis labels/units…) from a macro, notebook, remote-control call or the AI assistant now refreshes the central plot immediately, instead of updating only the object tree and leaving stale axis titles/units on the graph.
- Fixed spurious `get_image_data failed` console errors when a script or notebook creates a signal and then an image in quick succession (e.g. the **Signal & image processing** notebook template): a panel refresh could briefly leave the image viewer pointed at a signal object. The processing results were unaffected; only the stray errors are gone.
- Running a notebook that switches between the signal and image panels mid-run (e.g. **Run all** on a template that creates a signal and then an image) no longer leaves the central viewer pointed at the wrong object kind or raises stray errors.
- Editing an image's properties (title, labels, units…) no longer triggers a console error; image metadata edits now refresh the image view correctly instead of attempting to read it as a signal.
- In **Store data on disk** mode, the object tree now reports each object's real size (number of points, width × height) instead of showing "1 pt" for every object whose data has been spilled to disk.
- Region-of-interest extraction (signal and image) and the image **Erase area** action now produce fully resolved result titles, instead of leaving unresolved placeholders such as `extract_roi({0})`.
- Deleting an image group no longer fails with an "Unknown group" error.
- Auto-generated parameter dialogs now show the correct heading, taken from the dataset's own title.
- Updated the Microsoft Edge "slow load" hint: it now points at Edge's secure-mode site settings and explains how to allow DataLab-Web to run at full speed.
- **Dynamic active-state grayout**: implemented full active-state tracking (`active_state` parameter) across all generated guidata forms, dynamically graying out inactive or conditionally disabled parameter fields in real time.
- **Computed read-only field rendering**: fixed styling and visibility of computed or read-only guidata parameters (such as the dynamic "Operation" field in the Arithmetic dialog), displaying them as clear, immutable fields in the side panel.
- **Complete French translation parity**: added dynamic menu and analysis feature keys from Sigima into the locales extraction registry and fully translated them to French, bringing translation parity with DataLab Qt.
- **Cursor drag mode on image stats**: activating the image statistics tool now automatically forces the Plotly cursor dragmode to rectangular selection (`drawrect`), removing the need to manually switch modes to define the ROI.
- **Radial profile processing flow**: aligned the image radial profile dialog, profile center parameters, interactive behavior and auto-titles with the desktop application.
- **Simultaneous 1-to-0 analyses**: 1-to-0 analyses (such as FWHM, centroid, etc.) now run on all selected signals concurrently instead of just the last selected one, drawing merged geometry overlays on the plot and formatting result tables to match DataLab desktop's columns (e.g., contracting segment analyses to single dX columns).
- **Multi-selection action enablement**: actions like **Remove all ROIs** and **Clear results** are now unlocked when any of the selected objects meet the criteria, operating across the entire selection.
- **Multi-image grid loop guard**: resolved React key collisions and infinite render loops occurring on the multi-image grid panel when list groups had duplicate object IDs.
- **Active tab color**: aligned the background color of selected Signals/Images tabs with the panel background color for a fully integrated visual design.

## [0.4.0] - 2026-06-01

### Added in 0.4.0

- **Internationalisation framework**: the UI now renders in the user's regional language (auto-detected, with a language selector in the menu bar and a `?lang=` URL override). English is the source language and French is the first translated locale.
- **Spreadsheet array editor**: signal and image raw data (signal X/Y values, image pixel matrices) can now be edited directly from the properties panel through a spreadsheet-style array editor dialog, with an enriched array preview.

### Changed in 0.4.0

- Inactive and computed parameter fields are now displayed read-only in the properties panel, matching DataLab Qt's behaviour.

### Fixed in 0.4.0

- Non-uniform images now render with their exact pixel coordinates (correct extent and hover Z values) instead of being collapsed onto a uniform grid.
- Picture-in-Picture floating windows and their `pagehide` listener are now properly cleaned up when the side panel is closed.
- Pending annotation writeback is cancelled when a signal plot is unmounted, avoiding writes to stale objects.
- Legacy AI Assistant API keys are migrated to encrypted storage without creating duplicate entries.

### Security

- guidata field labels and descriptions are now sanitised before being injected as HTML in auto-generated parameter forms.
- The HDF5 browser tree now guards against unbounded recursion depth when exploring deeply nested files.

## [0.3.0] - 2026-05-23

### Added in 0.3.0

- In-app **Release notes** dialog (Help menu and Welcome page), backed by this changelog bundled at build time, with a "NEW" badge on the Welcome page until the user opens it for the current version.
- **AI Assistant** extensions: streaming responses with live typing, per-turn token usage, message-history capping, base-URL presets with connection testing, outgoing-message sanitisation, and a dedicated toggle in the menu bar.
- **Open from directory…** action that imports every non-empty subfolder as a new group.
- **Image plot** offscreen-canvas rendering with custom hover tooltip, eliminating the multi-second freeze on 2048²+ images.
- **Floating panels** for the Notebook and Macro editors on top of a generic draggable & resizable overlay reused by the AI Assistant.
- **Welcome page** with guided tour; Create/Open file rows open a Signal/Image picker.
- **Generic cancellable progress dialog** for long-running multi-step operations.
- **Static macro linting** integrated into the macro panel.
- **Edge slow-loading hint** shown while Pyodide bootstraps.
- **Persistent console status indicator** with error tracking.
- Bundled notebook templates and quickstart publishing examples.
- `proxy.get_current_object_uuid()` exposed to macros.
- Multi-object drag-and-drop in the object tree; clickable hex short IDs in titles; HTML markup rendered in DataSet field descriptions.
- HDF5 menu labels clarified (browse vs. open workspace); silent option for programmatic workspace loads.

### Changed in 0.3.0

- Processing result titles substitute source object IDs.
- Markdown view strips inline images; AI system prompt instructs models not to embed binary payloads.
- New icons and view-switcher refactor; Prettier + Ruff pre-commit setup with format-check enforced in CI.

### Fixed in 0.3.0

- Macro editor cursor jumping to start on each keystroke in Firefox; splitter drag direction.
- Auto-select newly added/processed objects from macros and notebooks.
- HDF5 browser dialog cleanup compatible with React StrictMode.
- Editor views disposed on theme change; `float_array` fields keep `np.ndarray` type; large array values kept out of the property form draft.
- Favicon now uses a local icon file.

## [0.2.0] - 2026-05-22

### Added in 0.2.0

- **AI Assistant** with provider integrations, vision capture, conversation persistence (with input history), encrypted-at-rest API keys, stop/rename/markdown-export controls and an LLM-driven macro tool gated by user approval.
- **Light / dark theme** switcher with persisted preference.
- Benchmark scripts and chain runner comparing DataLab Qt and the Pyodide engine.
- Release helper script for version bumping and tagging.

### Changed in 0.2.0

- **AI panel header** uses icons instead of text buttons.
- **Side panel** memoises form re-initialisation when inputs are unchanged.
- Removed shortcut hints from menu items.

### Fixed in 0.2.0

- Detection analyses produce ROIs around detected features and lazily install OpenCV when needed.
- Side panel preserves edited Processing values after Apply.
- Confirmation dialog before deleting selected objects.
- Image plot margins and legend positioning with analysis-results overlay.
- Test data plugin image actions repaired.

## [0.1.0] - 2026-04-08

### Added in 0.1.0

- Initial public release of DataLab-Web.
- Browser-native React + TypeScript UI driving the **Sigima** computation engine through Pyodide.
- Signal and image panels with object tree, properties editor, ROI editing and metadata/annotation tools.
- Plotly-based curve and image rendering with results overlay.
- Auto-generated parameter dialogs from guidata DataSet schemas.
- HDF5 browser and workspace open/save.
- Notebook and macro editors with secondary Pyodide workers.
- Plugin system, in-app User guide drawer and guided tour.
- Welcome page surfacing the most common startup actions.
- Remote-control / proxy bridges for host page integration.

[Unreleased]: https://github.com/DataLab-Platform/web/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/DataLab-Platform/web/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/DataLab-Platform/web/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/DataLab-Platform/web/compare/v0.6.3...v0.7.0
[0.6.3]: https://github.com/DataLab-Platform/web/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/DataLab-Platform/web/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/DataLab-Platform/web/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/DataLab-Platform/web/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/DataLab-Platform/web/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/DataLab-Platform/web/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/DataLab-Platform/web/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/DataLab-Platform/web/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/DataLab-Platform/web/releases/tag/v0.1.0
