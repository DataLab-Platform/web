# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

"""
DataLab-Web Test Data plugin
----------------------------

Browser-friendly port of DataLab desktop's ``datalab_testdata`` plugin.

Differences from the desktop version:

* All actions that prompt the user use ``await param.edit_async(self.main)``
  rather than the synchronous ``param.edit(self.main)`` (the latter cannot
  block the JavaScript event loop in Pyodide).
* File-based loaders (``read_test_objects``) are omitted because there is no
  local filesystem access; the synthetic factories already cover the demo
  needs.
"""

from __future__ import annotations

import sigima.tests.data as test_data
from datalab.config import _
from datalab.plugins import PluginBase, PluginInfo


class PluginTestData(PluginBase):
    """DataLab-Web Test Data Plugin"""

    PLUGIN_INFO = PluginInfo(
        name=_("Test data"),
        version="1.0.0",
        description=_("Browser-friendly test-data factories for DataLab-Web"),
    )

    # -- Signals -----------------------------------------------------------

    async def create_paracetamol_signal(self) -> None:
        """Create paracetamol spectrum signal."""
        obj = test_data.create_paracetamol_signal()
        self.proxy.add_object(obj)

    # -- Images ------------------------------------------------------------

    async def create_peak_image(self) -> None:
        """Create 2D peak image."""
        from sigima.objects import create_image_from_param

        newparam = self.imagepanel.get_newparam_from_current()
        obj = create_image_from_param(newparam)
        param = test_data.PeakDataParam.create(size=max(obj.data.shape))
        self.imagepanel.processor.update_param_defaults(param)
        if await param.edit_async(self.main):
            obj.data, _coords = test_data.get_peak2d_data(param)
            self.proxy.add_object(obj)

    async def create_sincos_image(self) -> None:
        """Create 2D sin·cos image."""
        newparam = await self.edit_new_image_parameters_async(hide_type=True)
        if newparam is not None:
            obj = test_data.create_sincos_image(newparam)
            self.proxy.add_object(obj)

    async def create_noisy_gaussian_image(self) -> None:
        """Create 2D noisy gaussian image."""
        newparam = await self.edit_new_image_parameters_async(
            hide_height=True, hide_type=True
        )
        if newparam is not None:
            obj = test_data.create_noisy_gaussian_image(newparam, add_annotations=False)
            self.proxy.add_object(obj)

    async def create_multigaussian_image(self) -> None:
        """Create 2D multi-gaussian image."""
        newparam = await self.edit_new_image_parameters_async(
            hide_height=True, hide_type=True
        )
        if newparam is not None:
            obj = test_data.create_multigaussian_image(newparam)
            self.proxy.add_object(obj)

    async def create_2dstep_image(self) -> None:
        """Create 2D step image."""
        newparam = await self.edit_new_image_parameters_async(hide_type=True)
        if newparam is not None:
            obj = test_data.create_2dstep_image(newparam)
            self.proxy.add_object(obj)

    async def create_ring_image(self) -> None:
        """Create 2D ring image."""
        param = test_data.RingParam(_("Ring"))
        if await param.edit_async(self.main):
            obj = test_data.create_ring_image(param)
            self.proxy.add_object(obj)

    async def create_annotated_image(self) -> None:
        """Create annotated image."""
        obj = test_data.create_annotated_image()
        self.proxy.add_object(obj)

    async def create_grid_gaussian_image(self) -> None:
        """Create image with a grid of gaussian spots."""
        param = test_data.GridOfGaussianImages(_("Grid of Gaussian Images"))
        if await param.edit_async(self.main):
            obj = test_data.create_grid_of_gaussian_images(param)
            self.proxy.add_object(obj)

    # -- Menu wiring -------------------------------------------------------

    def create_actions(self) -> None:
        """Register the plugin's menu entries."""
        sah = self.signalpanel.acthandler
        with sah.new_menu(_("Test data")):
            sah.new_action(
                _("Load spectrum of paracetamol"),
                triggered=self.create_paracetamol_signal,
                select_condition="always",
            )
        iah = self.imagepanel.acthandler
        with iah.new_menu(_("Test data")):
            iah.new_action(
                _("Create image with peaks"),
                triggered=self.create_peak_image,
                select_condition="always",
            )
            iah.new_action(
                _("Create 2D sin·cos image"),
                triggered=self.create_sincos_image,
                select_condition="always",
            )
            iah.new_action(
                _("Create 2D noisy gaussian image"),
                triggered=self.create_noisy_gaussian_image,
                select_condition="always",
            )
            iah.new_action(
                _("Create 2D multi-gaussian image"),
                triggered=self.create_multigaussian_image,
                select_condition="always",
            )
            iah.new_action(
                _("Create annotated image"),
                triggered=self.create_annotated_image,
                select_condition="always",
            )
            iah.new_action(
                _("Create 2D step image"),
                triggered=self.create_2dstep_image,
                select_condition="always",
            )
            iah.new_action(
                _("Create ring image"),
                triggered=self.create_ring_image,
                select_condition="always",
            )
            iah.new_action(
                _("Create image with a grid of gaussian spots"),
                triggered=self.create_grid_gaussian_image,
                select_condition="always",
            )
