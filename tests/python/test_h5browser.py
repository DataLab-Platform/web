# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the HDF5 browser backend (``dlw_h5browser``).

Builds a small real HDF5 file with h5py (a 1-D signal, a 2-D image and a
nested group), feeds its raw bytes through ``open_file`` and exercises
the public surface (tree walk, attrs, preview, array data, import,
close). Malformed input and the encoding helper are covered too.
"""

from __future__ import annotations

import dlw_h5browser as h5b
import h5py
import numpy as np
import pytest


@pytest.fixture
def h5_bytes(tmp_path):
    """Return the raw bytes of a small multi-node HDF5 file."""
    path = tmp_path / "sample.h5"
    with h5py.File(path, "w") as f:
        sig = f.create_dataset("sig", data=np.linspace(0.0, 1.0, 32))
        sig.attrs["units"] = "V"
        f.create_dataset("img", data=np.arange(64, dtype=float).reshape(8, 8))
        grp = f.create_group("grp")
        grp.create_dataset("inner", data=np.ones(10))
    return path.read_bytes()


@pytest.fixture
def opened(h5_bytes):
    """Open the sample file and guarantee cleanup of all browser state."""
    result = h5b.open_file("sample.h5", h5_bytes)
    try:
        yield result
    finally:
        h5b.close_all()


# ---------------------------------------------------------------------------
# Encoding helper
# ---------------------------------------------------------------------------


def test_safe_decode_bytes():
    assert h5b._safe_decode_bytes(b"hello") == "hello"
    assert h5b._safe_decode_bytes("already str") == "already str"
    assert h5b._safe_decode_bytes(123) == "123"


# ---------------------------------------------------------------------------
# open / close
# ---------------------------------------------------------------------------


def test_open_file_returns_tree(opened):
    assert opened["filename"] == "sample.h5"
    root = opened["root"]
    child_ids = {c["id"] for c in root["children"]}
    assert {"/sig", "/img", "/grp"} <= child_ids


def test_open_invalid_file_raises():
    with pytest.raises(ValueError):
        h5b.open_file("bogus.h5", b"definitely not an HDF5 file")


def test_close_file_clears_state(opened):
    file_id = opened["file_id"]
    assert file_id in h5b.STATE
    h5b.close_file(file_id)
    assert file_id not in h5b.STATE


def test_close_file_unknown_id_is_noop():
    # Must not raise even for an id that was never opened.
    h5b.close_file("never-opened")


# ---------------------------------------------------------------------------
# Node inspection
# ---------------------------------------------------------------------------


def test_node_attrs_exposes_attributes(opened):
    file_id = opened["file_id"]
    attrs = h5b.node_attrs(file_id, "/sig")
    assert attrs["path"] == "/sig"
    assert attrs["attributes"].get("units") == "V"


def _assert_no_h5_references(value):
    """Recursively assert *value* holds no ``h5py.h5r.Reference`` object."""
    assert not isinstance(value, h5py.h5r.Reference)
    if isinstance(value, dict):
        for item in value.values():
            _assert_no_h5_references(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _assert_no_h5_references(item)


def test_node_attrs_stringifies_reference_attributes(tmp_path):
    """HDF5 reference attributes must not leak non-cloneable objects.

    Files converted with ``h4toh5convert`` carry object-reference attributes
    (e.g. ``DIMENSION_LIST``) that h5py exposes as ``object``-dtype arrays of
    :class:`h5py.h5r.Reference`. Such objects cannot cross the worker→main
    thread ``postMessage`` boundary ("could not be cloned"), so
    ``_collect_attrs`` must stringify them rather than ``tolist()`` them.
    """
    path = tmp_path / "ref.h5"
    ref_dtype = h5py.special_dtype(ref=h5py.Reference)
    with h5py.File(path, "w") as f:
        img = f.create_dataset("img", data=np.arange(64, dtype=float).reshape(8, 8))
        s0 = f.create_dataset("scale0", data=np.arange(8))
        s1 = f.create_dataset("scale1", data=np.arange(8))
        img.attrs.create("DIMENSION_LIST", np.array([s0.ref, s1.ref], dtype=ref_dtype))
        img.attrs["REFERENCE"] = s0.ref
        img.attrs["units"] = "px"
    result = h5b.open_file("ref.h5", path.read_bytes())
    try:
        attrs = h5b.node_attrs(result["file_id"], "/img")["attributes"]
        assert attrs["units"] == "px"
        # Reference attributes survive only as harmless strings.
        assert isinstance(attrs["DIMENSION_LIST"], str)
        assert isinstance(attrs["REFERENCE"], str)
        _assert_no_h5_references(attrs)
    finally:
        h5b.close_all()


def test_preview_signal(opened):
    file_id = opened["file_id"]
    prev = h5b.preview(file_id, "/sig")
    assert prev["kind"] == "signal"
    assert len(prev["x"]) == len(prev["y"]) == 32


def test_preview_image(opened):
    file_id = opened["file_id"]
    prev = h5b.preview(file_id, "/img")
    assert prev["kind"] == "image"
    assert prev["width"] == 8
    assert prev["height"] == 8


def test_array_data_returns_shape_and_values(opened):
    file_id = opened["file_id"]
    data = h5b.array_data(file_id, "/img")
    assert data["shape"] == [8, 8]
    assert "float" in data["dtype"]
    assert len(data["data"]) == 8


def test_require_node_rejects_unknown(opened):
    file_id = opened["file_id"]
    with pytest.raises(KeyError):
        h5b.node_attrs(file_id, "/does-not-exist")


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------


def test_import_nodes_builds_objects(opened):
    file_id = opened["file_id"]
    result = h5b.import_nodes(file_id, ["/sig", "/img"])
    kinds = sorted(kind for kind, _obj in result["objects"])
    assert kinds == ["image", "signal"]
    assert result["uint32_clipped"] is False


def test_import_nodes_unknown_id_raises(opened):
    file_id = opened["file_id"]
    with pytest.raises(KeyError):
        h5b.import_nodes(file_id, ["/nope"])


def test_import_nodes_unknown_file_raises():
    with pytest.raises(KeyError):
        h5b.import_nodes("never-opened", ["/sig"])
