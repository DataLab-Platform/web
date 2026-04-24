# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Browser :class:`ImageProcessor` — thin subclass of :class:`BaseProcessor`
specialised for ``object_kind == "image"``."""

from __future__ import annotations

from datalab.gui.processor.base import BaseProcessor


class ImageProcessor(BaseProcessor):
    """Browser stand-in for ``datalab.gui.processor.image.ImageProcessor``."""

    def __init__(self) -> None:
        super().__init__("image")


__all__ = ["ImageProcessor"]
