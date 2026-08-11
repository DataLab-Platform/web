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
import importlib.metadata
import importlib.util
import os
import sys
import traceback
import uuid
import zipimport
from dataclasses import dataclass, field
from typing import Any, Callable

# ``datalab`` is the user-shipped portable shim package mounted under
# ``/home/pyodide/datalab`` at runtime; it is intentionally not on the
# CPython import path. The ``global _MAIN`` statement is the registry
# pattern that lets ``install_main`` swap the live bridge after HMR.
# pylint: disable=import-error,global-statement,broad-exception-caught
from datalab import registries  # noqa: F401  # used elsewhere in module
from datalab.plugins import PluginBase, PluginRegistry  # noqa: F401
from dlw_wheels import inspect_wheel

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
    source: str = "user-source"
    artifact_id: str | None = None
    artifact_filename: str | None = None
    plugin_id: str | None = None
    distribution: str | None = None
    version: str | None = None
    sha256: str | None = None
    trust: str = "unverified"
    entry_point: str | None = None
    top_level_packages: tuple[str, ...] = ()
    managed_modules: tuple[str, ...] = ()


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


def _host_distributions() -> dict[str, str]:
    """Return installed distribution versions plus the portable host API."""
    available: dict[str, str] = {}
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata.get("Name")
        if name:
            available[name] = distribution.version
    from datalab import __version__ as datalab_version

    available["datalab-platform"] = datalab_version
    return available


def _record_key_for_filename(path: str) -> str | None:
    normalized = os.path.abspath(path)
    for key, record in _RECORDS.items():
        if os.path.abspath(record.filename) == normalized:
            return key
    return None


def _plugin_id_in_use(plugin_id: str) -> bool:
    return any(
        record.plugin_id == plugin_id and record.instance is not None
        for record in _RECORDS.values()
    )


def _activate_plugin_class(record: PluginRecord, plugin_cls: type[PluginBase]) -> None:
    """Validate and instantiate one exact plugin class into *record*."""
    if not isinstance(plugin_cls, type) or not issubclass(plugin_cls, PluginBase):
        raise TypeError("Web plugin entry point must target a PluginBase subclass")
    plugin_id = plugin_cls.get_plugin_id()
    existing = _RECORDS.get(plugin_id)
    if _plugin_id_in_use(plugin_id) and existing is not record:
        raise ValueError(f"Plugin ID {plugin_id!r} already registered")
    plugin_cls.get_recipes()
    plugin_cls.get_examples()
    instance = plugin_cls()
    try:
        if _MAIN is not None:
            instance.register(_MAIN)
    except Exception:
        if instance.is_registered():
            instance.unregister()
        raise
    record.name = plugin_id
    record.plugin_id = plugin_id
    record.instance = instance
    record.classes = [plugin_cls]
    record.enabled = True
    record.error = None
    _RECORDS[plugin_id] = record


def _resolve_entry_point(module_name: str, attribute: str) -> type[PluginBase]:
    module = importlib.import_module(module_name)
    target: Any = module
    for part in attribute.split("."):
        target = getattr(target, part)
    return target


def _module_belongs_to_path(module: Any, path: str) -> bool:
    filename = getattr(module, "__file__", None)
    return isinstance(filename, str) and filename.replace("\\", "/").startswith(
        path.replace("\\", "/") + "/"
    )


def _wheel_failure_record(
    *,
    path: str,
    filename: str,
    source: str,
    sha256: str,
    trust: str,
    artifact_id: str,
    error: str,
    manifest: dict[str, Any] | None = None,
) -> PluginRecord:
    """Store one technical record for a rejected or failed wheel artifact."""
    record = PluginRecord(
        name=artifact_id,
        module_name="",
        filename=path,
        enabled=False,
        error=error,
        source=source,
        artifact_id=artifact_id,
        artifact_filename=filename,
        distribution=None if manifest is None else manifest["distribution"],
        version=None if manifest is None else manifest["version"],
        sha256=sha256,
        trust=trust,
        top_level_packages=(
            () if manifest is None else tuple(manifest["top_level_packages"])
        ),
    )
    _RECORDS[artifact_id] = record
    return record


def load_plugin_source(filename: str, source: str) -> dict[str, Any]:
    """Write *source* to ``PLUGINS_ROOT/filename`` and load (or reload) it.

    Returns a JSON-friendly dict describing the load result.
    """
    _ensure_root()
    path = os.path.join(PLUGINS_ROOT, os.path.basename(filename))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(source)
    return load_plugin_file(path, source="user-source")


def load_plugin_file(path: str, source: str = "user-source") -> dict[str, Any]:
    """Import (or reimport) the plugin file at *path* and register it."""
    _ensure_root()
    name = _module_name_for(path)

    # If a record exists for this filename, unload it first so registries
    # are clean before the re-import. We key records by *module name*.
    existing_key = _record_key_for_filename(path)
    if existing_key is not None:
        unload_plugin(existing_key)

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
            source=source,
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
            source=source,
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
        source=source,
    )
    try:
        _activate_plugin_class(record, plugin_cls)
    except Exception:  # pylint: disable=broad-except
        record.error = traceback.format_exc()
        record.enabled = False
        record.instance = None
        _RECORDS[name] = record
    _on_change()
    return _record_payload(record)


def load_plugin_wheel(
    path: str,
    *,
    filename: str,
    source: str,
    sha256: str,
    trust: str,
    available_distributions: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Inspect *path*, then import only its ``datalab.web_plugins`` targets."""
    artifact_id = f"sha256:{sha256}"
    try:
        manifest = inspect_wheel(
            path,
            filename=filename,
            available_distributions=(
                _host_distributions()
                if available_distributions is None
                else available_distributions
            ),
        )
        if manifest["sha256"] != sha256:
            raise ValueError(
                f"Plugin wheel SHA-256 mismatch: expected {sha256}, "
                f"got {manifest['sha256']}"
            )
        packages = set(manifest["top_level_packages"])
        for existing in _RECORDS.values():
            if existing.artifact_id == artifact_id:
                raise ValueError(f"Plugin wheel {artifact_id!r} is already loaded")
            if existing.distribution == manifest["distribution"]:
                raise ValueError(
                    f"Plugin distribution {manifest['distribution']!r} is already managed"
                )
            collision = packages.intersection(existing.top_level_packages)
            if collision:
                raise ValueError(
                    "Plugin wheel package collision: " + ", ".join(sorted(collision))
                )
    except Exception:  # pylint: disable=broad-except
        record = _wheel_failure_record(
            path=path,
            filename=filename,
            source=source,
            sha256=sha256,
            trust=trust,
            artifact_id=artifact_id,
            error=traceback.format_exc(),
            manifest=locals().get("manifest"),
        )
        _on_change()
        return [_record_payload(record)]

    if path not in sys.path:
        sys.path.append(path)
    importlib.invalidate_caches()
    records: list[PluginRecord] = []
    imported_before = set(sys.modules)
    try:
        for entry_point in manifest["entry_points"]:
            plugin_cls = _resolve_entry_point(
                entry_point["module"], entry_point["attribute"]
            )
            record = PluginRecord(
                name=entry_point["name"],
                module_name=entry_point["module"],
                filename=path,
                source=source,
                artifact_id=artifact_id,
                artifact_filename=filename,
                distribution=manifest["distribution"],
                version=manifest["version"],
                sha256=sha256,
                trust=trust,
                entry_point=(f"{entry_point['module']}:{entry_point['attribute']}"),
                top_level_packages=tuple(manifest["top_level_packages"]),
            )
            _activate_plugin_class(record, plugin_cls)
            records.append(record)
    except Exception:  # pylint: disable=broad-except
        error = traceback.format_exc()
        for record in records:
            unload_plugin(record.name, force=True)
        for module_name in set(sys.modules) - imported_before:
            module = sys.modules.get(module_name)
            if module is not None and _module_belongs_to_path(module, path):
                sys.modules.pop(module_name, None)
        if path in sys.path:
            sys.path.remove(path)
        zipimport._zip_directory_cache.pop(path, None)  # noqa: SLF001
        importlib.invalidate_caches()
        failed = _wheel_failure_record(
            path=path,
            filename=filename,
            source=source,
            sha256=sha256,
            trust=trust,
            artifact_id=artifact_id,
            error=error,
            manifest=manifest,
        )
        _on_change()
        return [_record_payload(failed)]

    managed_modules = tuple(
        sorted(
            module_name
            for module_name, module in sys.modules.items()
            if _module_belongs_to_path(module, path)
        )
    )
    for record in records:
        record.managed_modules = managed_modules
    _on_change()
    return [_record_payload(record) for record in records]


def inspect_plugin_wheel(path: str, filename: str) -> dict[str, Any]:
    """Inspect one candidate with the live host inventory and no import."""
    return inspect_wheel(
        path,
        filename=filename,
        available_distributions=_host_distributions(),
    )


def unload_plugin(name: str, *, force: bool = False) -> dict[str, Any]:
    """Unregister and forget the plugin *name*."""
    protected = _RECORDS.get(name)
    if not force and protected is not None and protected.source == "bundled-wheel":
        set_plugin_enabled(name, False)
        return {"name": name, "removed": False}
    record = _RECORDS.pop(name, None)
    if record is None:
        matching_key = next(
            (key for key, item in _RECORDS.items() if item.name == name), None
        )
        record = None if matching_key is None else _RECORDS.pop(matching_key)
    if record is None:
        return {"name": name, "removed": False}
    if record.instance is not None:
        try:
            record.instance.unregister()
        except Exception:  # pylint: disable=broad-except
            traceback.print_exc()
    # Drop any leftover catalogue contributions registered under this
    # plugin's stable ID (covers plugins that didn't fully register).
    if record.instance is not None:
        registries.clear_origin(record.instance.plugin_id)
    for plugin_cls in record.classes:
        if plugin_cls in PluginRegistry.get_plugin_classes():
            PluginRegistry.get_plugin_classes().remove(plugin_cls)
    # Remove the module from sys.modules so a subsequent load re-imports
    # fresh source.
    sys.modules.pop(record.module_name, None)
    if record.artifact_id is not None and not any(
        item.artifact_id == record.artifact_id for item in _RECORDS.values()
    ):
        for module_name in record.managed_modules:
            sys.modules.pop(module_name, None)
        if record.filename in sys.path:
            sys.path.remove(record.filename)
        zipimport._zip_directory_cache.pop(record.filename, None)  # noqa: SLF001
        importlib.invalidate_caches()
    _on_change()
    return {"name": name, "removed": True}


def set_plugin_enabled(name: str, enabled: bool) -> dict[str, Any]:
    """Enable or disable one record without removing its artifact metadata."""
    if not isinstance(enabled, bool):
        raise TypeError("Plugin enabled state must be a bool")
    record = _RECORDS.get(name)
    if record is None:
        record = next(
            (item for item in _RECORDS.values() if item.plugin_id == name), None
        )
    if record is None:
        raise KeyError(f"Unknown plugin: {name}")
    if enabled == record.enabled and (not enabled or record.instance is not None):
        return _record_payload(record)
    if not enabled:
        if record.instance is not None:
            try:
                record.instance.unregister()
            finally:
                registries.clear_origin(record.instance.plugin_id)
        record.instance = None
        record.enabled = False
        record.error = None
    else:
        if not record.classes:
            raise RuntimeError(f"Plugin {name!r} cannot be enabled without a class")
        try:
            _activate_plugin_class(record, record.classes[0])
        except Exception:  # pylint: disable=broad-except
            record.instance = None
            record.enabled = False
            record.error = traceback.format_exc()
    _on_change()
    return _record_payload(record)


def discover_plugins_in_dir(
    directory: str, source: str = "user-source"
) -> list[dict[str, Any]]:
    """Load every ``*.py`` file in *directory* (non-recursive)."""
    if not os.path.isdir(directory):
        return []
    out: list[dict[str, Any]] = []
    for entry in sorted(os.listdir(directory)):
        if not entry.endswith(".py") or entry.startswith("_"):
            continue
        path = os.path.join(directory, entry)
        out.append(load_plugin_file(path, source=source))
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
    source_specs = [
        (rec.name, rec.filename, rec.source, rec.enabled)
        for rec in _RECORDS.values()
        if rec.artifact_id is None
    ]
    wheel_specs: dict[str, dict[str, Any]] = {}
    for rec in _RECORDS.values():
        if rec.artifact_id is None or rec.sha256 is None:
            continue
        spec = wheel_specs.setdefault(
            rec.artifact_id,
            {
                "path": rec.filename,
                "filename": (rec.artifact_filename or os.path.basename(rec.filename)),
                "source": rec.source,
                "sha256": rec.sha256,
                "trust": rec.trust,
                "enabled": {},
            },
        )
        if rec.plugin_id is not None:
            spec["enabled"][rec.plugin_id] = rec.enabled
    # Step 1+2+3 — force removal is internal; public unload protects bundles.
    for name in list(_RECORDS):
        unload_plugin(name, force=True)
    # Step 4+5
    out: list[dict[str, Any]] = []
    for _, path, source, enabled in source_specs:
        payload = load_plugin_file(path, source=source)
        if payload["loaded"] and not enabled:
            payload = set_plugin_enabled(payload["record_id"], False)
        out.append(payload)
    for spec in wheel_specs.values():
        payloads = load_plugin_wheel(
            spec["path"],
            filename=spec["filename"],
            source=spec["source"],
            sha256=spec["sha256"],
            trust=spec["trust"],
        )
        for payload in payloads:
            if payload["loaded"] and not spec["enabled"].get(
                payload["plugin_id"], True
            ):
                payload = set_plugin_enabled(payload["record_id"], False)
            out.append(payload)
    return out


# ---------------------------------------------------------------------------
# Introspection
# ---------------------------------------------------------------------------


def list_plugins() -> list[dict[str, Any]]:
    """Return a JSON-friendly snapshot of every registered plugin."""
    return [_record_payload(rec) for rec in _RECORDS.values()]


def get_plugin_class(
    plugin_id: str, *, require_enabled: bool = True
) -> type[PluginBase]:
    """Return the managed class for *plugin_id*.

    Args:
        plugin_id: Stable plugin identifier.
        require_enabled: Reject disabled or failed plugin records when True.

    Raises:
        KeyError: If no managed plugin has this identifier.
        RuntimeError: If the plugin is not active or has no loaded class.
    """
    record = _RECORDS.get(plugin_id)
    if record is None or record.plugin_id != plugin_id:
        raise KeyError(f"Unknown plugin {plugin_id!r}")
    if require_enabled and (not record.enabled or record.instance is None):
        raise RuntimeError(f"Plugin {plugin_id!r} is disabled")
    if not record.classes:
        raise RuntimeError(f"Plugin {plugin_id!r} has no loaded class")
    return record.classes[0]


def _record_payload(record: PluginRecord) -> dict[str, Any]:
    info = None
    if record.instance is not None and record.instance.info is not None:
        pinfo = record.instance.info
        info = {
            "id": record.instance.plugin_id,
            "name": pinfo.name,
            "version": pinfo.version,
            "description": pinfo.description,
            "icon": pinfo.icon,
            "capabilities": sorted(item.value for item in pinfo.capabilities),
            "documentation_url": pinfo.documentation_url,
        }
    elif record.classes:
        cls_info = getattr(record.classes[0], "PLUGIN_INFO", None)
        if cls_info is not None:
            info = {
                "id": record.classes[0].get_plugin_id(),
                "name": cls_info.name,
                "version": cls_info.version,
                "description": cls_info.description,
                "icon": cls_info.icon,
                "capabilities": sorted(item.value for item in cls_info.capabilities),
                "documentation_url": cls_info.documentation_url,
            }
    plugin_cls = None
    if record.instance is not None:
        plugin_cls = record.instance.__class__
    elif record.classes:
        plugin_cls = record.classes[0]
    recipes = []
    examples = []
    if plugin_cls is not None:
        recipes = [
            {
                "id": recipe.recipe_id,
                "version": recipe.version,
                "title": recipe.title,
                "description": recipe.description,
                "inputs": [
                    {
                        "id": slot.id,
                        "object_type": slot.object_type.value,
                        "cardinality": slot.cardinality.value,
                        "required": slot.required,
                    }
                    for slot in recipe.inputs
                ],
                "has_params": recipe.parameter_class is not None,
            }
            for recipe in plugin_cls.get_recipes()
        ]
        examples = [
            {
                "id": example.id,
                "title": example.title,
                "description": example.description,
                "recipe_id": example.recipe_id,
                "expected_checks": list(example.expected_checks),
            }
            for example in plugin_cls.get_examples()
        ]
    return {
        "name": record.name,
        "record_id": record.name,
        "filename": record.filename,
        "module": record.module_name,
        "source": record.source,
        "artifact_id": record.artifact_id,
        "artifact_filename": record.artifact_filename,
        "plugin_id": record.plugin_id,
        "distribution": record.distribution,
        "version": record.version,
        "sha256": record.sha256,
        "trust": record.trust,
        "entry_point": record.entry_point,
        "enabled": record.enabled,
        "loaded": record.instance is not None,
        "error": record.error,
        "info": info,
        "recipes": recipes,
        "examples": examples,
        "operations": {
            "can_enable": bool(record.classes),
            "can_disable": record.instance is not None,
            "can_remove": record.source in ("user-wheel", "user-source"),
            "can_reload": True,
        },
    }


__all__ = [
    "PLUGINS_ROOT",
    "PluginRecord",
    "add_change_listener",
    "discover_plugins_in_dir",
    "get_plugin_class",
    "inspect_plugin_wheel",
    "install_main",
    "list_plugins",
    "load_plugin_file",
    "load_plugin_source",
    "load_plugin_wheel",
    "reload_plugins",
    "set_plugin_enabled",
    "unload_plugin",
]
