# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Browser :class:`ActionHandler` — Qt-free reproduction of the API used
by stock plugins.

:meth:`new_action` records Python callbacks, while :meth:`action_for`
records references to registered computations for the React menu.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from typing import Any, Callable, Generator

from datalab import registries
from datalab.errors import BrowserNotSupportedError


def _check_placement(
    position: int | None,
    context_menu_pos: int | None,
    context_menu_sep: bool,
    toolbar_pos: int | None,
    toolbar_sep: bool,
    toolbar_category: Any,
) -> None:
    if (
        position is not None
        or context_menu_pos is not None
        or context_menu_sep
        or toolbar_pos is not None
        or toolbar_sep
        or toolbar_category is not None
    ):
        raise BrowserNotSupportedError(
            "Plugin action positions, context menus and toolbars are not "
            "available in DataLab-Web."
        )


class ActionHandler:
    """Browser action handler attached to a panel facade.

    The desktop ``ActionHandler`` is stateful and tightly coupled to Qt
    menus/toolbars; here it records callbacks and computation references
    in :data:`datalab.registries.EXTRA_MENU_ACTIONS`.
    """

    def __init__(self, panel_kind: str, main: Any) -> None:
        self.panel_kind = panel_kind
        self._main = main
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
        if store_ref is not None:
            raise BrowserNotSupportedError(
                "Plugin menu references are not available in DataLab-Web."
            )
        self._menu_stack.append(title.replace("&&", "&"))
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
        position: int | None = None,
        separator: bool = False,
        triggered: Callable[[], Any] | None = None,
        toggled: Callable[..., Any] | None = None,
        shortcut: Any = None,
        icon_name: str | None = None,
        tip: str | None = None,
        select_condition: Callable | str | None = None,
        context_menu_pos: int | None = None,
        context_menu_sep: bool = False,
        toolbar_pos: int | None = None,
        toolbar_sep: bool = False,
        toolbar_category: Any = None,
    ) -> Any:
        """Record a plugin menu action and return a placeholder."""
        _check_placement(
            position,
            context_menu_pos,
            context_menu_sep,
            toolbar_pos,
            toolbar_sep,
            toolbar_category,
        )
        if toggled is not None or shortcut is not None:
            raise BrowserNotSupportedError(
                "Plugin action toggles and shortcuts are not available in DataLab-Web."
            )
        cond = select_condition if select_condition is not None else "always"
        if not isinstance(cond, str) or cond not in (
            "always",
            "exactly_one",
            "at_least_one",
            "at_least_two",
        ):
            raise BrowserNotSupportedError(
                f"Plugin selection condition {cond!r} is not available in DataLab-Web."
            )
        if triggered is None:
            return None  # plain separator entry — nothing to record

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

    def action_for(
        self,
        function_or_name: Callable[..., Any] | str,
        position: int | None = None,
        separator: bool = False,
        context_menu_pos: int | None = None,
        context_menu_sep: bool = False,
        toolbar_pos: int | None = None,
        toolbar_sep: bool = False,
        toolbar_category: Any = None,
    ) -> registries.ExtraFeatureMenuAction:
        """Record a menu placement for a registered computation."""
        _check_placement(
            position,
            context_menu_pos,
            context_menu_sep,
            toolbar_pos,
            toolbar_sep,
            toolbar_category,
        )
        feature = self._main._get_registered_feature(self.panel_kind, function_or_name)
        title = feature.label
        if (feature.paramclass is not None or feature.pattern == "1_to_0") and not (
            title.endswith("...") or title.endswith("…")
        ):
            title += "…"
        origin = registries.current_origin()
        action_id = f"plugin-{uuid.uuid4().hex[:10]}"
        spec = registries.ExtraFeatureMenuAction(
            action_id=action_id,
            title=title,
            menu_path=list(self._menu_stack),
            feature_id=feature.feature_id,
            pattern=feature.pattern,
            has_params=feature.paramclass is not None,
            replace_implicit=feature.origin is not None and feature.origin == origin,
            select_condition=(
                "at_least_two" if feature.pattern == "n_to_1" else "at_least_one"
            ),
            separator_before=separator,
            icon=feature.icon,
            origin=origin,
        )
        registries.EXTRA_MENU_ACTIONS[self.panel_kind].append(spec)
        self._owned_action_ids.add(action_id)
        return spec

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
