# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Browser :class:`ActionHandler` — Qt-free reproduction of the API used
by stock plugins.

Only :meth:`new_menu` (context manager) and :meth:`new_action` are
implemented; together they record :class:`ExtraMenuAction` entries in
:mod:`datalab.registries` for the React :class:`MenuBar` to consume.
:meth:`clear_plugin_actions` is provided for hot-reload symmetry with
the desktop :mod:`datalab.gui.actionhandler`.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from typing import Any, Callable, Generator

from datalab import registries


class ActionHandler:
    """Browser action handler attached to a panel facade.

    The desktop ``ActionHandler`` is stateful and tightly coupled to Qt
    menus/toolbars; here it is reduced to a recorder that pushes
    :class:`ExtraMenuAction` entries into :data:`EXTRA_MENU_ACTIONS`.
    """

    def __init__(self, panel_kind: str) -> None:
        self.panel_kind = panel_kind
        self._menu_stack: list[str] = []
        # Track which entries we created, so ``clear_plugin_actions`` can
        # purge them without affecting the curated catalogue.
        self._owned_action_ids: set[str] = set()

    # -- Menu management -----------------------------------------------

    @contextmanager
    def new_menu(
        self,
        title: str,
        icon_name: str | None = None,
        store_ref: str | None = None,
    ) -> Generator[None, None, None]:
        """Push *title* onto the current menu path stack."""
        # ``store_ref`` is a Qt-specific helper; ignored in the browser
        # because plugins don't actually need the QMenu reference.
        self._menu_stack.append(title)
        try:
            yield
        finally:
            self._menu_stack.pop()

    @contextmanager
    def new_category(self, _category: Any) -> Generator[None, None, None]:
        """No-op compatibility shim for ``ActionCategory``."""
        yield

    # -- Action creation -----------------------------------------------

    # pylint: disable=too-many-arguments,too-many-locals
    def new_action(
        self,
        title: str,
        position: int | None = None,  # noqa: ARG002 (kept for parity)
        separator: bool = False,
        triggered: Callable[[], Any] | None = None,
        toggled: Callable[..., Any] | None = None,  # noqa: ARG002
        shortcut: Any = None,  # noqa: ARG002
        icon_name: str | None = None,
        tip: str | None = None,
        select_condition: Callable | str | None = None,
        context_menu_pos: int | None = None,  # noqa: ARG002
        context_menu_sep: bool = False,  # noqa: ARG002
        toolbar_pos: int | None = None,  # noqa: ARG002
        toolbar_sep: bool = False,  # noqa: ARG002
        toolbar_category: Any = None,  # noqa: ARG002
    ) -> Any:
        """Record a plugin menu action and return a placeholder."""
        if triggered is None:
            return None  # plain separator entry — nothing to record

        cond = select_condition
        if cond is None:
            cond = "always"
        elif callable(cond):
            cond = "always"  # browser ignores callable conditions for v1

        action_id = f"plugin-{uuid.uuid4().hex[:10]}"
        spec = registries.ExtraMenuAction(
            action_id=action_id,
            title=title,
            menu_path=list(self._menu_stack),
            triggered=triggered,
            select_condition=str(cond),
            separator_before=bool(separator),
            icon=icon_name,
            tip=tip,
            origin=registries.current_origin(),
        )
        registries.EXTRA_MENU_ACTIONS[self.panel_kind].append(spec)
        self._owned_action_ids.add(action_id)
        return spec

    def action_for(self, *_args: Any, **_kwargs: Any) -> Any:
        """Browser stub: ``action_for`` is desktop-only.

        Plugins that need to wire menu entries to existing curated
        features can do so by calling ``new_action`` with the matching
        callable; this stub keeps imports working but returns ``None``.
        """
        return None

    # -- Hot-reload ----------------------------------------------------

    def clear_plugin_actions(self) -> None:
        """Drop every action recorded by this handler."""
        kept = [
            entry
            for entry in registries.EXTRA_MENU_ACTIONS[self.panel_kind]
            if entry.action_id not in self._owned_action_ids
        ]
        registries.EXTRA_MENU_ACTIONS[self.panel_kind] = kept
        self._owned_action_ids.clear()


__all__ = ["ActionHandler"]
