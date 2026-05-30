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


def test_get_image_data_bytes_encoding_round_trips(fresh_bootstrap):
    """``encoding="bytes"`` ships data as little-endian float32 bytes.

    Used by the JS bridge to skip the costly ``data.tolist()``
    PyProxy → JS conversion.  Decoding back to a NumPy array must
    reproduce the original pixel values within float32 precision.
    """
    bs = fresh_bootstrap
    arr = np.arange(12, dtype=float).reshape(3, 4)
    oid = bs.add_image_from_array("I", arr)
    payload = bs.get_image_data(oid, encoding="bytes")
    assert payload["encoding"] == "f32"
    assert isinstance(payload["data"], (bytes, bytearray))
    decoded = np.frombuffer(payload["data"], dtype=np.float32).reshape(3, 4)
    np.testing.assert_allclose(decoded, arr, rtol=1e-6)


def test_get_image_data_max_size_decimates_and_adjusts_spacing(fresh_bootstrap):
    """``max_size`` decimates the image and rescales ``dx``/``dy``.

    The downsampled view must keep the same physical extent so the
    multi-image grid renders at the correct world coordinates.  LUT
    extrema are computed on the *full* image so the colour scale stays
    representative.
    """
    bs = fresh_bootstrap
    arr = np.arange(40000, dtype=float).reshape(200, 200)
    oid = bs.add_image_from_array("big", arr)
    full = bs.get_image_data(oid)
    small = bs.get_image_data(oid, max_size=50)
    assert max(small["width"], small["height"]) <= 50
    # Physical extent preserved within one stride.
    assert small["width"] * small["dx"] == pytest.approx(
        full["width"] * full["dx"], rel=0.05
    )
    # LUT extrema unchanged (computed before decimation).
    assert small["data_min"] == full["data_min"]
    assert small["data_max"] == full["data_max"]


def test_get_image_data_uniform_has_empty_coords(fresh_bootstrap):
    """Uniform images flag ``is_uniform_coords`` and ship no coord arrays.

    Guards the non-regression contract: the uniform payload is unchanged
    apart from the three new keys (which stay empty / ``True``).
    """
    bs = fresh_bootstrap
    arr = np.arange(20, dtype=float).reshape(4, 5)
    oid = bs.add_image_from_array("u", arr)
    payload = bs.get_image_data(oid)
    assert payload["is_uniform_coords"] is True
    assert payload["xcoords"] == []
    assert payload["ycoords"] == []
    # Regular grid fields untouched.
    assert payload["x0"] == 0.0 and payload["y0"] == 0.0
    assert payload["dx"] == 1.0 and payload["dy"] == 1.0


def test_get_image_data_non_uniform_ships_pixel_centers(fresh_bootstrap):
    """Non-uniform images ship their explicit per-pixel coordinates.

    The front-end converts these centers to bin edges to render the
    variable-width cells exactly (matching desktop PlotPy).
    """
    bs = fresh_bootstrap
    arr = np.arange(12, dtype=float).reshape(3, 4)
    oid = bs.add_image_from_array("nu", arr)
    obj = bs._MODEL.get(oid)
    xc = np.array([0.0, 1.5, 4.0, 9.0])
    yc = np.array([0.0, 2.0, 5.0])
    obj.set_coords(xc, yc)
    payload = bs.get_image_data(oid)
    assert payload["is_uniform_coords"] is False
    assert payload["xcoords"] == [0.0, 1.5, 4.0, 9.0]
    assert payload["ycoords"] == [0.0, 2.0, 5.0]
    # One coordinate per shipped column / row.
    assert len(payload["xcoords"]) == payload["width"]
    assert len(payload["ycoords"]) == payload["height"]


def test_get_image_data_non_uniform_coords_track_downsampling(fresh_bootstrap):
    """Coordinate arrays are subsampled with the same stride as the data.

    Each shipped pixel must keep its true coordinate, so the coord arrays
    stay aligned with the decimated data grid.
    """
    bs = fresh_bootstrap
    arr = np.arange(40000, dtype=float).reshape(200, 200)
    oid = bs.add_image_from_array("big_nu", arr)
    obj = bs._MODEL.get(oid)
    xc = np.linspace(0.0, 100.0, 200)
    yc = np.linspace(0.0, 50.0, 200)
    obj.set_coords(xc, yc)
    small = bs.get_image_data(oid, max_size=50)
    assert len(small["xcoords"]) == small["width"]
    assert len(small["ycoords"]) == small["height"]
    # First coordinate preserved (stride starts at index 0).
    assert small["xcoords"][0] == 0.0
    assert small["ycoords"][0] == 0.0
