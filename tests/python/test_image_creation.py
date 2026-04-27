# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for image creation helpers."""

from __future__ import annotations

import numpy as np
import pytest


def test_add_image_from_array_basic(fresh_bootstrap):
    bs = fresh_bootstrap
    arr = np.arange(20, dtype=float).reshape(4, 5)
    oid = bs.add_image_from_array("img", arr, xunit="px", yunit="px", zunit="DN")
    data = bs.get_image_data(oid)
    assert data["title"] == "img"
    assert data["width"] == 5 and data["height"] == 4
    assert data["xunit"] == "px"
    assert data["zunit"] == "DN"
    np.testing.assert_allclose(np.asarray(data["data"]), arr)


def test_list_image_creation_types(fresh_bootstrap):
    bs = fresh_bootstrap
    types = bs.list_image_creation_types()
    assert types
    for t in types:
        assert {"value", "label", "icon", "separator_before"} <= set(t)


def test_create_image_typed_uses_default_params(fresh_bootstrap):
    bs = fresh_bootstrap
    types = bs.list_image_creation_types()
    # Pick the first type whose default parameters yield a usable image.
    first = types[0]["value"]
    oid = bs.create_image_typed(first)
    data = bs.get_image_data(oid)
    assert data["width"] > 0 and data["height"] > 0


def test_create_image_unknown_kind_raises(fresh_bootstrap):
    bs = fresh_bootstrap
    with pytest.raises(ValueError):
        bs.create_image(kind="bogus", title="x", width=4, height=4)


def test_image_panel_isolated_from_signal_panel(fresh_bootstrap):
    bs = fresh_bootstrap
    bs.add_image_from_array("I", np.zeros((3, 3)))
    sig_tree = bs.get_panel_tree("signal")
    img_tree = bs.get_panel_tree("image")
    assert all(o["kind"] != "image" for g in sig_tree["groups"] for o in g["objects"])
    assert any(o["kind"] == "image" for g in img_tree["groups"] for o in g["objects"])


def test_lut_range_round_trips(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_image_from_array("I", np.arange(16, dtype=float).reshape(4, 4))
    assert bs.get_lut_range(oid) is None
    bs.set_lut_range(oid, [0.0, 10.0])
    assert bs.get_lut_range(oid) == [0.0, 10.0]
    bs.set_lut_range(oid, None)
    assert bs.get_lut_range(oid) is None


def test_set_colormap_round_trips_via_image_data(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_image_from_array("I", np.arange(16, dtype=float).reshape(4, 4))
    payload = bs.get_image_data(oid)
    # Default: no override -> get_image_data returns None / False.
    assert payload["colormap"] is None
    assert payload["invert_colormap"] is False
    # Set: round-trips through the image's metadata so the next read sees it.
    bs.set_colormap(oid, "Plasma", True)
    payload = bs.get_image_data(oid)
    assert payload["colormap"] == "Plasma"
    assert payload["invert_colormap"] is True
    # Clear: removes both keys (and their aliases).
    bs.set_colormap(oid, None)
    payload = bs.get_image_data(oid)
    assert payload["colormap"] is None
    assert payload["invert_colormap"] is False


def test_get_images_data_batched(fresh_bootstrap):
    bs = fresh_bootstrap
    a = bs.add_image_from_array("A", np.arange(4, dtype=float).reshape(2, 2))
    b = bs.add_image_from_array("B", np.arange(9, dtype=float).reshape(3, 3))
    payloads = bs.get_images_data([a, b])
    assert [p["id"] for p in payloads] == [a, b]
    assert payloads[0]["width"] == 2 and payloads[0]["height"] == 2
    assert payloads[1]["width"] == 3 and payloads[1]["height"] == 3
    # Each payload carries the full read-only image fields.
    assert all("data" in p and "data_min" in p for p in payloads)
    # Unknown ids are silently skipped (mirrors get_signals_xy).
    assert bs.get_images_data([a, "does-not-exist", b]) == payloads
    # Empty input returns an empty list (no crash).
    assert bs.get_images_data([]) == []
