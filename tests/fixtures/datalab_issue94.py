"""DataLab plugin created by ``datalab-plugin create``.

DataLab loads this file from its plugin directory. After editing it, select
**Plugins > Reload plugins** in DataLab to take the changes into account.
"""

from __future__ import annotations

import numpy as np
import sigima.proc.signal as sips
from datalab.plugins import PluginBase, PluginCapability, PluginInfo

PLUGIN_DESCRIPTION = "Desktop generator compatibility test"
PLUGIN_ID = "org.example.issue94"
PLUGIN_NAME = "Generated & portable/demo"
FEATURE_ID = f"{PLUGIN_ID}:sample-processing"


def sample_processing(y: np.ndarray) -> np.ndarray:
    """Return new Y values computed from those of the selected signal.

    Edit this function to implement your own processing.
    """
    return np.maximum(y, 0.0)


class GeneratedPortableDemoPlugin(PluginBase):
    """DataLab plugin."""

    PLUGIN_INFO = PluginInfo(
        id=PLUGIN_ID,
        name=PLUGIN_NAME,
        version="0.1.0",
        description=PLUGIN_DESCRIPTION,
        capabilities=(PluginCapability.PROCESSING,),
    )

    def register_computations(self) -> None:
        """Register the processing of this plugin."""
        self.signalpanel.processor.register_1_to_1(
            sips.Wrap1to1Func(sample_processing),
            "Sample processing",
            feature_id=FEATURE_ID,
            owner_plugin_id=self.plugin_id,
        )

    def create_actions(self) -> None:
        """Add the submenu of this plugin to the Plugins menu."""
        handler = self.signalpanel.acthandler
        with handler.new_menu(PLUGIN_NAME.replace("&", "&&")):
            handler.action_for(FEATURE_ID)
