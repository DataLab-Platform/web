# Changelog

All notable changes to **DataLab-Web** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each pull request that introduces a user-visible change should add an entry to the `[Unreleased]` section; the release script promotes that section to a versioned heading at tag time.

## [Unreleased]

### Added

- **On-disk storage mode (experimental)**: a **File → Store data on disk (experimental)** toggle spills heavy signal/image arrays to the browser's Origin Private File System (OPFS) instead of keeping them in the WebAssembly heap, so the working set is bounded by disk quota rather than the ~2 GB wasm32 memory ceiling. The HDF5 workspace remains the durable source of truth; the on-disk store is an ephemeral cache. Available only in secure contexts that support OPFS; the default stays in-memory.
- **Optional worker-hosted runtime** (developer-facing, opt-in via `?runtime=worker`): the Pyodide runtime can run in a Dedicated Web Worker behind a typed `RuntimeApi` façade, moving computation off the UI thread and enabling synchronous OPFS spills. The default remains the in-thread runtime, so end-user behaviour is unchanged.

### Fixed

- Fixed spurious `get_image_data failed` console errors when a script or notebook creates a signal and then an image in quick succession (e.g. the **Signal & image processing** notebook template): a panel refresh could briefly leave the image viewer pointed at a signal object. The processing results were unaffected; only the stray errors are gone.

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
