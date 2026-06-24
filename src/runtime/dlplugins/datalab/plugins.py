# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""
Portable copy of :mod:`datalab.plugins` for DataLab-Web.

This is a Qt-free re-implementation of the Qt plugin core. It keeps the
public surface (:class:`PluginInfo`, :class:`PluginBase`,
:class:`PluginRegistry`, :class:`FailedPluginInfo`,
:func:`discover_plugins`) bit-for-bit compatible with
``c:/Dev/DataLab/datalab/plugins.py`` so that an unmodified Qt plugin
that imports ``from datalab.plugins import PluginBase, PluginInfo`` and
that does not pull in :mod:`qtpy` itself loads as-is in the browser.

What changed from the Qt version:

* All ``qtpy`` imports were removed.
* ``PluginBase.show_warning`` / ``ask_yesno`` / ``edit_new_signal_parameters``
  / ``edit_new_image_parameters`` route to :mod:`datalab.helpers`, whose
  default implementation in turn forwards to the active guidata backend
  (see :mod:`guidata.dataset.backends`). When a synchronous flow is not
  available (browser), they raise a clear
  :class:`BrowserNotSupportedError` pointing the developer to the
  ``await`` variant.
* :func:`discover_plugins` is unused in the browser (Pyodide has no
  ``sys.path`` to scan); :func:`reload_plugin_modules` is provided so
  the hot-reload pipeline can reuse the same wording.
"""

from __future__ import annotations

import abc
import dataclasses
import importlib
import logging
import os
import os.path as osp
import sys
import traceback
from typing import TYPE_CHECKING

# Re-export Sigima I/O bases so plugins can subclass them without ever
# importing the desktop ``datalab`` package.
# pylint: disable=unused-import
from sigima.io.base import FormatInfo  # noqa: F401
from sigima.io.image.base import ImageFormatBase  # noqa: F401
from sigima.io.image.formats import ClassicsImageFormat  # noqa: F401
from sigima.io.signal.base import SignalFormatBase  # noqa: F401

from datalab.config import MOD_NAME, Conf, _
from datalab.control.proxy import LocalProxy
from datalab.env import execenv

if TYPE_CHECKING:
    from sigima.objects import NewImageParam, NewSignalParam

    from datalab.gui import main
    from datalab.gui.panel.image import ImagePanel
    from datalab.gui.panel.signal import SignalPanel


PLUGINS_DEFAULT_PATH = "/plugins"


# pylint: disable=bad-mcs-classmethod-argument
class PluginRegistry(type):
    """Metaclass for registering plugins (Qt-compatible API)."""

    _plugin_classes: list[type[PluginBase]] = []
    _plugin_instances: list[PluginBase] = []
    _discovery_errors: list[str] = []
    _failed_plugins: list[FailedPluginInfo] = []

    def __init__(cls, name, bases, attrs):
        super().__init__(name, bases, attrs)
        if name != "PluginBase":
            cls._plugin_classes.append(cls)

    @classmethod
    def get_plugin_classes(cls) -> list[type[PluginBase]]:
        """Return plugin classes."""
        return cls._plugin_classes

    @classmethod
    def get_plugins(cls) -> list[PluginBase]:
        """Return plugin instances."""
        return cls._plugin_instances

    @classmethod
    def get_plugin(cls, name_or_class: str | type[PluginBase]) -> PluginBase | None:
        """Return plugin instance by name or class."""
        for plugin in cls._plugin_instances:
            if name_or_class in (plugin.info.name, plugin.__class__):
                return plugin
        return None

    @classmethod
    def register_plugin(cls, plugin: PluginBase) -> None:
        """Register plugin instance."""
        if plugin.info.name in [p.info.name for p in cls._plugin_instances]:
            raise ValueError(f"Plugin {plugin.info.name} already registered")
        cls._plugin_instances.append(plugin)
        execenv.log(cls, f"Plugin {plugin.info.name} registered")

    @classmethod
    def unregister_plugin(cls, plugin: PluginBase) -> None:
        """Unregister plugin instance."""
        cls._plugin_instances.remove(plugin)
        execenv.log(cls, f"Plugin {plugin.info.name} unregistered")
        execenv.log(cls, f"{len(cls._plugin_instances)} plugins left")

    @classmethod
    def unregister_all_plugins(cls) -> None:
        """Unregister every plugin instance."""
        for plugin in list(cls._plugin_instances):
            execenv.log(cls, f"Unregistering plugin {plugin.info.name}")
            try:
                plugin.unregister()
            except Exception:  # pylint: disable=broad-except
                logging.getLogger(__name__).exception(
                    "Error while unregistering plugin %s", plugin.info.name
                )
        cls._plugin_instances.clear()
        execenv.log(cls, "All plugins unregistered")

    @classmethod
    def clear_plugin_classes(cls) -> None:
        """Clear registered plugin classes (used by hot-reload)."""
        cls._plugin_classes.clear()

    # -- Diagnostics ----------------------------------------------------

    @classmethod
    def add_discovery_error(cls, tb_text: str) -> None:
        """Record a discovery-time error traceback."""
        cls._discovery_errors.append(tb_text)

    @classmethod
    def get_discovery_errors(cls) -> list[str]:
        """Return tracebacks accumulated during discovery."""
        return list(cls._discovery_errors)

    @classmethod
    def clear_discovery_errors(cls) -> None:
        """Clear recorded discovery errors."""
        cls._discovery_errors.clear()

    @classmethod
    def add_failed_plugin(cls, name: str, filepath: str, tb_text: str) -> None:
        """Record information about a plugin that failed to load."""
        cls._failed_plugins.append(FailedPluginInfo(name, filepath, tb_text))

    @classmethod
    def get_failed_plugins(cls) -> list[FailedPluginInfo]:
        """Return :class:`FailedPluginInfo` for each failed plugin."""
        return list(cls._failed_plugins)

    @classmethod
    def clear_failed_plugins(cls) -> None:
        """Clear recorded failed plugins."""
        cls._failed_plugins.clear()

    @classmethod
    def get_plugin_info(cls, html: bool = True) -> str:
        """Return plugin information (names, versions, descriptions)."""
        linesep = "<br>" if html else os.linesep
        bullet = "• " if html else " " * 4

        def italic(text: str) -> str:
            return f"<i>{text}</i>" if html else text

        if Conf.main.plugins_enabled.get():
            plugins = cls.get_plugins()
            if plugins:
                text = italic(_("Registered plugins:")) + linesep
                for plugin in plugins:
                    text += f"{bullet}{plugin.info.name} ({plugin.info.version})"
                    if plugin.info.description:
                        text += f": {plugin.info.description}"
                    text += linesep
            else:
                text = italic(_("No plugins available"))
        else:
            text = italic(_("Plugins are disabled (see DataLab settings)"))
        return text


@dataclasses.dataclass
class FailedPluginInfo:
    """Information about a plugin that failed to load or instantiate."""

    name: str
    filepath: str
    traceback: str


@dataclasses.dataclass
class PluginInfo:
    """Plugin metadata."""

    name: str = None
    version: str = "0.0.0"
    description: str = ""
    icon: str = None


class PluginBaseMeta(PluginRegistry, abc.ABCMeta):
    """Mixed metaclass to avoid metaclass conflicts."""


class PluginBase(abc.ABC, metaclass=PluginBaseMeta):
    """Plugin base class (Qt-compatible API, browser implementation)."""

    PLUGIN_INFO: PluginInfo = None

    def __init__(self):
        self.main: main.DLMainWindow = None
        self.proxy: LocalProxy = None
        self._is_registered = False
        self.info = self.PLUGIN_INFO
        if self.info is None:
            raise ValueError(f"Plugin info not set for {self.__class__.__name__}")

    # -- Convenience accessors -----------------------------------------

    @property
    def signalpanel(self) -> SignalPanel:
        """Return the signal panel facade."""
        return self.main.signalpanel

    @property
    def imagepanel(self) -> ImagePanel:
        """Return the image panel facade."""
        return self.main.imagepanel

    # -- Dialog helpers (route through ``datalab.helpers``) ------------

    def show_warning(self, message: str) -> None:
        """Show a warning dialog."""
        from datalab import helpers

        return helpers.show_message("warning", message)

    def show_error(self, message: str) -> None:
        """Show an error dialog."""
        from datalab import helpers

        return helpers.show_message("error", message)

    def show_info(self, message: str) -> None:
        """Show an informational dialog."""
        from datalab import helpers

        return helpers.show_message("info", message)

    def ask_yesno(
        self,
        message: str,
        title: str | None = None,
        cancelable: bool = False,
    ) -> bool | None:
        """Ask a yes/no(/cancel) question."""
        from datalab import helpers

        return helpers.ask_question(message, title=title, cancelable=cancelable)

    # -- Async dialog helpers (preferred in the browser) ---------------
    #
    # Browser-only additions (no desktop counterpart): the synchronous
    # helpers above raise :class:`BrowserNotSupportedError` in Pyodide
    # because they cannot block the JavaScript event loop. Plugins that
    # run in DataLab-Web should ``await`` these variants instead.

    async def show_info_async(self, message: str) -> None:
        """Show an informational dialog (browser-safe)."""
        from datalab import helpers

        return await helpers.show_message_async("info", message)

    async def show_warning_async(self, message: str) -> None:
        """Show a warning dialog (browser-safe)."""
        from datalab import helpers

        return await helpers.show_message_async("warning", message)

    async def show_error_async(self, message: str) -> None:
        """Show an error dialog (browser-safe)."""
        from datalab import helpers

        return await helpers.show_message_async("error", message)

    async def ask_yesno_async(
        self,
        message: str,
        title: str | None = None,
        cancelable: bool = False,
    ) -> bool | None:
        """Ask a yes/no(/cancel) question (browser-safe)."""
        from datalab import helpers

        return await helpers.ask_question_async(
            message, title=title, cancelable=cancelable
        )

    def edit_new_signal_parameters(
        self,
        title: str | None = None,
        size: int | None = None,
    ) -> NewSignalParam | None:
        """Create and edit a new signal parameter dataset."""
        newparam = self.signalpanel.get_newparam_from_current(title=title)
        if size is not None:
            newparam.size = size
        if newparam.edit(self.main):
            return newparam
        return None

    def edit_new_image_parameters(
        self,
        title: str | None = None,
        shape: tuple[int, int] | None = None,
        hide_height: bool = False,
        hide_width: bool = False,
        hide_type: bool = True,
        hide_dtype: bool = False,
    ) -> NewImageParam | None:
        """Create and edit a new image parameter dataset."""
        newparam = self.imagepanel.get_newparam_from_current(title=title)
        if shape is not None:
            newparam.height, newparam.width = shape
        newparam.hide_height = hide_height
        newparam.hide_width = hide_width
        newparam.hide_type = hide_type
        newparam.hide_dtype = hide_dtype
        if newparam.edit(self.main):
            return newparam
        return None

    async def edit_new_signal_parameters_async(
        self,
        title: str | None = None,
        size: int | None = None,
    ) -> NewSignalParam | None:
        """Async variant of :meth:`edit_new_signal_parameters` (browser-safe)."""
        newparam = self.signalpanel.get_newparam_from_current(title=title)
        if size is not None:
            newparam.size = size
        if await newparam.edit_async(self.main):
            return newparam
        return None

    async def edit_new_image_parameters_async(
        self,
        title: str | None = None,
        shape: tuple[int, int] | None = None,
        hide_height: bool = False,
        hide_width: bool = False,
        hide_type: bool = True,
        hide_dtype: bool = False,
    ) -> NewImageParam | None:
        """Async variant of :meth:`edit_new_image_parameters` (browser-safe)."""
        newparam = self.imagepanel.get_newparam_from_current(title=title)
        if shape is not None:
            newparam.height, newparam.width = shape
        newparam.hide_height = hide_height
        newparam.hide_width = hide_width
        newparam.hide_type = hide_type
        newparam.hide_dtype = hide_dtype
        if await newparam.edit_async(self.main):
            return newparam
        return None

    # -- Lifecycle -----------------------------------------------------

    def is_registered(self) -> bool:
        """Return ``True`` if the plugin instance is registered."""
        return self._is_registered

    def register(self, main: main.DLMainWindow) -> None:
        """Register the plugin against the (browser) main window.

        Also calls :meth:`create_actions`, with the plugin name pushed
        onto :mod:`datalab.registries` so every contribution carries an
        ``origin`` field — required for hot reload.
        """
        if self._is_registered:
            return
        from datalab import registries

        PluginRegistry.register_plugin(self)
        self._is_registered = True
        self.main = main
        self.proxy = LocalProxy(main)
        self.register_hooks()

        registries.push_origin(self.info.name)
        try:
            self.create_actions()
        finally:
            registries.pop_origin()

    def unregister(self) -> None:
        """Unregister the plugin (and purge its contributions)."""
        if not self._is_registered:
            return
        from datalab import registries

        PluginRegistry.unregister_plugin(self)
        self._is_registered = False
        self.unregister_hooks()
        registries.clear_origin(self.info.name)
        self.main = None
        self.proxy = None

    def register_hooks(self) -> None:
        """Override to register additional hooks at plugin load time."""

    def unregister_hooks(self) -> None:
        """Override to release additional hooks at plugin unload time."""

    @abc.abstractmethod
    def create_actions(self) -> None:
        """Create plugin-defined menu actions and processings."""


# ---------------------------------------------------------------------------
# Discovery — used by the hot-reload path
# ---------------------------------------------------------------------------


def discover_plugins() -> list:
    """Discover plugins in :data:`PLUGINS_DEFAULT_PATH`.

    Mirrors the Qt API; in the browser, plugin sources are typically
    written into ``/plugins/`` by ``runtime.ts`` before this function is
    called. Modules are *imported* (or *re-imported* via
    :func:`importlib.reload`) so that :class:`PluginRegistry` collects
    every :class:`PluginBase` subclass.
    """
    PluginRegistry.clear_discovery_errors()
    PluginRegistry.clear_failed_plugins()

    if not Conf.main.plugins_enabled.get():
        return []

    if not osp.isdir(PLUGINS_DEFAULT_PATH):
        return []

    if PLUGINS_DEFAULT_PATH not in sys.path:
        sys.path.insert(0, PLUGINS_DEFAULT_PATH)

    modules: list = []
    for fname in sorted(os.listdir(PLUGINS_DEFAULT_PATH)):
        if not fname.endswith(".py") or fname.startswith("_"):
            continue
        modname = fname[:-3]
        try:
            if modname in sys.modules:
                mod = importlib.reload(sys.modules[modname])
            else:
                mod = importlib.import_module(modname)
            modules.append(mod)
        except Exception:  # pylint: disable=broad-except
            tb_text = traceback.format_exc()
            PluginRegistry.add_discovery_error(tb_text)
            PluginRegistry.add_failed_plugin(
                modname,
                osp.join(PLUGINS_DEFAULT_PATH, fname),
                tb_text,
            )
            execenv.log(
                discover_plugins,
                f"Failed to import plugin {modname!r}:\n{tb_text}",
            )
    return modules


def reload_plugin_modules() -> None:
    """Reload plugin modules (alias kept for Qt parity)."""
    for modname in list(sys.modules):
        if modname.startswith(f"{MOD_NAME}_") or modname.startswith("datalab_"):
            try:
                importlib.reload(sys.modules[modname])
            except Exception:  # pylint: disable=broad-except
                logging.getLogger(__name__).exception(
                    "Failed to reload plugin module %s", modname
                )
