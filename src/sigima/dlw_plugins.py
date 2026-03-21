# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Plugin loader for DataLab-Web (lives in Pyodide's site-packages).

Loaded once at startup by :mod:`bootstrap` *after* the ``datalab.*``
shim has been mirrored to ``/home/pyodide``. Owns:

* an in-process plugin registry (URL ↔ module ↔ instance ↔ origin);
* the file-system loader (``load_plugin_source(name, source)``);
* the directory discovery loop (``discover_plugins_in_dir(path)``);
* the hot-reload sequence (``reload_plugins()``).

The Qt counterpart lives in ``datalab/plugins.py``; here we only need
the pieces that DataLab-Web actually uses, in a single self-contained
module so the bootstrap stays focused on the object model.
"""

from __future__ import annotations

import importlib
import importlib.util
import os
import sys
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from datalab import registries
from datalab.plugins import PluginBase, PluginRegistry


PLUGINS_ROOT = "/home/pyodide/dlw_plugins"


@dataclass
class PluginRecord:
    """Live registration record for one plugin."""

    name: str
    module_name: str
    filename: str
    instance: PluginBase | None = None
    classes: list[type[PluginBase]] = field(default_factory=list)
    enabled: bool = True
    error: str | None = None


# Module-level state preserved across HMR re-executions of bootstrap.
_RECORDS: dict[str, PluginRecord] = globals().get("_RECORDS", {})  # type: ignore[assignment]
_MAIN: Any = globals().get("_MAIN", None)
_REGISTERED_LISTENERS: list[Callable[[], None]] = globals().get(
    "_REGISTERED_LISTENERS", []
)


def install_main(main: Any) -> None:
    """Install the :class:`DLMainWindow` facade for plugin ``register()``."""
    global _MAIN
    _MAIN = main


def _ensure_root() -> None:
    """Ensure the plugin staging directory exists and is on ``sys.path``."""
    if not os.path.isdir(PLUGINS_ROOT):
        os.makedirs(PLUGINS_ROOT, exist_ok=True)
    if PLUGINS_ROOT not in sys.path:
        sys.path.insert(0, PLUGINS_ROOT)


def _on_change() -> None:
    for listener in list(_REGISTERED_LISTENERS):
        try:
            listener()
        except Exception:  # pragma: no cover - defensive
            traceback.print_exc()


def add_change_listener(listener: Callable[[], None]) -> None:
    """Register *listener* to be called after every load/unload/reload."""
    if listener not in _REGISTERED_LISTENERS:
        _REGISTERED_LISTENERS.append(listener)


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def _module_name_for(filename: str) -> str:
    base = os.path.splitext(os.path.basename(filename))[0]
    if not base.isidentifier():
        base = "plugin_" + uuid.uuid4().hex[:8]
    return base


def _import_from_path(module_name: str, path: str) -> Any:
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load module from {path!r}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = mod
    spec.loader.exec_module(mod)
    return mod


def _classes_in_module(mod: Any) -> list[type[PluginBase]]:
    out: list[type[PluginBase]] = []
    for attr in vars(mod).values():
        if (
            isinstance(attr, type)
            and issubclass(attr, PluginBase)
            and attr is not PluginBase
            and attr.__module__ == mod.__name__
        ):
            out.append(attr)
    return out


def load_plugin_source(filename: str, source: str) -> dict[str, Any]:
    """Write *source* to ``PLUGINS_ROOT/filename`` and load (or reload) it.

    Returns a JSON-friendly dict describing the load result.
    """
    _ensure_root()
    path = os.path.join(PLUGINS_ROOT, os.path.basename(filename))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(source)
    return load_plugin_file(path)


def load_plugin_file(path: str) -> dict[str, Any]:
    """Import (or reimport) the plugin file at *path* and register it."""
    _ensure_root()
    name = _module_name_for(path)

    # If a record exists for this filename, unload it first so registries
    # are clean before the re-import. We key records by *module name*.
    if name in _RECORDS:
        unload_plugin(name)

    PluginRegistry.clear_failed_plugins()

    try:
        mod = _import_from_path(name, path)
    except Exception:  # pylint: disable=broad-except
        tb = traceback.format_exc()
        record = PluginRecord(
            name=name,
            module_name=name,
            filename=path,
            error=tb,
            enabled=False,
        )
        _RECORDS[name] = record
        _on_change()
        return _record_payload(record)

    classes = _classes_in_module(mod)
    if not classes:
        record = PluginRecord(
            name=name,
            module_name=name,
            filename=path,
            error="No PluginBase subclass found in module.",
            enabled=False,
        )
        _RECORDS[name] = record
        _on_change()
        return _record_payload(record)

    # Instantiate the *first* PluginBase subclass found; mirror the desktop
    # convention of one PluginBase per file.
    plugin_cls = classes[0]
    record = PluginRecord(
        name=name,
        module_name=name,
        filename=path,
        classes=classes,
        enabled=True,
    )
    try:
        instance = plugin_cls()
        if _MAIN is not None:
            instance.register(_MAIN)
        record.instance = instance
    except Exception:  # pylint: disable=broad-except
        record.error = traceback.format_exc()
        record.enabled = False

    _RECORDS[name] = record
    _on_change()
    return _record_payload(record)


def unload_plugin(name: str) -> dict[str, Any]:
    """Unregister and forget the plugin *name*."""
    record = _RECORDS.pop(name, None)
    if record is None:
        return {"name": name, "removed": False}
    if record.instance is not None:
        try:
            record.instance.unregister()
        except Exception:  # pylint: disable=broad-except
            traceback.print_exc()
    # Drop any leftover catalogue contributions registered under this
    # plugin's display name (covers plugins that didn't fully register).
    if record.instance is not None and record.instance.info is not None:
        registries.clear_origin(record.instance.info.name)
    # Remove the module from sys.modules so a subsequent load re-imports
    # fresh source.
    sys.modules.pop(record.module_name, None)
    _on_change()
    return {"name": name, "removed": True}


def discover_plugins_in_dir(directory: str) -> list[dict[str, Any]]:
    """Load every ``*.py`` file in *directory* (non-recursive)."""
    if not os.path.isdir(directory):
        return []
    out: list[dict[str, Any]] = []
    for entry in sorted(os.listdir(directory)):
        if not entry.endswith(".py") or entry.startswith("_"):
            continue
        path = os.path.join(directory, entry)
        out.append(load_plugin_file(path))
    return out


# ---------------------------------------------------------------------------
# Hot reload (mirrors DataLab Qt: unregister → clear → reimport → register)
# ---------------------------------------------------------------------------


def reload_plugins() -> list[dict[str, Any]]:
    """Reload every currently-loaded plugin in place.

    Mirrors the Qt sequence:
      1. unregister every plugin instance;
      2. clear the registries (catalogue contributions);
      3. drop modules from ``sys.modules``;
      4. re-import each file;
      5. instantiate + register again.
    """
    paths = [(rec.name, rec.filename) for rec in _RECORDS.values()]
    # Step 1+2+3 — unload_plugin handles all of them.
    for name, _ in list(paths):
        unload_plugin(name)
    # Step 4+5
    out: list[dict[str, Any]] = []
    for _, path in paths:
        out.append(load_plugin_file(path))
    return out


# ---------------------------------------------------------------------------
# Introspection
# ---------------------------------------------------------------------------


def list_plugins() -> list[dict[str, Any]]:
    """Return a JSON-friendly snapshot of every registered plugin."""
    return [_record_payload(rec) for rec in _RECORDS.values()]


def _record_payload(record: PluginRecord) -> dict[str, Any]:
    info = None
    if record.instance is not None and record.instance.info is not None:
        pinfo = record.instance.info
        info = {
            "name": pinfo.name,
            "version": pinfo.version,
            "description": pinfo.description,
            "icon": pinfo.icon,
        }
    elif record.classes:
        cls_info = getattr(record.classes[0], "PLUGIN_INFO", None)
        if cls_info is not None:
            info = {
                "name": cls_info.name,
                "version": cls_info.version,
                "description": cls_info.description,
                "icon": cls_info.icon,
            }
    return {
        "name": record.name,
        "filename": record.filename,
        "module": record.module_name,
        "enabled": record.enabled,
        "loaded": record.instance is not None,
        "error": record.error,
        "info": info,
    }


__all__ = [
    "PLUGINS_ROOT",
    "PluginRecord",
    "add_change_listener",
    "discover_plugins_in_dir",
    "install_main",
    "list_plugins",
    "load_plugin_file",
    "load_plugin_source",
    "reload_plugins",
    "unload_plugin",
]
