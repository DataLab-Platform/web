# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Shared registries fed by browser plugin shims.

Plugins register processings, menu actions and signal/image generators
through the desktop-style ``self.signalpanel.processor.register_*``
and ``self.signalpanel.acthandler.new_action`` APIs reproduced in
:mod:`datalab.gui`. The data lands here, in plain Python containers
that ``bootstrap.py`` can read to extend its feature catalogue and
publish menu entries to the React UI.

Every entry carries an ``origin`` field set to the plugin name that
contributed it, so :func:`clear_origin` can purge them on hot reload.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

# ---------------------------------------------------------------------------
# Feature registry — fed by browser SignalProcessor / ImageProcessor
# ---------------------------------------------------------------------------


@dataclass
class ExtraFeature:
    """A plugin-supplied processing function ready to surface in menus."""

    feature_id: str
    label: str
    menu_path: str
    pattern: str  # "1_to_1" | "2_to_1" | "n_to_1"
    func: Callable[..., Any]
    paramclass: type | None = None
    icon: str | None = None
    operand_label: str = "Operand"
    skip_xarray_compat: bool = False
    object_kind: str = "signal"
    origin: str | None = None  # plugin name that registered it


EXTRA_FEATURES: dict[str, list[ExtraFeature]] = {"signal": [], "image": []}


# ---------------------------------------------------------------------------
# Custom menu action registry — fed by acthandler.new_action
# ---------------------------------------------------------------------------


@dataclass
class ExtraMenuAction:
    """A plugin-supplied menu action (callback, no parameters dialog)."""

    action_id: str
    title: str
    menu_path: list[str]  # e.g. ["Test data", "Load all"]
    triggered: Callable[[], Any]
    select_condition: str = "always"
    separator_before: bool = False
    icon: str | None = None
    tip: str | None = None
    origin: str | None = None


EXTRA_MENU_ACTIONS: dict[str, list[ExtraMenuAction]] = {
    "signal": [],
    "image": [],
}


# ---------------------------------------------------------------------------
# Generator registry — currently unused (placeholder for v2)
# ---------------------------------------------------------------------------


@dataclass
class ExtraGenerator:
    """A plugin-supplied object generator (e.g. new signal type)."""

    name: str
    label: str
    func: Callable[..., Any]
    paramclass: type | None = None
    origin: str | None = None


EXTRA_GENERATORS: dict[str, dict[str, ExtraGenerator]] = {
    "signal": {},
    "image": {},
}


# ---------------------------------------------------------------------------
# Maintenance
# ---------------------------------------------------------------------------


def clear_origin(origin: str) -> None:
    """Remove every entry registered by *origin* (used by hot reload)."""
    for kind in ("signal", "image"):
        EXTRA_FEATURES[kind] = [f for f in EXTRA_FEATURES[kind] if f.origin != origin]
        EXTRA_MENU_ACTIONS[kind] = [
            a for a in EXTRA_MENU_ACTIONS[kind] if a.origin != origin
        ]
        EXTRA_GENERATORS[kind] = {
            k: v for k, v in EXTRA_GENERATORS[kind].items() if v.origin != origin
        }


def clear_all() -> None:
    """Drop every registered plugin contribution."""
    for kind in ("signal", "image"):
        EXTRA_FEATURES[kind].clear()
        EXTRA_MENU_ACTIONS[kind].clear()
        EXTRA_GENERATORS[kind].clear()


# ---------------------------------------------------------------------------
# Origin tracking — set by the loader before calling ``create_actions``
# ---------------------------------------------------------------------------


_CURRENT_ORIGIN: list[str] = []


def push_origin(name: str) -> None:
    """Mark *name* as the plugin currently registering contributions."""
    _CURRENT_ORIGIN.append(name)


def pop_origin() -> None:
    """Forget the most recently pushed origin."""
    if _CURRENT_ORIGIN:
        _CURRENT_ORIGIN.pop()


def current_origin() -> str | None:
    """Return the active plugin origin, or ``None``."""
    return _CURRENT_ORIGIN[-1] if _CURRENT_ORIGIN else None


__all__ = [
    "EXTRA_FEATURES",
    "EXTRA_GENERATORS",
    "EXTRA_MENU_ACTIONS",
    "ExtraFeature",
    "ExtraGenerator",
    "ExtraMenuAction",
    "clear_all",
    "clear_origin",
    "current_origin",
    "pop_origin",
    "push_origin",
]
