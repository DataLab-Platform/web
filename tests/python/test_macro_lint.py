# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for :mod:`dlw_macro_lint`."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
PYODIDE_FS_DIR = Path("/home/pyodide")


@pytest.fixture(autouse=True)
def _install_macro_proxy(tmp_path, monkeypatch):
    """Mirror ``macro_proxy.py`` to the path the lint module reads from.

    In Pyodide the file lives at ``/home/pyodide/macro_proxy.py``; under
    CPython we redirect the lint module to a writable temp copy.
    """
    import dlw_macro_lint as lint

    src = REPO_ROOT / "src" / "runtime" / "macro_proxy.py"
    dst = tmp_path / "macro_proxy.py"
    shutil.copyfile(src, dst)
    monkeypatch.setattr(lint, "_MACRO_PROXY_PATH", str(dst))
    lint.reset_api_cache()
    yield
    lint.reset_api_cache()


def _lint(code):
    from dlw_macro_lint import lint_macro

    return lint_macro(code)


def test_empty_macro_is_ok():
    res = _lint("")
    assert res["ok"] is True
    assert res["syntax_error"] is None
    assert res["proxy_calls"] == []


def test_syntax_error_reported():
    res = _lint("def broken(:\n")
    assert res["ok"] is False
    err = res["syntax_error"]
    assert err is not None
    assert err["line"] == 1


def test_valid_proxy_call_recognised():
    res = _lint("await proxy.list_signals()\n")
    assert res["ok"] is True, res
    assert res["unknown_methods"] == []
    assert res["missing_await"] == []
    assert len(res["proxy_calls"]) == 1
    call = res["proxy_calls"][0]
    assert call["name"] == "list_signals"
    assert call["awaited"] is True
    assert call["is_async"] is True


def test_unknown_method_flagged():
    res = _lint("await proxy.does_not_exist()\n")
    assert res["ok"] is False
    assert len(res["unknown_methods"]) == 1
    assert res["unknown_methods"][0]["name"] == "does_not_exist"


def test_missing_await_flagged():
    res = _lint("proxy.list_signals()\n")
    assert res["ok"] is False
    assert len(res["missing_await"]) == 1
    assert res["missing_await"][0]["name"] == "list_signals"


def test_non_proxy_calls_ignored():
    code = "import numpy as np\nx = np.zeros(5)\nprint(x)\n"
    res = _lint(code)
    assert res["ok"] is True
    assert res["proxy_calls"] == []


@pytest.mark.parametrize(
    "template",
    ["simple_macro.py", "imageproc_macro.py", "call_method_macro.py"],
)
def test_bundled_templates_validate(template):
    path = REPO_ROOT / "src" / "macros" / "templates" / template
    code = path.read_text(encoding="utf-8")
    res = _lint(code)
    assert res["syntax_error"] is None, res["syntax_error"]
    assert res["unknown_methods"] == [], res["unknown_methods"]
    assert res["missing_await"] == [], res["missing_await"]
    assert res["ok"] is True
