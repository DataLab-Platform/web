# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

"""
Custom denoising filter plugin (DataLab-Web)
============================================

Browser-friendly port of DataLab desktop's ``datalab_custom_func`` plugin.
It adds a custom image processing ("Weighted average denoise") to the image
panel.

Difference from the desktop version: instead of calling the synchronous
``processor.compute_1_to_1(...)`` from an action callback (unavailable in the
browser), the filter is registered once via ``processor.register_1_to_1(...)``
in ``create_actions``. The host then surfaces it as a regular menu entry and
runs it through the same asynchronous dispatch as the built-in processings.

Load it from *Plugins → Manage plugins…* (it appears under "Example plugins").
"""

from __future__ import annotations

import numpy as np
import scipy.ndimage as spi
import sigima.proc.image as sipi
from datalab.config import _
from datalab.plugins import PluginBase, PluginInfo


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

    PLUGIN_INFO = PluginInfo(
        name=_("My custom filters"),
        version="1.0.0",
        description=_("This is an example plugin"),
    )

    def create_actions(self) -> None:
        """Register the custom image processing."""
        # ``Wrap1to1Func`` adapts the NumPy-array filter to operate on
        # ``ImageObj`` instances (and carries a ``__name__`` used as the
        # feature id). With no ``paramclass`` the host runs it directly on
        # each selected image.
        self.imagepanel.processor.register_1_to_1(
            sipi.Wrap1to1Func(weighted_average_denoise),
            _("Weighted average denoise"),
        )
