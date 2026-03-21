# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Browser :class:`LocalProxy` — wires plugin calls into the in-memory model.

The desktop ``LocalProxy`` drives the Qt ``DLMainWindow``. In the
browser there is no main window in the Qt sense; instead, the proxy
delegates to the :class:`WebMain` facade owned by ``bootstrap.py``
which in turn forwards to the bootstrap-level :class:`ObjectModel`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from datalab.control.baseproxy import BaseProxy

if TYPE_CHECKING:
    import numpy as np

    from sigima.objects import ImageObj, SignalObj

    from datalab.gui.main import DLMainWindow


class LocalProxy(BaseProxy):
    """Proxy backed by a :class:`WebMain` facade.

    Implemented methods cover what the bundled stock plugins
    (``datalab_testdata.py`` and ``datalab_imageformats.py``) exercise.
    Any other method inherited from :class:`BaseProxy` will raise
    :class:`datalab.errors.BrowserNotSupportedError`.
    """

    def __init__(self, main: DLMainWindow) -> None:
        self.main = main

    # -- Application -----------------------------------------------------

    def get_current_panel(self) -> str:
        return self.main.get_current_panel()

    def set_current_panel(self, panel: str) -> None:
        self.main.set_current_panel(panel)

    # -- Object queries --------------------------------------------------

    def _resolve_panel(self, panel: str | None) -> str:
        return panel or self.get_current_panel()

    def get_object_titles(self, panel: str | None = None) -> list[str]:
        return self.main.get_object_titles(self._resolve_panel(panel))

    def get_object_uuids(
        self,
        panel: str | None = None,
        group: int | str | None = None,
    ) -> list[str]:
        return self.main.get_object_uuids(
            self._resolve_panel(panel), group=group
        )

    def get_object(
        self,
        nb_id_title: int | str | None = None,
        panel: str | None = None,
    ) -> SignalObj | ImageObj:
        return self.main.get_object(
            nb_id_title, self._resolve_panel(panel)
        )

    def get_sel_object_uuids(
        self, include_groups: bool = False
    ) -> list[str]:
        return self.main.get_sel_object_uuids(include_groups=include_groups)

    # -- Object mutation ------------------------------------------------

    def add_signal(
        self,
        title: str,
        xdata: np.ndarray,
        ydata: np.ndarray,
        xunit: str = "",
        yunit: str = "",
        xlabel: str = "",
        ylabel: str = "",
        group_id: str = "",
        set_current: bool = True,
    ) -> bool:
        import sigima

        obj = sigima.create_signal(
            title=title,
            x=xdata,
            y=ydata,
            xunit=xunit,
            yunit=yunit,
            xlabel=xlabel,
            ylabel=ylabel,
        )
        self.main.add_object("signal", obj, group_id=group_id or None)
        return True

    def add_image(
        self,
        title: str,
        data: np.ndarray,
        xunit: str = "",
        yunit: str = "",
        zunit: str = "",
        xlabel: str = "",
        ylabel: str = "",
        zlabel: str = "",
        group_id: str = "",
        set_current: bool = True,
    ) -> bool:
        import sigima

        obj = sigima.create_image(
            title=title,
            data=data,
            xunit=xunit,
            yunit=yunit,
            zunit=zunit,
            xlabel=xlabel,
            ylabel=ylabel,
            zlabel=zlabel,
        )
        self.main.add_object("image", obj, group_id=group_id or None)
        return True

    def add_object(
        self,
        obj: SignalObj | ImageObj,
        group_id: str = "",
        set_current: bool = True,
    ) -> None:
        from sigima.objects import ImageObj as _ImageObj
        from sigima.objects import SignalObj as _SignalObj

        if isinstance(obj, _SignalObj):
            kind = "signal"
        elif isinstance(obj, _ImageObj):
            kind = "image"
        else:
            raise TypeError(
                f"Unsupported object type for add_object: {type(obj).__name__}"
            )
        self.main.add_object(kind, obj, group_id=group_id or None)

    def add_group(
        self,
        title: str,
        panel: str | None = None,
        select: bool = False,
    ) -> None:
        self.main.add_group(self._resolve_panel(panel), title)

    def remove_object(self, force: bool = False) -> None:
        self.main.remove_selected_objects(force=force)

    def reset_all(self) -> None:
        self.main.reset_all()

    # -- Generic dispatch -----------------------------------------------

    def calc(self, name: str, param: Any | None = None) -> Any:
        return self.main.calc(name, param=param)

    def call_method(
        self, method_name: str, *args: Any, **kwargs: Any
    ) -> Any:
        target = self.main
        panel = kwargs.pop("panel", None)
        if panel is not None:
            target = self.main.get_panel(panel)
        method = getattr(target, method_name)
        return method(*args, **kwargs)


__all__ = ["LocalProxy"]
