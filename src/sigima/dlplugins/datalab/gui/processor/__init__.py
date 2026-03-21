# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Browser ``processor`` package — :class:`SignalProcessor` and
:class:`ImageProcessor` exposing the registration API used by stock
plugins (``register_1_to_1`` etc.)."""

from __future__ import annotations

from datalab.gui.processor.image import ImageProcessor
from datalab.gui.processor.signal import SignalProcessor

__all__ = ["ImageProcessor", "SignalProcessor"]
