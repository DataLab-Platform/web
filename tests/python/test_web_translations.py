# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Strings of DataLab-Web's own Python dialogs are translated by the UI catalog.

Sigima and guidata translate their strings with gettext; the few strings of
DataLab-Web's own dialogs (``bootstrap.py``) go through ``_web()``, translated
by the catalogs of the user interface (``src/locales``). Each must be declared
in ``src/locales/_dynamic-keys.json``, so that the i18n check requires its
translation.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _web_strings() -> dict[str, str]:
    """Return every ``_web("...")`` literal of the runtime modules."""
    found: dict[str, str] = {}
    for path in sorted((ROOT / "src" / "runtime").glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "_web"
            ):
                assert node.args and isinstance(node.args[0], ast.Constant), (
                    f"{path.name}:{node.lineno}: _web() needs a string literal"
                )
                found[node.args[0].value] = f"{path.name}:{node.lineno}"
    return found


def test_web_strings_are_declared_for_translation():
    strings = _web_strings()
    declared = set(
        json.loads((ROOT / "src" / "locales" / "_dynamic-keys.json").read_text("utf-8"))
    )
    assert "Add metadata" in strings
    missing = sorted(
        f"{where}: {text!r}" for text, where in strings.items() if text not in declared
    )
    assert not missing, "Declare in src/locales/_dynamic-keys.json: " + "; ".join(
        missing
    )


def test_web_falls_back_to_english(fresh_bootstrap):
    bs = fresh_bootstrap
    assert bs._web("Add metadata") == "Add metadata"
    bs.set_web_translations({"Add metadata": "Ajouter des métadonnées", "x": ""})
    assert bs._web("Add metadata") == "Ajouter des métadonnées"
    assert bs._web("x") == "x"
    bs.set_web_translations({})
    assert bs._web("Add metadata") == "Add metadata"
