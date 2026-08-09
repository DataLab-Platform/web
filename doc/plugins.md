# Authoring DataLab-Web plugins

DataLab-Web supports the same plugin model as the desktop DataLab Qt
application, with one important constraint: **plugins run inside Pyodide
and cannot block the JavaScript event loop**. In practice this means
that any code path that opens a parameter dialog must be `async` and use
`await param.edit_async(self.main)` instead of the synchronous
`param.edit(self.main)`.

The good news: the same plugin source can be used in both DataLab Qt
and DataLab-Web. `DataSet.edit_async()` is implemented in upstream
`guidata`; on Qt it simply delegates to `edit()`.

## Anatomy of a plugin

```python
# my_plugin.py
from __future__ import annotations

from datalab.config import _
from datalab.plugins import PluginBase, PluginInfo


class MyPlugin(PluginBase):
    """Minimal DataLab-Web plugin example."""

    PLUGIN_INFO = PluginInfo(
        name=_("My plugin"),
        version="0.1.0",
        description=_("Adds a few useful actions"),
    )

    async def hello_world(self) -> None:
        # Use the proxy to manipulate the workspace.
        # `add_object`, `calc`, `get_object*`, `call_method` are all
        # available — see ``datalab.control.proxy.LocalProxy``.
        sig = ...  # build a SignalObj or ImageObj
        self.proxy.add_object(sig)

    def create_actions(self) -> None:
        sah = self.signalpanel.acthandler
        with sah.new_menu(_("My plugin")):
            sah.new_action(
                _("Hello world"),
                triggered=self.hello_world,
                select_condition="always",
            )
```

## Available APIs

`PluginBase` exposes the same surface as the desktop counterpart:

| Attribute / method                               | Purpose                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `self.main`                                      | Bridge to the React main window (parent for dialogs)                                         |
| `self.signalpanel`, `self.imagepanel`            | Panels with `processor`, `acthandler`, `get_newparam_from_current`                           |
| `self.proxy`                                     | `LocalProxy`-compatible API: `add_object`, `add_group`, `calc`, `get_object*`, `call_method` |
| `await self.show_info_async(msg)`                | Async info popup (`show_warning_async` / `show_error_async` for the other kinds)             |
| `await self.ask_yesno_async(msg, cancelable=…)`  | Async yes/no(/cancel) prompt                                                                 |
| `await self.edit_new_signal_parameters_async(…)` | Async variant of the desktop helper                                                          |
| `await self.edit_new_image_parameters_async(…)`  | Async variant of the desktop helper                                                          |

The synchronous helpers (`self.show_info` / `show_warning` / `show_error` /
`ask_yesno`) exist for desktop source compatibility but raise
`BrowserNotSupportedError` in Pyodide — use the `_async` variants above.

## Browser-only differences

- **Synchronous dialogs raise `BrowserNotSupportedError`.**
  `param.edit(self.main)`, `BaseProxy.calc(...)` blocking calls and any
  similar synchronous prompt are unavailable. Always use the `_async`
  counterparts.
- **No filesystem access** beyond Pyodide's in-memory FS. Plugins that
  read local files on the desktop should use the file picker exposed by
  the host UI instead.
- **No worker / process isolation.** All plugin code runs in the same
  Python interpreter as Sigima. Long-running computations will freeze
  the UI; consider chunking via `asyncio.sleep(0)` to yield.

## Loading a plugin

- **From the file picker:** open _Plugins → Manage plugins…_, click
  _Load from file…_ and select a `.py` file. The first time a plugin is
  loaded you will be prompted to confirm execution. The decision is
  remembered (per source SHA-256) in `localStorage`.
- **Bundled examples:** the _Plugins → Manage plugins…_ dialog lists the
  example plugins shipped under the repo-root `plugins/examples/` folder
  (mirroring DataLab desktop). Click _Load_ next to one to try it; the
  same consent gate applies. These are **not** auto-loaded.
- **Bundled built-ins:** drop a file into
  `src/runtime/builtin_plugins/`; it will be discovered automatically at
  startup.

## Bundled multi-module distributions

Single-file built-ins are not sufficient for a plugin that has a reusable
`core -> workflow -> adapters` package. DataLab-Web therefore ships qualified
multi-module plugins as explicit wheel assets under
`src/runtime/builtin_wheels/`. Each artifact has a checked version, size, and
SHA-256 manifest in TypeScript. The runtime fetches only the Vite-bundled URL,
verifies the artifact, writes it to Pyodide's filesystem, and adds the wheel to
`sys.path` before importing its Web adapter.

The Camera characterization wheel is the first such bundle. It is deliberately
not installed from a public package index and its Desktop entry point is not
used in the browser. DataLab-Web supplies the portable `datalab.*` host shim,
while the Camera adapter reuses the existing HDF5 byte loader for its packaged
quickstart. See `src/runtime/builtin_wheels/README.md` for the update procedure.

Bundling proves distribution, not compatibility. An adapter must report
`untested` until its visible outputs and Pyodide resource budget have passed
their project-specific qualification gate; only then may it report `verified`.

The Camera gate in `tests/e2e/camera_bundle.spec.ts` runs the packaged campaign
through the real worker-hosted Pyodide runtime. It requires a visible Plotly
response trace, decoded non-blank PRNU-map pixels, and the anchored metrics
table in the Results panel. It also limits incremental WASM-heap growth to
64 MiB and retained output arrays to three times the input arrays. The status
change itself remains a separate, reviewable adapter-manifest change.

## Hot reload

_Plugins → Reload all plugins_ re-imports every loaded plugin module
from disk. The plugin registry strips all features and menu entries
contributed by previous versions before re-applying them, so live
edits are safe.
