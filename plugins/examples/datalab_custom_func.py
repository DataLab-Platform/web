# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

"""
Custom denoising filter plugin (DataLab-Web)
============================================

Browser-friendly port of DataLab desktop's ``datalab_custom_func`` plugin.
It adds a custom image processing ("Weighted average denoise") to the image
panel.

The filter is registered in ``register_computations`` and placed in the
plugin's submenu with ``acthandler.action_for(...)``, as in DataLab Desktop.

Load it from *Plugins → Manage plugins…* (it appears under "Example plugins").
"""

from __future__ import annotations

import numpy as np
import scipy.ndimage as spi
import sigima.proc.image as sipi
from datalab.config import _
from datalab.plugins import PluginBase, PluginCapability, PluginInfo


def weighted_average_denoise(data: np.ndarray) -> np.ndarray:
    """Apply a custom denoising filter to an image.

    This filter averages the pixels in a 5x5 neighborhood, but gives less
    weight to pixels that significantly differ from the central pixel.
    """

    def filter_func(values: np.ndarray) -> float:
        """Weighted-average kernel."""
        central_pixel = values[len(values) // 2]
        differences = np.abs(values - central_pixel)
        weights = np.exp(-differences / np.mean(differences))
        return np.average(values, weights=weights)

    return spi.generic_filter(data, filter_func, size=5)


class CustomFilters(PluginBase):
    """DataLab-Web Custom Filters Plugin"""

    FEATURE_ID = "org.datalab.examples.custom-filters:weighted-average-denoise"
    PLUGIN_INFO = PluginInfo(
        id="org.datalab.examples.custom-filters",
        name=_("My custom filters"),
        version="1.0.0",
        description=_("This is an example plugin"),
        capabilities=(PluginCapability.PROCESSING,),
    )

    def register_computations(self) -> None:
        """Register the custom image processing."""
        self.imagepanel.processor.register_1_to_1(
            sipi.Wrap1to1Func(weighted_average_denoise),
            _("Weighted average denoise"),
            feature_id=self.FEATURE_ID,
            owner_plugin_id=self.plugin_id,
        )

    def create_actions(self) -> None:
        """Add the registered processing to the plugin's submenu."""
        handler = self.imagepanel.acthandler
        with handler.new_menu(self.PLUGIN_INFO.name.replace("&", "&&")):
            handler.action_for(self.FEATURE_ID)
