# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Monkey-patch the released ``guidata`` to add the pluggable backend API.

The DataLab-Web team contributed a pluggable UI backend to guidata
(see ``guidata/dataset/backends.py``). Until a guidata release ships
with that change, this shim adds the same API on top of whichever
``guidata`` version ``micropip`` installed in Pyodide.

Idempotent — safe to import twice. When the installed guidata already
provides ``guidata.dataset.backends``, this module is a no-op.
"""

from __future__ import annotations

import sys
import types
from typing import Any, Callable


def _ensure_backends_module() -> Any:
    try:
        from guidata.dataset import backends  # type: ignore[import-not-found]

        return backends
    except ImportError:
        pass

    mod = types.ModuleType("guidata.dataset.backends")
    mod.__doc__ = "Pluggable UI backend registry (DataLab-Web shim)."

    handlers: dict[str, Callable[..., Any]] = {}

    def set_handler(name: str, handler: Callable[..., Any]) -> None:
        handlers[name] = handler

    def get_handler(name: str) -> Callable[..., Any] | None:
        return handlers.get(name)

    def has_handler(name: str) -> bool:
        return name in handlers

    def clear_handler(name: str) -> None:
        handlers.pop(name, None)

    def clear_all_handlers() -> None:
        handlers.clear()

    mod.set_handler = set_handler  # type: ignore[attr-defined]
    mod.get_handler = get_handler  # type: ignore[attr-defined]
    mod.has_handler = has_handler  # type: ignore[attr-defined]
    mod.clear_handler = clear_handler  # type: ignore[attr-defined]
    mod.clear_all_handlers = clear_all_handlers  # type: ignore[attr-defined]
    mod.__all__ = [  # type: ignore[attr-defined]
        "set_handler",
        "get_handler",
        "has_handler",
        "clear_handler",
        "clear_all_handlers",
    ]
    sys.modules["guidata.dataset.backends"] = mod
    # Expose as attribute on the parent package too.
    import guidata.dataset as _gds_pkg

    setattr(_gds_pkg, "backends", mod)
    return mod


def _patch_dataset_methods() -> None:
    """Wire the backend registry into :class:`DataSet.edit/view`."""
    from guidata.dataset import datatypes
    from guidata.dataset.backends import get_handler

    DataSet = datatypes.DataSet
    if getattr(DataSet, "_dlw_backend_patched_", False):
        return

    original_edit = DataSet.edit

    def edit(self, parent=None, apply=None, wordwrap=True, size=None,
             object_name=None):
        handler = get_handler("edit_dataset")
        if handler is not None:
            return handler(
                self,
                parent=parent,
                apply=apply,
                wordwrap=wordwrap,
                size=size,
                object_name=object_name,
            )
        return original_edit(
            self,
            parent=parent,
            apply=apply,
            wordwrap=wordwrap,
            size=size,
            object_name=object_name,
        )

    async def edit_async(self, parent=None, apply=None, wordwrap=True,
                          size=None, object_name=None):
        handler = get_handler("edit_dataset_async")
        if handler is not None:
            return await handler(
                self,
                parent=parent,
                apply=apply,
                wordwrap=wordwrap,
                size=size,
                object_name=object_name,
            )
        return self.edit(
            parent=parent,
            apply=apply,
            wordwrap=wordwrap,
            size=size,
            object_name=object_name,
        )

    DataSet.edit = edit
    DataSet.edit_async = edit_async
    DataSet._dlw_backend_patched_ = True


_ensure_backends_module()
_patch_dataset_methods()
