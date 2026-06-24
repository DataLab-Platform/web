# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

"""
Nested menus plugin example (DataLab-Web)
=========================================

Browser-friendly port of DataLab desktop's ``datalab_example_nested_menus``
plugin. It demonstrates how to build deep submenu hierarchies for both the
signal and image panels.

Difference from the desktop version: action callbacks are ``async`` and use
``await self.show_info_async(...)`` (synchronous dialogs cannot block the
JavaScript event loop in Pyodide).

Load it from *Plugins → Manage plugins…* (it appears under "Example plugins").
"""

from __future__ import annotations

from datalab.config import _
from datalab.plugins import PluginBase, PluginInfo


class NestedMenusExample(PluginBase):
    """DataLab-Web Nested Menus Example Plugin"""

    PLUGIN_INFO = PluginInfo(
        name=_("Nested Menus (example)"),
        version="1.0.0",
        description=_("Example plugin demonstrating nested menu structures"),
    )

    async def action_basic(self) -> None:
        """Basic action at root level."""
        await self.show_info_async(_("Basic action at root level"))

    async def action_submenu_1(self) -> None:
        """Action in first submenu."""
        await self.show_info_async(_("Action in Submenu 1"))

    async def action_submenu_2(self) -> None:
        """Action in second submenu."""
        await self.show_info_async(_("Action in Submenu 2"))

    async def action_nested_level_2(self) -> None:
        """Action in nested submenu (level 2)."""
        await self.show_info_async(_("Action in nested submenu (Level 2)"))

    async def action_nested_level_3(self) -> None:
        """Action in deeply nested submenu (level 3)."""
        await self.show_info_async(_("Action in deeply nested submenu (Level 3)"))

    def create_actions(self) -> None:
        """Create actions with various nested menu structures."""
        # Signal panel: up to three nested levels.
        sah = self.signalpanel.acthandler
        with sah.new_menu(self.PLUGIN_INFO.name):
            sah.new_action(
                _("Basic action"),
                triggered=self.action_basic,
                select_condition="always",
            )
            with sah.new_menu(_("Submenu 1")):
                sah.new_action(
                    _("Action in Submenu 1"),
                    triggered=self.action_submenu_1,
                    select_condition="always",
                )
            with sah.new_menu(_("Submenu 2 (with nesting)")):
                sah.new_action(
                    _("Action in Submenu 2"),
                    triggered=self.action_submenu_2,
                    select_condition="always",
                )
                with sah.new_menu(_("Nested Level 2")):
                    sah.new_action(
                        _("Action at Level 2"),
                        triggered=self.action_nested_level_2,
                        select_condition="always",
                    )
                    with sah.new_menu(_("Deeply Nested Level 3")):
                        sah.new_action(
                            _("Action at Level 3"),
                            triggered=self.action_nested_level_3,
                            select_condition="always",
                        )

        # Image panel: a similar (shallower) structure.
        iah = self.imagepanel.acthandler
        with iah.new_menu(self.PLUGIN_INFO.name):
            iah.new_action(
                _("Basic action (Image)"),
                triggered=self.action_basic,
                select_condition="always",
            )
            with iah.new_menu(_("Image Processing")):
                iah.new_action(
                    _("Process image"),
                    triggered=self.action_submenu_1,
                    select_condition="always",
                )
                with iah.new_menu(_("Advanced Processing")):
                    iah.new_action(
                        _("Advanced process"),
                        triggered=self.action_nested_level_2,
                        select_condition="always",
                    )
