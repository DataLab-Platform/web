# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the macro store helpers."""

from __future__ import annotations

import pytest


def test_initial_macros_empty(fresh_bootstrap):
    bs = fresh_bootstrap
    assert bs.list_macros() == []


def test_create_macro_default_title(fresh_bootstrap):
    bs = fresh_bootstrap
    rec = bs.create_macro()
    macros = bs.list_macros()
    assert len(macros) == 1
    assert macros[0]["id"] == rec["id"]
    assert macros[0]["title"].startswith("Untitled")
    full = bs.get_macro(rec["id"])
    assert full["code"]


def test_create_macro_custom_code(fresh_bootstrap):
    bs = fresh_bootstrap
    rec = bs.create_macro(title="Mine", code="x = 1\n")
    full = bs.get_macro(rec["id"])
    assert full["title"] == "Mine"
    assert full["code"] == "x = 1\n"


def test_set_macro_code(fresh_bootstrap):
    bs = fresh_bootstrap
    rec = bs.create_macro()
    bs.set_macro_code(rec["id"], "print('hi')\n")
    assert bs.get_macro(rec["id"])["code"] == "print('hi')\n"


def test_rename_macro(fresh_bootstrap):
    bs = fresh_bootstrap
    rec = bs.create_macro()
    bs.rename_macro(rec["id"], "Renamed")
    assert bs.get_macro(rec["id"])["title"] == "Renamed"


def test_duplicate_macro_creates_new_entry(fresh_bootstrap):
    bs = fresh_bootstrap
    rec = bs.create_macro(title="Orig", code="print('a')\n")
    dup = bs.duplicate_macro(rec["id"])
    assert dup["id"] != rec["id"]
    assert bs.get_macro(dup["id"])["code"] == "print('a')\n"
    assert len(bs.list_macros()) == 2


def test_delete_macro(fresh_bootstrap):
    bs = fresh_bootstrap
    rec = bs.create_macro()
    bs.delete_macro(rec["id"])
    assert bs.list_macros() == []


def test_unknown_macro_raises(fresh_bootstrap):
    bs = fresh_bootstrap
    with pytest.raises(KeyError):
        bs.get_macro("does-not-exist")


def test_reorder_macros(fresh_bootstrap):
    bs = fresh_bootstrap
    a = bs.create_macro(title="A")["id"]
    b = bs.create_macro(title="B")["id"]
    c = bs.create_macro(title="C")["id"]
    bs.reorder_macros([c, a, b])
    assert [m["id"] for m in bs.list_macros()] == [c, a, b]


def test_reorder_macros_partial_appends_leftovers(fresh_bootstrap):
    """Defensive: missing ids are appended at the end (never lost)."""
    bs = fresh_bootstrap
    a = bs.create_macro(title="A")["id"]
    b = bs.create_macro(title="B")["id"]
    bs.reorder_macros([b])
    order = [m["id"] for m in bs.list_macros()]
    assert order == [b, a]


def test_replace_macros_overwrites_store(fresh_bootstrap):
    bs = fresh_bootstrap
    bs.create_macro(title="Old")
    bs.replace_macros(
        [
            {"id": "m1", "title": "New", "code": "print(1)\n"},
            {"id": "m2", "title": "Other", "code": ""},
        ]
    )
    macros = bs.list_macros()
    assert [m["title"] for m in macros] == ["New", "Other"]
