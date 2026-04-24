# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Minimal :mod:`datalab.config` shim used by DataLab-Web plugins.

Only the symbols actually imported by the desktop ``datalab.plugins``
module (and by the bundled stock plugins) are exposed: a translation
passthrough ``_()`` and a tiny ``Conf`` namespace whose ``main`` section
mimics the methods used during plugin discovery and the plugin
configuration dialog.
"""

from __future__ import annotations

from typing import Any


MOD_NAME = "datalab"


def _(text: str) -> str:
    """Translation passthrough (no i18n in v1)."""
    return text


class _ConfigOption:
    """Minimal stand-in for guidata ``Option`` instances.

    Backed by a module-level dict so callers can override plugin-related
    settings (e.g. mark all plugins as enabled by default).
    """

    def __init__(self, key: str, default: Any) -> None:
        self.key = key
        self.default = default

    def get(self, default: Any | None = None) -> Any:
        if self.key in _STORE:
            return _STORE[self.key]
        return self.default if default is None else default

    def set(self, value: Any) -> None:
        _STORE[self.key] = value


_STORE: dict[str, Any] = {}


class _MainSection:
    """Mirrors the subset of ``Conf.main`` plugins read at runtime."""

    plugins_enabled = _ConfigOption("plugins_enabled", True)
    plugins_enabled_list = _ConfigOption("plugins_enabled_list", None)
    plugins_path = _ConfigOption("plugins_path", "/plugins")
    traceback_log_available = _ConfigOption("traceback_log_available", False)


class Conf:
    """Tiny config facade (only the bits used by the plugin system)."""

    main = _MainSection()

    @staticmethod
    def get_path(_name: str) -> str:
        return "/plugins"


# Empty by design: the desktop config wiring (DATALAB_PLUGINS env var,
# extra plugin paths) doesn't apply in the browser.
DATALAB_PLUGINS_ENV_VAR = "DATALAB_PLUGINS"
DATALAB_PLUGINS_ENV_PATHS: list[str] = []
OTHER_PLUGINS_PATHLIST: list[str] = []

# Colours used by the plugin configuration dialog (kept Qt-independent
# so the React port can pick them up if it wants to).
PLUGIN_OK_COLOR = "#2e7d32"
PLUGIN_ERROR_COLOR = "#c62828"


__all__ = [
    "_",
    "Conf",
    "MOD_NAME",
    "DATALAB_PLUGINS_ENV_VAR",
    "DATALAB_PLUGINS_ENV_PATHS",
    "OTHER_PLUGINS_PATHLIST",
    "PLUGIN_OK_COLOR",
    "PLUGIN_ERROR_COLOR",
]
