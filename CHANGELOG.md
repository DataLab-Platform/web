# Changelog

All notable changes to **DataLab-Web** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each pull request that introduces a user-visible change should add an entry to the `[Unreleased]` section; the release script promotes that section to a versioned heading at tag time.

## [Unreleased]

### Added

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

### Changed

- Menu and toolbar icons are now embedded directly in the bundle instead of being fetched as separate files, so they appear instantly on first paint without a brief flicker and without extra network round-trips.
- **Optimized bundle splitting and lazy-loading**: reduced the initial app bundle footprint from 2.05 MB to ~414 kB gzipped. Heavier vendor dependencies (Plotly, CodeMirror, and React) are now split into dedicated cacheable chunks, and code-editor panels (Macro and Notebook panels) are lazy-loaded after first boot.
- **Fast binary signal serialization**: large signal data arrays are now serialized using raw binary buffers via zero-copy views (`Float64Array`) instead of JSON stringification across the JS/Pyodide boundary, dramatically reducing serialization processing overhead.
- **Offscreen rendering and OPFS paging latency**: parallelized OPFS page-in disk operations via concurrent promises and optimized offscreen canvas paint loops (avoiding redundant pixel-level color allocations), ensuring responsive performance during heavy viewport updates.

### Fixed

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

### Added

- **Internationalisation framework**: the UI now renders in the user's regional language (auto-detected, with a language selector in the menu bar and a `?lang=` URL override). English is the source language and French is the first translated locale.
- **Spreadsheet array editor**: signal and image raw data (signal X/Y values, image pixel matrices) can now be edited directly from the properties panel through a spreadsheet-style array editor dialog, with an enriched array preview.

### Changed

- Inactive and computed parameter fields are now displayed read-only in the properties panel, matching DataLab Qt's behaviour.

### Fixed

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

[Unreleased]: https://github.com/DataLab-Platform/web/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/DataLab-Platform/web/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/DataLab-Platform/web/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/DataLab-Platform/web/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/DataLab-Platform/web/releases/tag/v0.1.0
