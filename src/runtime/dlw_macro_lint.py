"""Static AST-only lint for DataLab-Web macros.

Validates that a macro source:

* parses (Python ``SyntaxError`` is reported with line/column),
* only calls methods that exist on the :class:`_Proxy` surface defined
  in :mod:`macro_proxy` (catches typos and hallucinated API),
* awaits coroutine-returning proxy methods (heuristic: the call must be
  directly inside an ``await`` expression).

The valid-method set is discovered by parsing ``macro_proxy.py`` itself,
so it stays in sync with the real API without a hand-maintained list.
"""

from __future__ import annotations

import ast
from typing import Any

_MACRO_PROXY_PATH = "/home/pyodide/macro_proxy.py"

_API_CACHE: tuple[set[str], set[str]] | None = None


def _load_proxy_api() -> tuple[set[str], set[str]]:
    """Return ``(all_methods, async_methods)`` from ``macro_proxy.py``.

    Returns two empty sets when the file is unavailable; lint then skips
    the unknown-method / missing-await checks instead of crashing.
    """
    try:
        with open(_MACRO_PROXY_PATH, encoding="utf-8") as f:
            src = f.read()
    except OSError:
        return set(), set()
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return set(), set()
    all_methods: set[str] = set()
    async_methods: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "_Proxy":
            for member in node.body:
                if isinstance(member, ast.AsyncFunctionDef):
                    all_methods.add(member.name)
                    async_methods.add(member.name)
                elif isinstance(member, ast.FunctionDef):
                    all_methods.add(member.name)
            break
    return all_methods, async_methods


def _api() -> tuple[set[str], set[str]]:
    global _API_CACHE  # pylint: disable=global-statement
    if _API_CACHE is None:
        _API_CACHE = _load_proxy_api()
    return _API_CACHE


def reset_api_cache() -> None:
    """Force re-discovery on next :func:`lint_macro` call (tests only)."""
    global _API_CACHE  # pylint: disable=global-statement
    _API_CACHE = None


def _proxy_attr(node: ast.AST) -> str | None:
    if (
        isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Name)
        and node.value.id == "proxy"
    ):
        return node.attr
    return None


def lint_macro(code: str) -> dict[str, Any]:
    """Statically lint *code* against the proxy API surface.

    Returns:
        Dict with keys:

        * ``ok`` (bool) — True iff no issue was found.
        * ``syntax_error`` (dict | None) — ``{line, col, message}``.
        * ``unknown_methods`` (list) — entries ``{name, line, col}``.
        * ``missing_await`` (list) — entries ``{name, line, col}``.
        * ``proxy_calls`` (list) — every valid ``proxy.X(...)`` found
          (``{name, line, col, awaited, is_async}``).
    """
    result: dict[str, Any] = {
        "ok": False,
        "syntax_error": None,
        "unknown_methods": [],
        "missing_await": [],
        "proxy_calls": [],
    }
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        result["syntax_error"] = {
            "line": exc.lineno or 0,
            "col": (exc.offset or 1) - 1,
            "message": exc.msg or "Syntax error",
        }
        return result

    all_methods, async_methods = _api()

    # Calls whose direct parent is an ``Await`` — i.e. ``await proxy.X(...)``.
    awaited_call_ids: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Await) and isinstance(node.value, ast.Call):
            awaited_call_ids.add(id(node.value))

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = _proxy_attr(node.func)
        if name is None:
            continue
        line = node.lineno
        col = node.col_offset
        if all_methods and name not in all_methods:
            result["unknown_methods"].append({"name": name, "line": line, "col": col})
            continue
        is_async = name in async_methods
        awaited = id(node) in awaited_call_ids
        if is_async and not awaited:
            result["missing_await"].append({"name": name, "line": line, "col": col})
        result["proxy_calls"].append(
            {
                "name": name,
                "line": line,
                "col": col,
                "awaited": awaited,
                "is_async": is_async,
            }
        )

    result["ok"] = (
        result["syntax_error"] is None
        and not result["unknown_methods"]
        and not result["missing_await"]
    )
    return result
