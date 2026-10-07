# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for object metadata + axis-label helpers."""

from __future__ import annotations

import asyncio

import numpy as np
import pytest
from sigima.objects.annotations import PointAnnotation


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


def test_plotly_annotations_preserve_unknown_payload(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    obj = bs._MODEL.get(oid)
    obj.metadata["_dlw_plotly_annotations"] = {
        "shapes": [],
        "annotations": [],
        "vendor": {"keep": True},
    }

    assert bs.get_plotly_annotations(oid) == {"shapes": [], "annotations": []}
    bs.set_plotly_annotations(oid, {"shapes": [{"type": "line"}], "annotations": []})

    assert obj.metadata["_dlw_plotly_annotations"]["vendor"] == {"keep": True}


def test_graphical_annotations_preserve_opaque_entries(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1, 2], [0, 0, 0])
    obj = bs._MODEL.get(oid)
    opaque = {"vendor": "custom", "payload": {"keep": True}}
    obj.set_annotations([opaque])
    obj.add_graphical_annotation(PointAnnotation(x=1.0, y=2.0))

    payload = bs.get_graphical_annotations(oid)

    assert payload["items"][0]["format"] == "sigima.annotation"
    assert payload["items"][0]["kind"] == "point"
    assert payload["overlay"]["traces"][0]["x"] == [1.0]
    assert obj.get_annotations()[0] == opaque


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
    assert bs._convert_metadata_value("5", "float", 0.001) == 0.005
    assert bs._convert_metadata_value("42", "int", 10.0) == 420
    with pytest.raises(ValueError, match="not an integer"):
        bs._convert_metadata_value("3", "int", 0.5)


def _frames(bs) -> list[str]:
    return [
        bs.add_signal_from_arrays(title, [0, 1], [0, 0])
        for title in ("Flat 5 ms 01", "Dark 01")
    ]


def test_metadata_key_suggestions_skip_internal_keys(fresh_bootstrap):
    bs = fresh_bootstrap
    oids = _frames(bs)
    bs.set_object_metadata_value(oids[0], "plugin.org.example.cam.gain", "number", "2")
    obj = bs._MODEL.get(oids[1])
    obj.metadata["Geometry_fwhm_dict"] = {"title": "FWHM"}
    obj.metadata["array"] = np.arange(3)
    keys = [
        key
        for key, _desc in bs._metadata_key_suggestions(
            [bs._MODEL.get(oid) for oid in oids]
        )
    ]
    assert "plugin.org.example.cam.gain" in keys
    assert not {"Geometry_fwhm_dict", "array"} & set(keys)
    assert not any(key.startswith("_") for key in keys)


def test_add_object_metadata_extracts_values(fresh_bootstrap):
    """Extraction, scale factor and unmatched objects left unchanged."""
    bs = fresh_bootstrap
    oids = _frames(bs)
    key = "plugin.org.example.cam.exposure_time_s"
    received: list[dict] = []

    async def bridge(kind: str, payload: dict) -> dict:
        received.append(payload)
        return {
            "metadata_key": key,
            "value_pattern": "{title}",
            "extraction_pattern": r"([\d.]+)\s*ms",
            "conversion": "float",
            "scale": 0.001,
        }

    bs.set_dialog_bridge(bridge)
    try:
        assert asyncio.run(bs.add_object_metadata(oids)) is True
    finally:
        bs.set_dialog_bridge(None)

    flat, dark = (bs._MODEL.get(oid) for oid in oids)
    assert flat.metadata[key] == 0.005
    assert key not in dark.metadata
    properties = received[0]["schema"]["properties"]
    assert properties["known_key"]["x-guidata-has-callback"] is True
    assert properties["metadata_key"]["pattern"]


def test_add_object_metadata_reports_invalid_settings(fresh_bootstrap):
    """An invalid extraction pattern is reported and the dialog shown again."""
    bs = fresh_bootstrap
    oids = _frames(bs)
    answers = iter(
        [
            {"value_pattern": "{title}", "extraction_pattern": "ms("},
            {"value_pattern": "{title}", "extraction_pattern": r"\d+"},
        ]
    )
    kinds: list[str] = []

    async def bridge(kind: str, payload: dict) -> dict | None:
        kinds.append(kind)
        return next(answers) if kind == "edit_dataset" else None

    bs.set_dialog_bridge(bridge)
    try:
        assert asyncio.run(bs.add_object_metadata(oids)) is True
    finally:
        bs.set_dialog_bridge(None)

    assert kinds == ["edit_dataset", "message", "edit_dataset"]
    assert [bs._MODEL.get(oid).metadata["custom_key"] for oid in oids] == [
        "5",
        "01",
    ]


def test_resolve_bridge_callbacks_fills_key_and_preview(fresh_bootstrap):
    """Known keys and preview callbacks run on a copy of the live dataset."""
    bs = fresh_bootstrap
    oids = _frames(bs)
    bs.set_object_metadata_value(oids[0], "plugin.org.example.cam.gain", "number", "2")
    resolved: dict = {}

    async def bridge(kind: str, payload: dict) -> None:
        values = dict(payload["values"], known_key="plugin.org.example.cam.gain")
        resolved.update(bs.resolve_bridge_callbacks("known_key", values))
        return None

    assert bs.resolve_bridge_callbacks("known_key", {}) == {}
    bs.set_dialog_bridge(bridge)
    try:
        assert asyncio.run(bs.add_object_metadata(oids)) is False
    finally:
        bs.set_dialog_bridge(None)

    assert resolved["metadata_key"] == "plugin.org.example.cam.gain"
    assert "Flat 5 ms 01: plugin.org.example.cam.gain = '1'" in resolved["preview"]


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
