# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""
Portable copy of the :mod:`datalab.plugins` package for DataLab-Web.

Like DataLab Desktop, the plugin host lives in :mod:`datalab.plugins.base` and its
public names are re-exported here, while the plugin contracts (recipes, tools,
examples...) are submodules of this package.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datalab.plugins.base import (
        PLUGINS_DEFAULT_PATH,
        ClassicsImageFormat,
        FailedPluginInfo,
        FormatInfo,
        ImageFormatBase,
        PluginBase,
        PluginBaseMeta,
        PluginCapability,
        PluginInfo,
        PluginRegistry,
        SignalFormatBase,
        discover_plugins,
        format_tool_requirement,
        reload_plugin_modules,
    )

__all__ = [
    "PLUGINS_DEFAULT_PATH",
    "ClassicsImageFormat",
    "FailedPluginInfo",
    "FormatInfo",
    "ImageFormatBase",
    "PluginBase",
    "PluginBaseMeta",
    "PluginCapability",
    "PluginInfo",
    "PluginRegistry",
    "SignalFormatBase",
    "discover_plugins",
    "format_tool_requirement",
    "reload_plugin_modules",
]


# Importing the plugin host lazily keeps contract submodules lightweight
def __getattr__(name: str) -> object:
    """Return a public name of the plugin host, importing it on first access."""
    if name in __all__:
        # pylint: disable=import-outside-toplevel
        from datalab.plugins import base

        return getattr(base, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__() -> list[str]:
    """Return module attributes, including lazily imported public names."""
    return sorted({*globals(), *__all__})
