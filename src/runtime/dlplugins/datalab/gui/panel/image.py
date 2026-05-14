# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Browser :class:`ImagePanel` facade."""

from __future__ import annotations

from typing import Any

import guidata.dataset as gds

from datalab.errors import BrowserNotSupportedError
from datalab.gui.actionhandler import ActionHandler
from datalab.gui.processor.base import get_param_defaults
from datalab.gui.processor.image import ImageProcessor


class ImagePanel:
    """Browser facade for ``datalab.gui.panel.image.ImagePanel``."""

    PANEL_STR_ID = "image"

    def __init__(self, main: Any) -> None:
        self.main = main
        self.processor = ImageProcessor()
        self.acthandler = ActionHandler("image")

    # -- Plugin-facing helpers ----------------------------------------

    def get_newparam_from_current(self, title: str | None = None) -> gds.DataSet | None:
        """Return a parameter dataset suitable for a *New image* dialog."""
        try:
            from sigima.objects import NewImageParam  # type: ignore[attr-defined]
        except Exception as exc:  # pragma: no cover - defensive
            raise BrowserNotSupportedError(
                "sigima.objects.NewImageParam is not available in this build."
            ) from exc

        cached = get_param_defaults(NewImageParam)
        if cached is not None:
            return cached
        return NewImageParam(title=title or "")

    def new_object(self, *_args: Any, add_to_panel: bool = True, **_kwargs: Any) -> Any:
        """Stub — Qt ``new_object`` flow is not implemented in v1."""
        raise BrowserNotSupportedError(
            "ImagePanel.new_object() is not yet available in DataLab-Web."
        )

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        raise BrowserNotSupportedError(
            f"ImagePanel.{name} is not available in DataLab-Web."
        )


__all__ = ["ImagePanel"]
