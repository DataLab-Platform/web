# DataLab-Web example plugins

This folder mirrors DataLab desktop's `plugins/examples/` directory: it holds a small set of **example plugins** that you can load on demand from _Plugins → Manage plugins…_ (they appear under the **Example plugins** section). They are **not** loaded automatically — that is the difference with the built-in plugins under [`src/runtime/builtin_plugins/`](../../src/runtime/builtin_plugins/), which _are_ discovered at startup.

These examples are bundled at build time (via Vite's `import.meta.glob`) so that the host can offer them as one-click loadable plugins, but the source of truth lives here, version-controlled and lint-checked, exactly like the desktop examples.

## Available examples

| File                                                                 | Demonstrates                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`datalab_example_empty.py`](datalab_example_empty.py)               | Minimal plugin structure; nested submenus                                  |
| [`datalab_example_nested_menus.py`](datalab_example_nested_menus.py) | Deep submenu hierarchies on both the signal and image panels               |
| [`datalab_example_dialogs.py`](datalab_example_dialogs.py)           | Message / question / parameter dialogs and object creation                 |
| [`datalab_custom_func.py`](datalab_custom_func.py)                   | Registering a custom image processing via `processor.register_1_to_1(...)` |

## Browser-specific differences from the desktop examples

These examples target DataLab-Web only: they rely on its browser shim of the desktop plugin API, which differs from DataLab Desktop on two points.

- **Plugin code cannot block the JavaScript event loop.** Action callbacks that open a dialog are `async` and use the `_async` helpers (`show_info_async`, `show_warning_async`, `show_error_async`, `ask_yesno_async`, `edit_new_signal_parameters_async`, `edit_new_image_parameters_async`). These helpers exist only in DataLab-Web, and DataLab Desktop does not run `async` callbacks.
- **The desktop registration model is not supported.** The desktop examples register processings in `register_computations()` and add them to a menu with `acthandler.action_for(...)`; the shim calls neither (`action_for` returns `None`, see [issue #94](https://github.com/DataLab-Platform/web/issues/94)). Custom processings are therefore registered in `create_actions()` with `processor.register_1_to_1` / `register_2_to_1` / `register_n_to_1`, and appear under the _Plugins_ menu.

A plugin targeting both applications declares a distinct Web class in the `datalab.web_plugins` entry-point group. See [`doc/plugins.md`](../../doc/plugins.md) for the full authoring guide and the list of API differences.

## Desktop examples not ported

- `datalab_example_imageproc.py` — relies on `processor.run_feature(...)` and the OpenCV blob detector, which are not available in the browser runtime.
- `datalab_example_imageformat.py` — registers a custom image I/O format; the desktop I/O-format infrastructure is not yet exposed in DataLab-Web.
