# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Browser :class:`SignalProcessor` — thin subclass of :class:`BaseProcessor`
specialised for ``object_kind == "signal"``."""

from __future__ import annotations

from datalab.gui.processor.base import BaseProcessor


class SignalProcessor(BaseProcessor):
    """Browser stand-in for ``datalab.gui.processor.signal.SignalProcessor``."""

    def __init__(self) -> None:
        super().__init__("signal")


__all__ = ["SignalProcessor"]
