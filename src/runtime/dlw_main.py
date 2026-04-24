# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Bridge between :mod:`bootstrap` and the portable ``datalab.*`` shim.

Implements the duck-typed contract expected by
:class:`datalab.gui.main.DLMainWindow`. The bridge holds a *reference*
to the live :class:`bootstrap.ObjectModel` so HMR re-execution of
``bootstrap.py`` doesn't break plugins that captured ``self.main`` at
load time.
"""

# This module talks to ``bootstrap.py`` through its module-level globals
# (``_MODEL``, ``_CATALOG``, ``ObjectModel``); these are the documented
# integration surface for the Pyodide bridge, hence the file-wide opt-out
# of ``protected-access`` (W0212). The lazy guidata import in ``calc`` is
# intentional too: ``guidata.dataset.dataset_to_json`` is only needed when
# a plugin actually invokes ``main.calc(name, param)``.
# pylint: disable=protected-access,import-outside-toplevel

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
        """Return the active panel kind (``"signal"`` or ``"image"``)."""
        return self._current_panel

    def set_current_panel(self, panel: str) -> None:
        """Set the active panel kind. Raises :class:`ValueError` for unknown panels."""
        if panel not in ("signal", "image"):
            raise ValueError(f"Unknown panel: {panel!r}")
        self._current_panel = panel

    # -- Object queries ------------------------------------------------

    def get_object_titles(self, panel: str) -> list[str]:
        """Return the titles of every object hosted by *panel*."""
        return [
            getattr(obj, "title", "") or ""
            for _oid, obj in self._model().iter_all(panel)
        ]

    def get_object_uuids(self, panel: str, group: int | str | None = None) -> list[str]:
        """Return UUIDs in *panel*, optionally restricted to *group*."""
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
        """Resolve *nb_id_title* (UUID, 1-based index, title, or ``None``) to an object."""
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
        for _oid, obj in model.iter_all(panel):
            if getattr(obj, "title", None) == nb_id_title:
                return obj
        raise KeyError(f"Object not found: {nb_id_title!r}")

    def get_sel_object_uuids(self, include_groups: bool = False) -> list[str]:
        """Return all UUIDs in the current panel.

        The browser bridge has no live selection model, so *include_groups*
        is accepted for desktop API compatibility but ignored.
        """
        del include_groups  # unused (desktop-API compatibility)
        return self.get_object_uuids(self._current_panel)

    # -- Object mutation -----------------------------------------------

    def add_object(self, kind: str, obj: Any, group_id: str | None = None) -> str:
        """Add *obj* of *kind* (``"signal"`` / ``"image"``) to *group_id*."""
        return self._model().add_object(kind, obj, group_id=group_id)

    def add_group(self, panel: str, title: str) -> str:
        """Create a new group titled *title* in *panel* and return its id."""
        return self._model().create_group(panel, title)

    def remove_selected_objects(self, force: bool = False) -> None:
        """No-op on the browser bridge (no live selection model).

        Plugins should call ``model.delete_object(oid)`` explicitly.
        """
        del force  # unused (desktop-API compatibility)

    def reset_all(self) -> None:
        """Replace the live object model with a fresh, empty one."""
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
