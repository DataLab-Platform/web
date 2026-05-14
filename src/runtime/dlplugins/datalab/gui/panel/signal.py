# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Browser :class:`SignalPanel` facade."""

from __future__ import annotations

from typing import Any

import guidata.dataset as gds

from datalab.errors import BrowserNotSupportedError
from datalab.gui.actionhandler import ActionHandler
from datalab.gui.processor.base import get_param_defaults
from datalab.gui.processor.signal import SignalProcessor


class SignalPanel:
    """Browser facade for ``datalab.gui.panel.signal.SignalPanel``."""

    PANEL_STR_ID = "signal"

    def __init__(self, main: Any) -> None:
        self.main = main
        self.processor = SignalProcessor()
        self.acthandler = ActionHandler("signal")

    # -- Plugin-facing helpers ----------------------------------------

    def get_newparam_from_current(self, title: str | None = None) -> gds.DataSet | None:
        """Return a parameter dataset suitable for a *New signal* dialog.

        The browser implementation simply returns the cached defaults
        (if any) for :class:`sigima.params.NewSignalParam`; plugins are
        expected to ``await`` the dialog through :meth:`DataSet.edit_async`.
        """
        try:
            from sigima.objects import NewSignalParam  # type: ignore[attr-defined]
        except Exception as exc:  # pragma: no cover - defensive
            raise BrowserNotSupportedError(
                "sigima.objects.NewSignalParam is not available in this build."
            ) from exc

        cached = get_param_defaults(NewSignalParam)
        if cached is not None:
            return cached
        return NewSignalParam(title=title or "")

    def new_object(self, *_args: Any, add_to_panel: bool = True, **_kwargs: Any) -> Any:
        """Stub — Qt ``new_object`` flow is not implemented in v1."""
        raise BrowserNotSupportedError(
            "SignalPanel.new_object() is not yet available in DataLab-Web."
        )

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        raise BrowserNotSupportedError(
            f"SignalPanel.{name} is not available in DataLab-Web."
        )


__all__ = ["SignalPanel"]
