# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for signal creation helpers (typed + raw + property schemas)."""

from __future__ import annotations

import math

import numpy as np
import pytest


def test_create_signal_sine(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.create_signal(
        kind="sine",
        title="sin",
        size=128,
        xmin=0.0,
        xmax=2 * math.pi,
        a=2.0,
        freq=1.0,
        phase=0.0,
    )
    payload = bs.get_signal_xy(oid)
    assert payload["title"] == "sin"
    assert len(payload["x"]) == 128 and len(payload["y"]) == 128
    assert max(payload["y"]) == pytest.approx(2.0, abs=0.05)


def test_create_signal_unknown_kind_raises(fresh_bootstrap):
    bs = fresh_bootstrap
    with pytest.raises(ValueError):
        bs.create_signal(kind="bogus", title="x", size=10, xmin=0.0, xmax=1.0)


def test_add_signal_from_arrays_sets_units_and_labels(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays(
        "S",
        np.linspace(0, 1, 5),
        np.array([0, 1, 2, 3, 4], dtype=float),
        xunit="s",
        yunit="V",
        xlabel="time",
        ylabel="voltage",
    )
    meta = bs.get_signal_xy(oid)
    assert meta["xunit"] == "s"
    assert meta["yunit"] == "V"
    assert meta["xlabel"] == "time"
    assert meta["ylabel"] == "voltage"


def test_list_signal_creation_types_includes_known_kinds(fresh_bootstrap):
    bs = fresh_bootstrap
    types = bs.list_signal_creation_types()
    values = {t["value"] for t in types}
    for expected in ("gauss", "sine", "lorentz", "voigt"):
        assert expected in values
    # Each entry must expose the menu metadata used by the React UI.
    for t in types:
        assert {"value", "label", "icon", "separator_before"} <= set(t)


def test_create_signal_typed_and_schema(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.create_signal_typed("gauss")
    schema = bs.get_creation_param_schema(oid)
    assert schema is not None
    assert schema["stype"] == "gauss"
    assert "schema" in schema and "values" in schema


def test_get_creation_param_schema_returns_none_for_raw_signal(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    assert bs.get_creation_param_schema(oid) is None


def test_update_signal_creation_params_regenerates_data(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.create_signal_typed("gauss")
    before = bs.get_signal_xy(oid)
    new_size = len(before["x"]) + 100
    summary = bs.update_signal_creation_params(oid, {"size": new_size})
    assert summary["size"] == new_size
    after = bs.get_signal_xy(oid)
    assert len(after["x"]) == new_size


def test_update_signal_creation_params_unknown_oid_raises(fresh_bootstrap):
    bs = fresh_bootstrap
    with pytest.raises(ValueError):
        bs.update_signal_creation_params("does-not-exist", {})


def test_get_object_property_schema_for_signal(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1, 2], [3, 4, 5])
    payload = bs.get_object_property_schema(oid)
    assert "schema" in payload and "values" in payload
    assert isinstance(payload["values"], dict)


def test_image_property_schema_marks_inactive_fields_read_only(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_image_from_array("I", np.zeros((4, 4)))
    props = bs.get_object_property_schema(oid)["schema"]["properties"]
    # ``is_uniform_coords`` is ``active=False`` in Sigima → read-only, like
    # the DataLab desktop UI (greyed out, non-editable).
    assert props["is_uniform_coords"]["readOnly"] is True
    # A uniform image gates the origin/spacing fields as active → editable,
    # and the coordinate arrays as inactive → read-only.
    for name in ("x0", "y0", "dx", "dy"):
        assert props[name].get("readOnly", False) is False
    for name in ("xcoords", "ycoords"):
        assert props[name]["readOnly"] is True


def test_get_object_stats_returns_finite_numbers(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays(
        "S", np.linspace(0, 1, 100), np.linspace(0, 10, 100)
    )
    stats = bs.get_object_stats(oid)
    assert isinstance(stats, dict)
    # At minimum the stats payload must round-trip through JSON.
    import json

    json.dumps(stats)
