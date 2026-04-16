# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Bridge between :mod:`bootstrap` and the portable ``datalab.*`` shim.

Implements the duck-typed contract expected by
:class:`datalab.gui.main.DLMainWindow`. The bridge holds a *reference*
to the live :class:`bootstrap.ObjectModel` so HMR re-execution of
``bootstrap.py`` doesn't break plugins that captured ``self.main`` at
load time.
"""

from __future__ import annotations

import importlib
import sys
import traceback
from typing import Any


class WebMainBridge:
    """Bridge object passed to ``datalab.gui.main.install_main(bridge)``."""

    def __init__(self) -> None:
        self._current_panel = "signal"

    # -- Lazy access to bootstrap module (avoids circular imports) -----

    def _bootstrap(self) -> Any:
        # ``bootstrap.py`` is executed at top level via
        # ``runPythonAsync(bootstrapSource)`` rather than imported as a
        # module, so its globals live in ``sys.modules['__main__']`` (or
        # whatever Pyodide uses as the script namespace). Fall back to a
        # real ``import`` for tests or future setups that ship the file
        # on the import path.
        mod = sys.modules.get("__main__")
        if mod is not None and hasattr(mod, "_MODEL"):
            return mod
        return importlib.import_module("bootstrap")

    def _model(self) -> Any:
        return self._bootstrap()._MODEL

    # -- Panel state ---------------------------------------------------

    def get_current_panel(self) -> str:
        return self._current_panel

    def set_current_panel(self, panel: str) -> None:
        if panel not in ("signal", "image"):
            raise ValueError(f"Unknown panel: {panel!r}")
        self._current_panel = panel

    # -- Object queries ------------------------------------------------

    def get_object_titles(self, panel: str) -> list[str]:
        return [
            getattr(obj, "title", "") or ""
            for _oid, obj in self._model().iter_all(panel)
        ]

    def get_object_uuids(self, panel: str, group: int | str | None = None) -> list[str]:
        model = self._model()
        if group is None:
            return [oid for oid, _ in model.iter_all(panel)]
        # Group filter — accept gid string or 1-based index.
        p = model.panel(panel)
        if isinstance(group, int):
            if not 0 < group <= len(p.groups):
                raise ValueError(f"Group index out of range: {group}")
            target = p.groups[group - 1]
        else:
            target = p.find_group(str(group))
        return list(target.object_ids)

    def get_object(self, nb_id_title: int | str | None, panel: str) -> Any:
        model = self._model()
        if nb_id_title is None:
            uids = self.get_object_uuids(panel)
            if not uids:
                raise KeyError("No object available in panel")
            nb_id_title = uids[0]
        if isinstance(nb_id_title, int):
            uids = self.get_object_uuids(panel)
            if not 0 < nb_id_title <= len(uids):
                raise KeyError(f"Object index out of range: {nb_id_title}")
            return model.get(uids[nb_id_title - 1])
        if model.has(nb_id_title):
            return model.get(nb_id_title)
        # Fall back to title lookup
        for oid, obj in model.iter_all(panel):
            if getattr(obj, "title", None) == nb_id_title:
                return obj
        raise KeyError(f"Object not found: {nb_id_title!r}")

    def get_sel_object_uuids(self, include_groups: bool = False) -> list[str]:
        # No selection model in the browser bridge — plugins should pass
        # explicit ids. Return everything as a benign default.
        return self.get_object_uuids(self._current_panel)

    # -- Object mutation -----------------------------------------------

    def add_object(self, kind: str, obj: Any, group_id: str | None = None) -> str:
        return self._model().add_object(kind, obj, group_id=group_id)

    def add_group(self, panel: str, title: str) -> str:
        return self._model().create_group(panel, title)

    def remove_selected_objects(self, force: bool = False) -> None:
        # Browser has no live selection — plugins should call
        # ``model.delete_object(oid)`` explicitly instead.
        return None

    def reset_all(self) -> None:
        bootstrap = self._bootstrap()
        # Replace the live model with a fresh instance; bootstrap.py keeps
        # the binding via globals() so HMR reuses it.
        bootstrap._MODEL = bootstrap.ObjectModel()

    # -- Computation dispatch ------------------------------------------

    def calc(self, name: str, param: Any | None = None) -> Any:
        """Dispatch a computation.

        Looks up *name* in the live :data:`bootstrap._CATALOG` (which now
        includes plugin-supplied features) and applies it to the *first*
        object of the current panel — mirroring the desktop
        ``LocalProxy.calc`` semantics for "selection-less" calls.
        """
        bootstrap = self._bootstrap()
        catalog = bootstrap._CATALOG
        spec = catalog.get(name)
        if spec is None:
            raise KeyError(f"Unknown feature: {name!r}")
        uids = self.get_object_uuids(spec.object_kind)
        if not uids:
            raise RuntimeError(f"Cannot apply {name!r}: no source object available")
        # Convert DataSet param instance to dict for the apply API.
        params: dict[str, Any] | None = None
        if param is not None:
            try:
                from guidata.dataset import dataset_to_json

                params = dataset_to_json(param)
            except Exception:  # pylint: disable=broad-except
                traceback.print_exc()
                params = None
        return bootstrap.apply_feature(name, [uids[0]], params=params)


__all__ = ["WebMainBridge"]
