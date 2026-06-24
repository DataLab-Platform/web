# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

"""
Dialog methods plugin example (DataLab-Web)
===========================================

Browser-friendly port of DataLab desktop's ``datalab_example_dialogs`` plugin.
It showcases the dialog helpers available to a plugin:

* ``await self.show_info_async(message)`` / ``show_warning_async`` /
  ``show_error_async`` — message popups;
* ``await self.ask_yesno_async(question, cancelable=...)`` — yes/no(/cancel);
* ``await self.edit_new_signal_parameters_async(...)`` /
  ``edit_new_image_parameters_async(...)`` — parameter dialogs.

Difference from the desktop version: every dialog is opened through the
``_async`` variant because synchronous dialogs cannot block the JavaScript
event loop in Pyodide.

Load it from *Plugins → Manage plugins…* (it appears under "Example plugins").
"""

from __future__ import annotations

import numpy as np
import sigima.objects
from datalab.config import _
from datalab.plugins import PluginBase, PluginInfo


class DialogMethodsExample(PluginBase):
    """DataLab-Web Dialog Methods Example Plugin"""

    PLUGIN_INFO = PluginInfo(
        name=_("Dialog Methods (example)"),
        version="1.0.0",
        description=_("Example plugin demonstrating dialog methods"),
    )

    async def demo_show_info(self) -> None:
        """Demonstrate show_info_async()."""
        await self.show_info_async(_("This is an information message."))

    async def demo_show_warning(self) -> None:
        """Demonstrate show_warning_async()."""
        await self.show_warning_async(_("This is a warning message!"))

    async def demo_show_error(self) -> None:
        """Demonstrate show_error_async()."""
        await self.show_error_async(_("This is an error message!"))

    async def demo_ask_yesno(self) -> None:
        """Demonstrate ask_yesno_async()."""
        result = await self.ask_yesno_async(
            _("Do you want to proceed?"), title=_("Confirmation"), cancelable=True
        )
        if result is True:
            await self.show_info_async(_("You clicked Yes"))
        elif result is False:
            await self.show_info_async(_("You clicked No"))
        else:  # ``None`` means Cancel
            await self.show_info_async(_("You clicked Cancel"))

    async def demo_create_signal_with_dialog(self) -> None:
        """Demonstrate edit_new_signal_parameters_async()."""
        newparam = await self.edit_new_signal_parameters_async(
            title=_("My New Signal"), size=1000
        )
        if newparam is not None:
            x = np.linspace(0, 10, newparam.size)
            y = np.sin(x)
            obj = sigima.objects.create_signal(newparam.title, x, y)
            self.proxy.add_object(obj)
            await self.show_info_async(_("Created signal: %s") % newparam.title)

    async def demo_create_image_with_dialog(self) -> None:
        """Demonstrate edit_new_image_parameters_async()."""
        newparam = await self.edit_new_image_parameters_async(
            title=_("My New Image"), shape=(512, 512), hide_type=True
        )
        if newparam is not None:
            data = np.random.random((newparam.height, newparam.width))
            obj = sigima.objects.create_image(newparam.title, data)
            self.proxy.add_object(obj)
            await self.show_info_async(_("Created image: %s") % newparam.title)

    def create_actions(self) -> None:
        """Create actions demonstrating dialog methods."""
        sah = self.signalpanel.acthandler
        with sah.new_menu(self.PLUGIN_INFO.name):
            with sah.new_menu(_("Message Dialogs")):
                sah.new_action(
                    _("Show Info"),
                    triggered=self.demo_show_info,
                    select_condition="always",
                )
                sah.new_action(
                    _("Show Warning"),
                    triggered=self.demo_show_warning,
                    select_condition="always",
                )
                sah.new_action(
                    _("Show Error"),
                    triggered=self.demo_show_error,
                    select_condition="always",
                )
            with sah.new_menu(_("Question Dialogs")):
                sah.new_action(
                    _("Ask Yes/No"),
                    triggered=self.demo_ask_yesno,
                    select_condition="always",
                )
            with sah.new_menu(_("Parameter Dialogs")):
                sah.new_action(
                    _("Create Signal with Dialog"),
                    triggered=self.demo_create_signal_with_dialog,
                    select_condition="always",
                )

        iah = self.imagepanel.acthandler
        with iah.new_menu(self.PLUGIN_INFO.name):
            with iah.new_menu(_("Message Dialogs")):
                iah.new_action(
                    _("Show Info"),
                    triggered=self.demo_show_info,
                    select_condition="always",
                )
                iah.new_action(
                    _("Show Warning"),
                    triggered=self.demo_show_warning,
                    select_condition="always",
                )
                iah.new_action(
                    _("Show Error"),
                    triggered=self.demo_show_error,
                    select_condition="always",
                )
            with iah.new_menu(_("Parameter Dialogs")):
                iah.new_action(
                    _("Create Image with Dialog"),
                    triggered=self.demo_create_image_with_dialog,
                    select_condition="always",
                )
