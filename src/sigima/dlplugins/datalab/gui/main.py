# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Browser :class:`DLMainWindow` — slim facade over :mod:`bootstrap`.

Plugins receive an instance of this class as ``self.main`` (and obtain
``self.signalpanel`` / ``self.imagepanel`` through it). Methods that
have a meaningful browser implementation forward to a *bridge* object
injected by the bootstrap; the rest raise
:class:`BrowserNotSupportedError`.

The bridge is a light interface (duck-typed) implemented by
``bootstrap.WebMainBridge``; it exposes the operations actually needed
to host plugins: object CRUD, panel switching, calc dispatch.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from datalab.errors import BrowserNotSupportedError
from datalab.gui.panel.image import ImagePanel
from datalab.gui.panel.signal import SignalPanel

if TYPE_CHECKING:
    from sigima.objects import ImageObj, SignalObj


class DLMainWindow:
    """Browser stand-in for the desktop ``DLMainWindow`` Qt window."""

    def __init__(self, bridge: Any) -> None:
        self._bridge = bridge
        self.signalpanel = SignalPanel(self)
        self.imagepanel = ImagePanel(self)

    # -- Panel access --------------------------------------------------

    def get_panel(self, name: str) -> SignalPanel | ImagePanel:
        if name == "signal":
            return self.signalpanel
        if name == "image":
            return self.imagepanel
        raise ValueError(f"Unknown panel: {name!r}")

    def get_current_panel(self) -> str:
        return self._bridge.get_current_panel()

    def set_current_panel(self, panel: str) -> None:
        self._bridge.set_current_panel(panel)

    # -- Object queries (forwarded to bootstrap model) -----------------

    def get_object_titles(self, panel: str) -> list[str]:
        return self._bridge.get_object_titles(panel)

    def get_object_uuids(
        self, panel: str, group: int | str | None = None
    ) -> list[str]:
        return self._bridge.get_object_uuids(panel, group=group)

    def get_object(
        self, nb_id_title: int | str | None, panel: str
    ) -> SignalObj | ImageObj:
        return self._bridge.get_object(nb_id_title, panel)

    def get_sel_object_uuids(
        self, include_groups: bool = False
    ) -> list[str]:
        return self._bridge.get_sel_object_uuids(
            include_groups=include_groups
        )

    # -- Object mutation ----------------------------------------------

    def add_object(
        self,
        kind: str,
        obj: SignalObj | ImageObj,
        group_id: str | None = None,
    ) -> str:
        return self._bridge.add_object(kind, obj, group_id=group_id)

    def add_group(self, panel: str, title: str) -> str:
        return self._bridge.add_group(panel, title)

    def remove_selected_objects(self, force: bool = False) -> None:
        self._bridge.remove_selected_objects(force=force)

    def reset_all(self) -> None:
        self._bridge.reset_all()

    # -- Computation dispatch -----------------------------------------

    def calc(self, name: str, param: Any | None = None) -> Any:
        return self._bridge.calc(name, param=param)

    # -- Anything else: raise -----------------------------------------

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        raise BrowserNotSupportedError(
            f"DLMainWindow.{name} is not available in DataLab-Web."
        )


# Module-level singleton populated by ``bootstrap.install_main()``.
MAIN: DLMainWindow | None = None


def install_main(bridge: Any) -> DLMainWindow:
    """Create the singleton :class:`DLMainWindow` backed by *bridge*."""
    global MAIN
    MAIN = DLMainWindow(bridge)
    return MAIN


def get_main() -> DLMainWindow:
    """Return the installed :class:`DLMainWindow`, raising if absent."""
    if MAIN is None:
        raise RuntimeError(
            "DataLab-Web main facade not installed. "
            "Call datalab.gui.main.install_main(bridge) first."
        )
    return MAIN


__all__ = ["DLMainWindow", "MAIN", "get_main", "install_main"]
