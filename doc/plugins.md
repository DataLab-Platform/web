# Authoring DataLab-Web plugins

DataLab-Web supports portable DataLab plugin classes inside Pyodide. A plugin
may be loaded as a consented single Python source file or installed as a
managed pure-Python wheel. Plugin code shares the main Python interpreter and
**is not sandboxed**. It must not block the JavaScript event loop.

For action-oriented source plugins, any path that opens a parameter dialog must
be `async` and use `await param.edit_async(self.main)` instead of synchronous
`param.edit(self.main)`. Application wheels should declare headless recipes
and examples; the generic Applications host owns their dialogs and commits.

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
      id="org.example.my-plugin",
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

- **Python source:** open _Plugins → Manage plugins…_, click
  _Load Python file…_ and select a `.py` file. The first time a plugin is
  loaded you will be prompted to confirm execution. The decision is
  remembered (per source SHA-256) in `localStorage`.
- **Local wheel:** click _Install wheel…_ and select a `.whl` file. DataLab-Web
  inspects the archive before consent and before importing plugin code. The
  review shows its SHA-256, distribution, version, Python requirement, tags,
  Web entry points, and dependency compatibility. Accepted artifacts and
  activation preferences are persisted under the dedicated
  `dlw-plugin-wheels` OPFS subtree. This command is disabled when persistent
  OPFS storage is unavailable.
- **Bundled examples:** the _Plugins → Manage plugins…_ dialog lists the
  example plugins shipped under the repo-root `plugins/examples/` folder
  (mirroring DataLab desktop). Click _Load_ next to one to try it; the
  same consent gate applies. These are **not** auto-loaded.
- **Bundled built-ins:** drop a file into
  `src/runtime/builtin_plugins/`; it will be discovered automatically at
  startup.

The hash identifies exact bytes; it does not prove that code is safe. A local
wheel remains visibly `unverified` after consent. It can access APIs exposed by
Pyodide and the browser origin. Disable or remove it from the manager to unload
its contributions and managed import modules; removing it also deletes its
OPFS artifact and revokes its stored trust decision.

## Managed wheel contract

A compatible wheel exposes at least one entry point in the dedicated Web
group. A distribution shared with Desktop may publish both groups; the browser
imports only `datalab.web_plugins` and never imports the Qt target.

```toml
[project.entry-points."datalab.web_plugins"]
my-plugin = "my_package.adapters.web:MyWebPlugin"

[project.entry-points."datalab.plugins"]
my-plugin = "my_package.adapters.desktop:MyDesktopPlugin"
```

The Web target must be a subclass of the portable `PluginBase` and provide a
stable namespaced `PluginInfo.id`. Application plugins include
`PluginCapability.APPLICATION`, declare `RECIPES` and optionally `EXAMPLES`,
and may implement `suggest_recipe_bindings()` or `materialize_example()`.
Recipe slots carry signal/image type, `ONE`/`MANY` cardinality, and required
state. Parameters are guidata `DataSet` classes. Outputs are returned as a
`RecipeOutcome`; DataLab-Web commits objects, anchored scalar results,
diagnostics, and provenance transactionally.

Version 1 of the installer deliberately accepts only local `*-none-any`
pure-Python wheels compatible with Pyodide's Python version. Native payloads,
archive traversal, reserved host namespaces, and distribution/package/plugin
collisions are rejected. Every `Requires-Dist` dependency must already be
provided by the host at a compatible version. There is no package-index lookup,
dependency resolution, network download, or implicit installation of a second
wheel.

## Bundled multi-module distributions

Single-file built-ins are not sufficient for a plugin that has a reusable
`core -> workflow -> adapters` package. DataLab-Web therefore ships qualified
multi-module plugins as explicit wheel assets under
`src/runtime/builtin_wheels/`. Each artifact has a checked version, size, and
SHA-256 entry in `bundledPlugins.ts`. The runtime fetches only the Vite-bundled
URL and passes the wheel through the same inspector and managed registry as a
local wheel before importing its Web entry point.

The Camera and Pulse characterization wheels are the first such bundles. They
are deliberately not installed from a public package index and their Desktop
entry points are not used in the browser. DataLab-Web supplies the portable
`datalab.*` host shim. Camera reuses the existing HDF5 byte loader for its
packaged quickstart, while Pulse creates its documented deterministic campaign
through the shared headless simulator. See
`src/runtime/builtin_wheels/README.md` for the update procedure.

Bundling proves distribution, not compatibility. A bundled artifact receives
the registry trust state `verified` only after its visible outputs and Pyodide
resource budget have passed the project-specific qualification gate.

The Camera gate in `tests/e2e/camera_bundle.spec.ts` runs the packaged campaign
through the real worker-hosted Pyodide runtime. It requires a visible Plotly
response trace, decoded non-blank PRNU-map pixels, and the anchored metrics
table in the Results panel. It also limits incremental WASM-heap growth to
64 MiB and retained output arrays to three times the input arrays. The status
qualifies DataLab-Web 0.8.0, Pyodide 0.26.4, Camera 0.1.0, and relative-DN
recipe 1.1.0.

The Pulse gate in `tests/e2e/pulse_bundle.spec.ts` executes the deterministic
500-shot campaign through Pyodide and transactionally commits three signal
outputs plus the anchored 500-row metrics table. It requires visible Plotly
traces for amplitude, raw mean, and aligned mean; all six quality statuses;
489 valid/aligned shots; no more than 64 MiB incremental WASM heap; and exactly
24,032 bytes of retained output arrays. This qualifies DataLab-Web 0.8.0,
Pyodide 0.26.4, Pulse 0.1.0, and pulse campaign recipe 1.1.0.

## Hot reload

_Plugins → Reload all plugins_ re-imports every loaded plugin module
from disk. The plugin registry strips all features and menu entries
contributed by previous versions before re-applying them, so live
edits are safe.
