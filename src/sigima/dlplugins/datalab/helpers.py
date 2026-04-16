# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Pluggable helpers for plugin dialogs (messages, questions, progress).

DataLab Qt scatters dialog helpers across :mod:`datalab.utils.qthelpers`
and direct ``QMessageBox`` calls. In the browser those calls must be
routed to React dialogs through an asynchronous bridge. This module
exposes a tiny handler registry that the bootstrap installs at startup.

When no handler is registered (e.g. when the shim is imported outside
DataLab-Web for unit testing), each helper raises
:class:`BrowserNotSupportedError`. Synchronous helpers in particular
cannot be implemented in the browser without WebAssembly JSPI / Web
Workers; plugins relying on them should switch to the asynchronous
variants (``await DataSet.edit_async(...)``).
"""

from __future__ import annotations

from typing import Any, Callable, ContextManager

from datalab.errors import BrowserNotSupportedError


# ---------------------------------------------------------------------------
# Handler registry
# ---------------------------------------------------------------------------

_HANDLERS: dict[str, Callable[..., Any]] = {}


def set_handler(name: str, handler: Callable[..., Any]) -> None:
    """Register *handler* under *name*."""
    _HANDLERS[name] = handler


def get_handler(name: str) -> Callable[..., Any] | None:
    """Return the handler registered under *name* (or ``None``)."""
    return _HANDLERS.get(name)


def has_handler(name: str) -> bool:
    """Return ``True`` if *name* has a handler."""
    return name in _HANDLERS


def clear_handler(name: str) -> None:
    """Drop the handler registered under *name* (no-op if missing)."""
    _HANDLERS.pop(name, None)


def clear_all_handlers() -> None:
    """Drop every registered handler (mostly useful for tests)."""
    _HANDLERS.clear()


# ---------------------------------------------------------------------------
# Synchronous helpers (raise unless an explicit handler exists)
# ---------------------------------------------------------------------------


def _missing(slot: str, *, async_alternative: str | None = None) -> Any:
    """Raise :class:`BrowserNotSupportedError` for an unimplemented slot."""
    msg = (
        f"datalab.helpers.{slot}() is not available in the browser. "
        f"Either register a handler via "
        f"datalab.helpers.set_handler({slot!r}, ...) or — for plugins — "
        "switch to the asynchronous variant"
    )
    if async_alternative:
        msg += f" ({async_alternative})"
    msg += "."
    raise BrowserNotSupportedError(msg)


def show_message(kind: str, message: str, *, title: str | None = None) -> None:
    """Display a message dialog (``warning`` / ``info`` / ``error``)."""
    handler = get_handler("show_message")
    if handler is None:
        _missing("show_message", async_alternative="show_message_async")
    return handler(kind, message, title=title)


def ask_question(
    message: str,
    *,
    title: str | None = None,
    cancelable: bool = False,
) -> bool | None:
    """Show a yes/no(/cancel) confirmation dialog."""
    handler = get_handler("ask_question")
    if handler is None:
        _missing("ask_question", async_alternative="ask_question_async")
    return handler(message, title=title, cancelable=cancelable)


def create_progress_bar(
    parent: Any,
    label: str,
    max_: int = 0,
) -> ContextManager[Any]:
    """Return a context-managed progress bar.

    The yielded object exposes the methods used by stock plugins:
    ``setValue(int)`` and ``wasCanceled() -> bool``.
    """
    handler = get_handler("create_progress_bar")
    if handler is None:
        _missing(
            "create_progress_bar",
            async_alternative="create_progress_bar_async",
        )
    return handler(parent, label, max_=max_)


def get_open_filename(
    parent: Any,
    caption: str,
    basedir: str = "",
    filters: str = "",
) -> str:
    """Show a file-open dialog and return the chosen path (or ``""``)."""
    handler = get_handler("get_open_filename")
    if handler is None:
        _missing("get_open_filename")
    return handler(parent, caption, basedir=basedir, filters=filters)


def get_save_filename(
    parent: Any,
    caption: str,
    basedir: str = "",
    filters: str = "",
) -> str:
    """Show a file-save dialog and return the chosen path (or ``""``)."""
    handler = get_handler("get_save_filename")
    if handler is None:
        _missing("get_save_filename")
    return handler(parent, caption, basedir=basedir, filters=filters)


# ---------------------------------------------------------------------------
# Asynchronous helpers (preferred in the browser)
# ---------------------------------------------------------------------------


async def show_message_async(
    kind: str, message: str, *, title: str | None = None
) -> None:
    """Asynchronous variant of :func:`show_message`."""
    handler = get_handler("show_message_async")
    if handler is None:
        # Fall back to sync handler if available.
        sync_handler = get_handler("show_message")
        if sync_handler is None:
            _missing("show_message_async")
        return sync_handler(kind, message, title=title)
    return await handler(kind, message, title=title)


async def ask_question_async(
    message: str,
    *,
    title: str | None = None,
    cancelable: bool = False,
) -> bool | None:
    """Asynchronous variant of :func:`ask_question`."""
    handler = get_handler("ask_question_async")
    if handler is None:
        sync_handler = get_handler("ask_question")
        if sync_handler is None:
            _missing("ask_question_async")
        return sync_handler(message, title=title, cancelable=cancelable)
    return await handler(message, title=title, cancelable=cancelable)


__all__ = [
    "ask_question",
    "ask_question_async",
    "clear_all_handlers",
    "clear_handler",
    "create_progress_bar",
    "get_handler",
    "get_open_filename",
    "get_save_filename",
    "has_handler",
    "set_handler",
    "show_message",
    "show_message_async",
]
