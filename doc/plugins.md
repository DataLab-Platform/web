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

| Attribute / method | Purpose |
| --- | --- |
| `self.main` | Bridge to the React main window (parent for dialogs) |
| `self.signalpanel`, `self.imagepanel` | Panels with `processor`, `acthandler`, `get_newparam_from_current` |
| `self.proxy` | `LocalProxy`-compatible API: `add_object`, `add_group`, `calc`, `get_object*`, `call_method` |
| `self.show_warning` / `show_error` / `show_info` | Async message popups |
| `self.ask_yesno(msg, cancelable=False)` | Async yes/no(/cancel) prompt |
| `self.edit_new_signal_parameters_async(...)` | Async variant of the desktop helper |
| `self.edit_new_image_parameters_async(...)` | Async variant of the desktop helper |

## Browser-only differences

* **Synchronous dialogs raise `BrowserNotSupportedError`.**
  `param.edit(self.main)`, `BaseProxy.calc(...)` blocking calls and any
  similar synchronous prompt are unavailable. Always use the `_async`
  counterparts.
* **No filesystem access** beyond Pyodide's in-memory FS. Plugins that
  read local files on the desktop should use the file picker exposed by
  the host UI instead.
* **No worker / process isolation.** All plugin code runs in the same
  Python interpreter as Sigima. Long-running computations will freeze
  the UI; consider chunking via `asyncio.sleep(0)` to yield.

## Loading a plugin

* **From the file picker:** open *Plugins → Manage plugins…*, click
  *Load from file…* and select a `.py` file. The first time a plugin is
  loaded you will be prompted to confirm execution. The decision is
  remembered (per source SHA-256) in `localStorage`.
* **Bundled built-ins:** drop a file into
  `src/runtime/builtin_plugins/`; it will be discovered automatically at
  startup.

## Hot reload

*Plugins → Reload all plugins* re-imports every loaded plugin module
from disk. The plugin registry strips all features and menu entries
contributed by previous versions before re-applying them, so live
edits are safe.
