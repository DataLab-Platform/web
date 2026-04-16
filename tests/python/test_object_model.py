# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the in-memory object model (panels, groups, objects)."""

from __future__ import annotations

import numpy as np
import pytest


def test_default_panel_is_empty(fresh_bootstrap):
    bs = fresh_bootstrap
    tree = bs.get_panel_tree("signal")
    assert tree["kind"] == "signal"
    # ``ensure_default_group`` always materialises one empty group.
    assert len(tree["groups"]) == 1
    assert tree["groups"][0]["objects"] == []


def test_create_signal_creates_default_group(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S1", np.linspace(0, 1, 10), np.zeros(10))
    tree = bs.get_panel_tree("signal")
    assert len(tree["groups"]) == 1
    objs = tree["groups"][0]["objects"]
    assert len(objs) == 1
    assert objs[0]["id"] == oid
    assert objs[0]["title"] == "S1"
    assert objs[0]["size"] == 10


def test_create_group_appends_after_default(fresh_bootstrap):
    bs = fresh_bootstrap
    bs.add_signal_from_arrays("S0", [0, 1, 2], [0, 0, 0])
    gid = bs.create_group("signal", "Custom")
    tree = bs.get_panel_tree("signal")
    assert [g["name"] for g in tree["groups"]][-1] == "Custom"
    assert tree["groups"][-1]["gid"] == gid


def test_rename_group_and_object(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("Old", [0, 1], [0, 0])
    gid = bs.get_panel_tree("signal")["groups"][0]["gid"]
    bs.rename_group(gid, "Renamed", kind="signal")
    bs.rename_object(oid, "NewName")
    tree = bs.get_panel_tree("signal")
    assert tree["groups"][0]["name"] == "Renamed"
    assert tree["groups"][0]["objects"][0]["title"] == "NewName"


def test_move_object_between_groups(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    gid_dst = bs.create_group("signal", "Dst")
    bs.move_object(oid, gid_dst)
    tree = bs.get_panel_tree("signal")
    src_group, dst_group = tree["groups"][0], tree["groups"][1]
    assert src_group["objects"] == []
    assert [o["id"] for o in dst_group["objects"]] == [oid]


def test_delete_object_and_group(fresh_bootstrap):
    bs = fresh_bootstrap
    oid1 = bs.add_signal_from_arrays("A", [0, 1], [0, 0])
    gid2 = bs.create_group("signal", "G2")
    oid2 = bs.add_signal_from_arrays("B", [0, 1], [0, 0])
    bs.move_object(oid2, gid2)

    bs.delete_object(oid1)
    assert all(
        o["id"] != oid1
        for g in bs.get_panel_tree("signal")["groups"]
        for o in g["objects"]
    )

    bs.delete_group(gid2, kind="signal")
    # Deleting the only remaining group still leaves a fresh default group.
    tree = bs.get_panel_tree("signal")
    assert len(tree["groups"]) == 1
    assert tree["groups"][0]["objects"] == []


def test_delete_unknown_object_is_noop(fresh_bootstrap):
    bs = fresh_bootstrap
    bs.delete_object("does-not-exist")  # must not raise


def test_signal_and_image_panels_are_isolated(fresh_bootstrap):
    bs = fresh_bootstrap
    bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    bs.add_image_from_array("I", np.zeros((4, 4)))
    sig_tree = bs.get_panel_tree("signal")
    img_tree = bs.get_panel_tree("image")
    assert sig_tree["groups"][0]["objects"][0]["kind"] == "signal"
    assert img_tree["groups"][0]["objects"][0]["kind"] == "image"
    assert (
        sig_tree["groups"][0]["objects"][0]["id"]
        != img_tree["groups"][0]["objects"][0]["id"]
    )


def test_rename_unknown_group_raises(fresh_bootstrap):
    bs = fresh_bootstrap
    bs.get_panel_tree("signal")  # ensure default group exists
    with pytest.raises(KeyError):
        bs.rename_group("not-a-real-gid", "x", kind="signal")
