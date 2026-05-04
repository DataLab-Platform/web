# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the notebook store helpers (mirror :mod:`test_macros`)."""

from __future__ import annotations

import json

import pytest

# ---------------------------------------------------------------------------
# CRUD helpers (symmetric to ``test_macros.py``)
# ---------------------------------------------------------------------------


def test_initial_notebooks_empty(fresh_bootstrap):
    bs = fresh_bootstrap
    assert bs.list_notebooks() == []


def test_create_notebook_default_title(fresh_bootstrap):
    bs = fresh_bootstrap
    rec = bs.create_notebook()
    notebooks = bs.list_notebooks()
    assert len(notebooks) == 1
    assert notebooks[0]["id"] == rec["id"]
    assert notebooks[0]["title"].startswith("Untitled")
    full = bs.get_notebook(rec["id"])
    # No content was supplied — store an empty string by default.
    assert full["content"] == ""


def test_create_notebook_custom_content(fresh_bootstrap):
    bs = fresh_bootstrap
    payload = json.dumps({"nbformat": 4, "cells": []})
    rec = bs.create_notebook(title="Mine", content=payload)
    full = bs.get_notebook(rec["id"])
    assert full["title"] == "Mine"
    assert full["content"] == payload


def test_set_notebook_content(fresh_bootstrap):
    bs = fresh_bootstrap
    rec = bs.create_notebook()
    bs.set_notebook_content(rec["id"], '{"nbformat": 4}')
    assert bs.get_notebook(rec["id"])["content"] == '{"nbformat": 4}'


def test_rename_notebook(fresh_bootstrap):
    bs = fresh_bootstrap
    rec = bs.create_notebook()
    bs.rename_notebook(rec["id"], "Renamed")
    assert bs.get_notebook(rec["id"])["title"] == "Renamed"


def test_duplicate_notebook_creates_new_entry(fresh_bootstrap):
    bs = fresh_bootstrap
    rec = bs.create_notebook(title="Orig", content='{"v": 1}')
    dup = bs.duplicate_notebook(rec["id"])
    assert dup["id"] != rec["id"]
    assert bs.get_notebook(dup["id"])["content"] == '{"v": 1}'
    assert len(bs.list_notebooks()) == 2


def test_delete_notebook(fresh_bootstrap):
    bs = fresh_bootstrap
    rec = bs.create_notebook()
    bs.delete_notebook(rec["id"])
    assert bs.list_notebooks() == []


def test_unknown_notebook_raises(fresh_bootstrap):
    bs = fresh_bootstrap
    with pytest.raises(KeyError):
        bs.get_notebook("does-not-exist")


def test_reorder_notebooks(fresh_bootstrap):
    bs = fresh_bootstrap
    a = bs.create_notebook(title="A")["id"]
    b = bs.create_notebook(title="B")["id"]
    c = bs.create_notebook(title="C")["id"]
    bs.reorder_notebooks([c, a, b])
    assert [n["id"] for n in bs.list_notebooks()] == [c, a, b]


def test_reorder_notebooks_partial_appends_leftovers(fresh_bootstrap):
    """Defensive: missing ids are appended at the end (never lost)."""
    bs = fresh_bootstrap
    a = bs.create_notebook(title="A")["id"]
    b = bs.create_notebook(title="B")["id"]
    bs.reorder_notebooks([b])
    order = [n["id"] for n in bs.list_notebooks()]
    assert order == [b, a]


def test_replace_notebooks_overwrites_store(fresh_bootstrap):
    bs = fresh_bootstrap
    bs.create_notebook(title="Old")
    bs.replace_notebooks(
        [
            {"id": "n1", "title": "New", "content": '{"a": 1}'},
            {"id": "n2", "title": "Other", "content": ""},
        ]
    )
    notebooks = bs.list_notebooks()
    assert [n["title"] for n in notebooks] == ["New", "Other"]


def test_titles_unique_default(fresh_bootstrap):
    """``create_notebook()`` picks a fresh ``Untitled N`` slot."""
    bs = fresh_bootstrap
    titles = {bs.create_notebook()["title"] for _ in range(3)}
    assert len(titles) == 3


# ---------------------------------------------------------------------------
# HDF5 workspace round-trip (signals + macros + notebooks)
# ---------------------------------------------------------------------------


def test_workspace_hdf5_round_trip_with_notebooks(fresh_bootstrap):
    """Notebooks survive a save / load HDF5 round-trip."""
    bs = fresh_bootstrap
    payload = json.dumps({"nbformat": 4, "cells": [], "metadata": {}})
    n_a = bs.create_notebook(title="Alpha", content=payload)
    n_b = bs.create_notebook(title="Beta", content="")
    # Add a macro too — verifies the two stores coexist in the same file.
    bs.create_macro(title="MyMac", code="x = 1\n")
    blob = bs.save_workspace_to_bytes()
    assert isinstance(blob, (bytes, bytearray))

    # Wipe in-memory state and reload.
    bs.replace_notebooks([])
    bs.replace_macros([])
    assert bs.list_notebooks() == []
    bs.open_workspace_from_bytes("ws.h5", blob, replace=True)

    notebooks = bs.list_notebooks()
    assert [n["title"] for n in notebooks] == ["Alpha", "Beta"]
    # Ids are regenerated on load (mirror macros) — fetch by current id.
    full_a = bs.get_notebook(notebooks[0]["id"])
    full_b = bs.get_notebook(notebooks[1]["id"])
    assert full_a["content"] == payload
    assert full_b["content"] == ""
    # Sibling stores survived too.
    assert [m["title"] for m in bs.list_macros()] == ["MyMac"]
    assert bs.get_macro(bs.list_macros()[0]["id"])["code"] == "x = 1\n"
    assert n_a != notebooks[0]["id"]  # ids regenerated
    assert n_b != notebooks[1]["id"]


def test_workspace_open_replace_clears_notebooks_even_when_file_has_none(
    fresh_bootstrap,
):
    """Loading a notebook-less file with ``replace=True`` must wipe state."""
    bs = fresh_bootstrap
    # Snapshot a workspace WITHOUT notebooks/macros.
    blob = bs.save_workspace_to_bytes()
    # Now populate the in-memory stores.
    bs.create_notebook(title="DoomedN")
    bs.create_macro(title="DoomedM")
    assert len(bs.list_notebooks()) == 1
    assert len(bs.list_macros()) == 1

    bs.open_workspace_from_bytes("ws.h5", blob, replace=True)
    assert bs.list_notebooks() == []
    assert bs.list_macros() == []


def test_workspace_open_no_replace_preserves_notebooks(fresh_bootstrap):
    """``replace=False`` keeps existing notebooks alongside loaded ones."""
    bs = fresh_bootstrap
    # File contains one notebook.
    bs.create_notebook(title="FromFile", content='{"nbformat": 4}')
    blob = bs.save_workspace_to_bytes()
    # Reset, then add a different one before loading.
    bs.replace_notebooks([])
    bs.create_notebook(title="Existing")

    bs.open_workspace_from_bytes("ws.h5", blob, replace=False)
    titles = [n["title"] for n in bs.list_notebooks()]
    assert "Existing" in titles
    assert "FromFile" in titles
