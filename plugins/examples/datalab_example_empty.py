# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

"""
Empty plugin example (DataLab-Web)
==================================

Browser-friendly port of DataLab desktop's ``datalab_example_empty`` plugin.

It adds an "Empty plugin (example)" entry under the "Plugins" menu, with one
action ("Do nothing") and a couple of nested submenus.

Difference from the desktop version: message dialogs cannot block the
JavaScript event loop in Pyodide, so the action callbacks are ``async`` and
use ``await self.show_info_async(...)`` instead of the synchronous
``self.show_info(...)``.

Load it from *Plugins → Manage plugins…* (it appears under "Example plugins").
"""

from __future__ import annotations

from datalab.config import _
from datalab.plugins import PluginBase, PluginInfo


class EmptyPlugin(PluginBase):
    """DataLab-Web Example Plugin"""

    PLUGIN_INFO = PluginInfo(
        name=_("Empty plugin (example)"),
        version="1.0.0",
        description=_("This is an empty example plugin"),
    )

    async def do_nothing(self) -> None:
        """Do nothing."""
        await self.show_info_async(_("Do nothing"))

    async def do_something_simple(self) -> None:
        """Do something simple in submenu."""
        await self.show_info_async(_("Simple action in submenu"))

    async def do_something_advanced(self) -> None:
        """Do something advanced in nested submenu."""
        await self.show_info_async(_("Advanced action in nested submenu"))

    def create_actions(self) -> None:
        """Register the plugin's menu entries.

        Use the action handler (``acthandler``) ``new_menu`` / ``new_action``
        context managers to build (possibly nested) menus.
        """
        acth = self.imagepanel.acthandler
        with acth.new_menu(self.PLUGIN_INFO.name):
            # ``select_condition="always"`` keeps the action enabled even when
            # no object is selected (the default requires at least one).
            acth.new_action(
                _("Do nothing"),
                triggered=self.do_nothing,
                select_condition="always",
            )
            with acth.new_menu(_("Submenu Example")):
                acth.new_action(
                    _("Simple action"),
                    triggered=self.do_something_simple,
                    select_condition="always",
                )
                with acth.new_menu(_("Advanced Submenu")):
                    acth.new_action(
                        _("Advanced action"),
                        triggered=self.do_something_advanced,
                        select_condition="always",
                    )
