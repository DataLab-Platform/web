# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for revisioned data-derived summary caching."""

from __future__ import annotations

import base64
import pickle

import numpy as np


def _count_summary_builds(monkeypatch, bootstrap):
    calls = 0
    original = bootstrap._build_data_summary

    def counted(oid):
        nonlocal calls
        calls += 1
        return original(oid)

    monkeypatch.setattr(bootstrap, "_build_data_summary", counted)
    return lambda: calls


def test_image_summary_shared_and_invalidated_by_data_edit(
    fresh_bootstrap, monkeypatch
):
    bs = fresh_bootstrap
    oid = bs.add_image_from_array("I", np.arange(16, dtype=float).reshape(4, 4))
    build_count = _count_summary_builds(monkeypatch, bs)

    first = bs.get_image_data(oid)
    stats = bs.get_object_stats(oid)
    preview = bs.get_image_data(oid, max_size=2)

    assert build_count() == 1
    assert stats["min"] == first["data_min"]
    assert preview["lut_default"] == first["lut_default"]

    bs.set_colormap(oid, "Plasma", True)
    bs.get_image_data(oid)
    assert build_count() == 1

    bs.set_image_data(oid, [[10, 20], [30, 40]])
    updated = bs.get_object_stats(oid)
    assert build_count() == 2
    assert updated["shape"] == [2, 2]
    assert updated["min"] == 10.0
    assert updated["max"] == 40.0


def test_signal_summary_invalidated_by_data_edit(fresh_bootstrap, monkeypatch):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1, 2], [3, 4, 5])
    build_count = _count_summary_builds(monkeypatch, bs)

    first = bs.get_object_stats(oid)
    assert bs.get_object_stats(oid) == first
    assert build_count() == 1

    bs.set_signal_xydata(oid, [0, 1], [10, 20])
    updated = bs.get_object_stats(oid)
    assert build_count() == 2
    assert updated["n_points"] == 2
    assert updated["y_mean"] == 15.0


def test_remote_array_property_update_invalidates_summary(fresh_bootstrap, monkeypatch):
    bs = fresh_bootstrap
    oid = bs.add_image_from_array("I", np.zeros((2, 2)))
    build_count = _count_summary_builds(monkeypatch, bs)
    bs.get_object_stats(oid)

    bs.set_object_property_values(oid, {"data": [[5, 6], [7, 8]]})
    updated = bs.get_object_stats(oid)

    assert build_count() == 2
    assert updated["min"] == 5.0
    assert updated["max"] == 8.0


def test_regeneration_and_processing_reapply_invalidate_summaries(
    fresh_bootstrap, monkeypatch
):
    bs = fresh_bootstrap
    build_count = _count_summary_builds(monkeypatch, bs)

    signal_oid = bs.create_signal_typed("gauss")
    before = bs.get_object_stats(signal_oid)
    bs.update_signal_creation_params(signal_oid, {"size": before["n_points"] + 10})
    assert bs.get_object_stats(signal_oid)["n_points"] == before["n_points"] + 10

    image_type = bs.list_image_creation_types()[0]["value"]
    image_oid = bs.create_image_typed(image_type)
    bs.get_object_stats(image_oid)
    bs.update_image_creation_params(image_oid, {})
    bs.get_object_stats(image_oid)

    source = bs.add_signal_from_arrays("S", [0, 1, 2], [0, 5, 10])
    processed = bs.apply_feature("normalize", [source])[0]
    bs.get_object_stats(processed)
    bs.reapply_last_processing(processed)
    bs.get_object_stats(processed)

    assert build_count() == 6


def test_pickle_replacement_invalidates_and_delete_drops_state(
    fresh_bootstrap, monkeypatch
):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1, 2], [1, 2, 3])
    build_count = _count_summary_builds(monkeypatch, bs)
    bs.get_object_stats(oid)

    original = bs._MODEL.get(oid)
    original.uuid = "summary-cache-replacement"
    replacement = original.copy()
    replacement.uuid = original.uuid
    replacement.set_xydata([0, 1], [20, 40])
    payload = base64.b64encode(pickle.dumps(replacement)).decode("ascii")
    assert bs.set_object_pickled(payload) == oid
    assert bs.get_object_stats(oid)["y_mean"] == 30.0
    assert build_count() == 2

    bs.delete_object(oid)
    assert oid not in bs._DATA_REVISIONS
    assert oid not in bs._DATA_SUMMARY_CACHE


def test_group_delete_reset_and_workspace_replace_clear_state(fresh_bootstrap):
    bs = fresh_bootstrap

    group_id = bs.create_group("image", "Temporary")
    grouped_oid = bs.add_image_from_array(
        "Grouped", np.arange(4, dtype=float).reshape(2, 2), group_id=group_id
    )
    bs.get_object_stats(grouped_oid)
    bs.delete_group(group_id, kind="image")
    assert grouped_oid not in bs._DATA_REVISIONS
    assert grouped_oid not in bs._DATA_SUMMARY_CACHE

    reset_oid = bs.add_signal_from_arrays("Reset", [0, 1], [1, 2])
    bs.get_object_stats(reset_oid)
    bs.reset_all()
    assert bs._DATA_REVISIONS == {}
    assert bs._DATA_SUMMARY_CACHE == {}

    saved_oid = bs.add_image_from_array("Saved", np.ones((2, 2)))
    workspace = bs.save_workspace_to_bytes()
    bs.get_object_stats(saved_oid)
    bs.open_workspace_from_bytes("workspace.h5", workspace, replace=True)
    assert saved_oid not in bs._DATA_REVISIONS
    assert saved_oid not in bs._DATA_SUMMARY_CACHE
