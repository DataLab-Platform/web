# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for object metadata + axis-label helpers."""

from __future__ import annotations

import numpy as np


def test_get_set_object_meta_round_trip(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    meta = bs.get_object_meta(oid)
    assert meta["title"] == "S"
    bs.set_object_meta(
        oid,
        {
            "title": "S2",
            "xlabel": "t",
            "ylabel": "v",
            "xunit": "s",
            "yunit": "V",
        },
    )
    meta = bs.get_object_meta(oid)
    assert meta["title"] == "S2"
    assert meta["xunit"] == "s"
    assert meta["ylabel"] == "v"


def test_metadata_listing_starts_empty(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", np.linspace(0, 1, 5), np.zeros(5))
    # Some Sigima fields appear by default but every entry must be a dict.
    listing = bs.list_object_metadata(oid)
    for entry in listing:
        assert "key" in entry and "value" in entry


def test_set_and_delete_metadata_value(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    # Signature: (oid, key, value_type, value) where value_type is one of
    # {"string", "number", "bool", "json"}.
    bs.set_object_metadata_value(oid, "custom_key", "string", "custom_value")
    keys = {entry["key"] for entry in bs.list_object_metadata(oid)}
    assert "custom_key" in keys
    deleted = bs.delete_object_metadata_key(oid, "custom_key")
    assert deleted is True
    keys = {entry["key"] for entry in bs.list_object_metadata(oid)}
    assert "custom_key" not in keys


def test_set_metadata_value_typed_parsing(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    bs.set_object_metadata_value(oid, "k_num", "number", "42")
    bs.set_object_metadata_value(oid, "k_bool", "bool", "true")
    bs.set_object_metadata_value(oid, "k_json", "json", '{"a": 1}')
    entries = {e["key"]: e for e in bs.list_object_metadata(oid)}
    assert "k_num" in entries
    assert "k_bool" in entries
    assert "k_json" in entries


def test_delete_unknown_metadata_returns_false(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    assert bs.delete_object_metadata_key(oid, "no_such_key") is False


def test_plotly_annotations_round_trip(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1, 2], [0, 0, 0])
    payload = {
        "shapes": [{"type": "rect", "x0": 0, "y0": 0, "x1": 1, "y1": 1}],
        "annotations": [{"x": 0.5, "y": 0.5, "text": "hello"}],
    }
    bs.set_plotly_annotations(oid, payload)
    got = bs.get_plotly_annotations(oid)
    assert got["shapes"] == payload["shapes"]
    assert got["annotations"] == payload["annotations"]
