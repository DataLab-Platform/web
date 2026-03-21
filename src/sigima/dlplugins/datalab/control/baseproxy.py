# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Abstract proxy contract — minimal Qt-free copy.

Only the methods used by bundled stock plugins are documented here. The
class is *not* :mod:`abc`-abstract: every method has a default
implementation that raises :class:`BrowserNotSupportedError`, so
plugins that touch unsupported APIs fail with a clear message instead
of crashing the application.

When desktop parity is needed, override the missing method in
:class:`datalab.control.proxy.LocalProxy`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Iterator

import guidata.dataset as gds

from datalab.errors import BrowserNotSupportedError

if TYPE_CHECKING:
    import numpy as np

    from sigima.objects import ImageObj, SignalObj


def _unsupported(method: str) -> None:
    raise BrowserNotSupportedError(
        f"BaseProxy.{method}() is not available in DataLab-Web. "
        "Plugins that rely on it must be ported or run on the desktop "
        "DataLab application."
    )


class BaseProxy:
    """Minimal :class:`datalab.control.baseproxy.BaseProxy` shim."""

    # -- Container protocol --------------------------------------------

    def __len__(self) -> int:
        return len(self.get_object_uuids())

    def __getitem__(
        self, nb_id_title: int | str | None = None
    ) -> SignalObj | ImageObj:
        return self.get_object(nb_id_title)

    def __iter__(self) -> Iterator[SignalObj | ImageObj]:
        for uid in self.get_object_uuids():
            yield self.get_object(uid)

    def __bool__(self) -> bool:
        return len(self) > 0

    def __contains__(self, id_title: str) -> bool:
        return id_title in self.get_object_uuids() or id_title in (
            self.get_object_titles() or []
        )

    # -- Generic methods (overridden by LocalProxy where supported) ----

    def get_version(self) -> str:
        from datalab.config import _

        return _("Browser")

    def close_application(self) -> None:
        _unsupported("close_application")

    def raise_window(self) -> None:
        _unsupported("raise_window")

    def get_current_panel(self) -> str:
        _unsupported("get_current_panel")

    def set_current_panel(self, panel: str) -> None:
        _unsupported("set_current_panel")

    def reset_all(self) -> None:
        _unsupported("reset_all")

    def remove_object(self, force: bool = False) -> None:
        _unsupported("remove_object")

    def toggle_auto_refresh(self, state: bool) -> None:
        _unsupported("toggle_auto_refresh")

    def toggle_show_titles(self, state: bool) -> None:
        _unsupported("toggle_show_titles")

    def save_to_h5_file(self, filename: str) -> None:
        _unsupported("save_to_h5_file")

    def open_h5_files(self, *_args, **_kwargs) -> None:
        _unsupported("open_h5_files")

    def import_h5_file(self, *_args, **_kwargs) -> None:
        _unsupported("import_h5_file")

    def load_h5_workspace(self, *_args, **_kwargs) -> None:
        _unsupported("load_h5_workspace")

    def save_h5_workspace(self, *_args, **_kwargs) -> None:
        _unsupported("save_h5_workspace")

    def load_from_files(self, filenames: list[str]) -> None:
        _unsupported("load_from_files")

    def load_from_directory(self, path: str) -> None:
        _unsupported("load_from_directory")

    # -- Object creation / mutation ------------------------------------

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
        _unsupported("add_signal")

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
        _unsupported("add_image")

    def add_object(
        self,
        obj: SignalObj | ImageObj,
        group_id: str = "",
        set_current: bool = True,
    ) -> None:
        _unsupported("add_object")

    def set_object(self, obj: SignalObj | ImageObj) -> None:
        _unsupported("set_object")

    def add_group(
        self, title: str, panel: str | None = None, select: bool = False
    ) -> None:
        _unsupported("add_group")

    # -- Object queries ------------------------------------------------

    def get_sel_object_uuids(self, include_groups: bool = False) -> list[str]:
        _unsupported("get_sel_object_uuids")

    def select_objects(
        self, selection: list[int | str], panel: str | None = None
    ) -> None:
        _unsupported("select_objects")

    def select_groups(
        self,
        selection: list[int | str] | None = None,
        panel: str | None = None,
    ) -> None:
        _unsupported("select_groups")

    def delete_metadata(
        self, refresh_plot: bool = True, keep_roi: bool = False
    ) -> None:
        _unsupported("delete_metadata")

    def get_group_titles_with_object_info(self):
        _unsupported("get_group_titles_with_object_info")

    def get_object_titles(self, panel: str | None = None) -> list[str]:
        _unsupported("get_object_titles")

    def get_object(
        self,
        nb_id_title: int | str | None = None,
        panel: str | None = None,
    ) -> SignalObj | ImageObj:
        _unsupported("get_object")

    def get_object_uuids(
        self,
        panel: str | None = None,
        group: int | str | None = None,
    ) -> list[str]:
        _unsupported("get_object_uuids")

    def get_object_shapes(
        self,
        nb_id_title: int | str | None = None,
        panel: str | None = None,
    ) -> list:
        _unsupported("get_object_shapes")

    def add_annotations_from_items(
        self, items: list, refresh_plot: bool = True, panel: str | None = None
    ) -> None:
        _unsupported("add_annotations_from_items")

    def add_label_with_title(
        self, title: str | None = None, panel: str | None = None
    ) -> None:
        _unsupported("add_label_with_title")

    # -- Macros (desktop-only) -----------------------------------------

    def run_macro(self, number_or_title: int | str | None = None) -> None:
        _unsupported("run_macro")

    def stop_macro(self, number_or_title: int | str | None = None) -> None:
        _unsupported("stop_macro")

    def import_macro_from_file(self, filename: str) -> None:
        _unsupported("import_macro_from_file")

    # -- Computation dispatch ------------------------------------------

    def calc(self, name: str, param: gds.DataSet | None = None) -> Any:
        _unsupported("calc")

    def call_method(
        self, method_name: str, *args: Any, **kwargs: Any
    ) -> Any:
        _unsupported("call_method")


__all__ = ["BaseProxy"]
