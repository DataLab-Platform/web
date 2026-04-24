# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Browser :class:`BaseProcessor` — Qt-free re-implementation of the
DataLab Qt processor's plugin-facing registration API.

Only the methods that bundled stock plugins call are exposed:
:meth:`register_1_to_1`, :meth:`register_2_to_1`, :meth:`register_n_to_1`,
:meth:`update_param_defaults`. Everything else raises a clear
:class:`BrowserNotSupportedError` if a plugin tries to use it.
"""

from __future__ import annotations

import inspect
from typing import Any, Callable

import guidata.dataset as gds

from datalab import registries
from datalab.errors import BrowserNotSupportedError


# Persistent per-paramclass defaults registry. ``update_param_defaults``
# stores a fresh DataSet instance whose fields hold the most recent
# values picked by the user, mirroring the desktop behaviour.
_PARAM_DEFAULTS: dict[type, gds.DataSet] = {}


def get_param_defaults(paramclass: type) -> gds.DataSet | None:
    """Return the cached defaults instance for *paramclass*, if any."""
    return _PARAM_DEFAULTS.get(paramclass)


class BaseProcessor:
    """Browser stand-in for ``datalab.gui.processor.base.BaseProcessor``.

    Plugins call its ``register_*`` methods; the resulting
    :class:`ExtraFeature` entries are picked up by ``bootstrap.py`` to
    extend the Sigima feature catalogue.
    """

    def __init__(self, object_kind: str) -> None:
        self.object_kind = object_kind

    # -- Public API expected by plugins --------------------------------

    def register_1_to_1(
        self,
        func: Callable[..., Any],
        label: str,
        paramclass: type | None = None,
        icon_name: str | None = None,
        menu_path: str | None = None,
    ) -> None:
        """Register a 1→1 processing entry."""
        self._register(
            func,
            label,
            "1_to_1",
            paramclass=paramclass,
            icon=icon_name,
            menu_path=menu_path,
        )

    def register_2_to_1(
        self,
        func: Callable[..., Any],
        label: str,
        paramclass: type | None = None,
        icon_name: str | None = None,
        menu_path: str | None = None,
        obj2_name: str = "Operand",
        skip_xarray_compat: bool = False,
    ) -> None:
        """Register a 2→1 processing entry."""
        self._register(
            func,
            label,
            "2_to_1",
            paramclass=paramclass,
            icon=icon_name,
            menu_path=menu_path,
            operand_label=obj2_name,
            skip_xarray_compat=skip_xarray_compat,
        )

    def register_n_to_1(
        self,
        func: Callable[..., Any],
        label: str,
        paramclass: type | None = None,
        icon_name: str | None = None,
        menu_path: str | None = None,
    ) -> None:
        """Register an n→1 processing entry."""
        self._register(
            func,
            label,
            "n_to_1",
            paramclass=paramclass,
            icon=icon_name,
            menu_path=menu_path,
        )

    def update_param_defaults(self, instance: gds.DataSet) -> None:
        """Cache *instance* values as the new defaults for its paramclass."""
        _PARAM_DEFAULTS[type(instance)] = instance

    # -- Anything else: raise ------------------------------------------

    def __getattr__(self, name: str) -> Any:
        # Triggered only for attributes Python couldn't find above.
        if name.startswith("_"):
            raise AttributeError(name)
        raise BrowserNotSupportedError(
            f"datalab.gui.processor.BaseProcessor.{name}() is not "
            "available in DataLab-Web."
        )

    # -- Internal -----------------------------------------------------

    def _register(
        self,
        func: Callable[..., Any],
        label: str,
        pattern: str,
        *,
        paramclass: type | None = None,
        icon: str | None = None,
        menu_path: str | None = None,
        operand_label: str = "Operand",
        skip_xarray_compat: bool = False,
    ) -> None:
        feature_id = func.__name__
        if not menu_path:
            # Fallback: surface the action under "Plugins / <label>".
            menu_path = f"Plugins/{label}"
        spec = registries.ExtraFeature(
            feature_id=feature_id,
            label=label,
            menu_path=menu_path,
            pattern=pattern,
            func=func,
            paramclass=paramclass,
            icon=icon,
            operand_label=operand_label,
            skip_xarray_compat=skip_xarray_compat,
            object_kind=self.object_kind,
            origin=registries.current_origin(),
        )
        registries.EXTRA_FEATURES[self.object_kind].append(spec)


def _is_dataset_subclass(obj: Any) -> bool:
    return inspect.isclass(obj) and issubclass(obj, gds.DataSet)


__all__ = ["BaseProcessor", "get_param_defaults"]
