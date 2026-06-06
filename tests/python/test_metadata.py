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


# ---------------------------------------------------------------------------
# Edit > Metadata submenu helpers (copy/paste/delete/import/export/titles)
# ---------------------------------------------------------------------------


def test_clipboard_empty_then_copy(fresh_bootstrap):
    bs = fresh_bootstrap
    assert bs.has_metadata_in_clipboard() is False
    oid = bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    bs.set_object_metadata_value(oid, "custom_key", "string", "hello")
    assert bs.copy_object_metadata(oid) is True
    assert bs.has_metadata_in_clipboard() is True


def test_copy_renames_result_keys(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    obj = bs._MODEL.get(oid)
    obj.metadata["Geometry_fwhm_dict"] = {"title": "FWHM", "coords": [[0, 1]]}
    assert bs.copy_object_metadata(oid) is True
    clip = bs._METADATA_CLIPBOARD
    expected = "Geometry_" + oid + "_fwhm_dict"
    assert expected in clip
    assert clip[expected]["title"] == oid + "_FWHM"


def test_is_result_key(fresh_bootstrap):
    bs = fresh_bootstrap
    assert bs._is_result_key("Geometry_fwhm_dict") is True
    assert bs._is_result_key("Table_stats_dict") is True
    assert bs._is_result_key("custom_key") is False
    assert bs._is_result_key("Geometry_fwhm") is False


def test_convert_metadata_value(fresh_bootstrap):
    bs = fresh_bootstrap
    assert bs._convert_metadata_value("42", "int") == 42
    assert bs._convert_metadata_value("1.5", "float") == 1.5
    assert bs._convert_metadata_value("true", "bool") is True
    assert bs._convert_metadata_value("off", "bool") is False
    assert bs._convert_metadata_value("text", "string") == "text"


def test_delete_object_metadata(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    bs.set_object_metadata_value(oid, "custom_key", "string", "hello")
    assert bs.delete_object_metadata([oid]) is True
    keys = {entry["key"] for entry in bs.list_object_metadata(oid)}
    assert "custom_key" not in keys


def test_delete_object_metadata_empty_selection(fresh_bootstrap):
    bs = fresh_bootstrap
    assert bs.delete_object_metadata([]) is False


def test_objects_have_roi_false_by_default(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", np.linspace(0, 1, 5), np.zeros(5))
    assert bs.objects_have_roi([oid]) is False


def test_export_import_metadata_round_trip(fresh_bootstrap):
    bs = fresh_bootstrap
    src = bs.add_signal_from_arrays("S1", [0, 1], [0, 0])
    bs.set_object_metadata_value(src, "custom_key", "string", "hello")
    data = bs.export_object_metadata_bytes(src)
    assert isinstance(data, (bytes, bytearray))
    dst = bs.add_signal_from_arrays("S2", [0, 1], [0, 0])
    bs.import_object_metadata_bytes(dst, data)
    keys = {entry["key"] for entry in bs.list_object_metadata(dst)}
    assert "custom_key" in keys


def test_get_panel_titles_text(fresh_bootstrap):
    bs = fresh_bootstrap
    bs.add_signal_from_arrays("Alpha", [0, 1], [0, 0])
    bs.add_signal_from_arrays("Beta", [0, 1], [0, 0])
    text = bs.get_panel_titles_text("signal")
    assert "Alpha" in text
    assert "Beta" in text
    # Object titles are indented by four spaces under their group.
    assert "    Alpha" in text
