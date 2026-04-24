# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Browser ``panel`` package — :class:`SignalPanel` / :class:`ImagePanel`
facades exposing the attributes plugins read from
``self.signalpanel`` / ``self.imagepanel``."""

from __future__ import annotations

from datalab.gui.panel.image import ImagePanel
from datalab.gui.panel.signal import SignalPanel

__all__ = ["ImagePanel", "SignalPanel"]
