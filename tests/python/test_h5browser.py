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


def test_open_file_skips_link_cycles(tmp_path, capsys):
    """Links back to a parent group are skipped, other aliases are kept.

    Regression: a group linked into itself was walked down to the depth limit,
    producing 100 phantom levels (``/entry/self/self/...``).
    """
    path = tmp_path / "cycles.h5"
    with h5py.File(path, "w") as f:
        entry = f.create_group("entry")
        entry["signal"] = np.arange(10.0)
        entry["self"] = entry  # hard link to itself
        inner = entry.create_group("inner")
        inner["up"] = entry  # hard link to its parent (two-group cycle)
        inner["root"] = h5py.SoftLink("/")  # soft link to the root group
        f["alias"] = entry["signal"]  # dataset alias, not a cycle
        f["entry_alias"] = inner  # group alias, not a cycle
    result = h5b.open_file("cycles.h5", path.read_bytes())
    try:
        # The group alias keeps its own path to the parent group of the aliased
        # group (which is not one of its own parents)
        assert set(h5b.STATE[result["file_id"]].nodes_by_path) == {
            "/",
            "/entry",
            "/entry/signal",
            "/entry/inner",
            "/alias",
            "/entry_alias",
            "/entry_alias/up",
            "/entry_alias/up/signal",
        }
    finally:
        h5b.close_all()
    output = capsys.readouterr().out
    assert "'/entry/self': link back to its parent group '/entry'" in output
    assert "'/entry/inner/up': link back to its parent group '/entry'" in output
    assert "'/entry/inner/root': link back to its parent group '/'" in output
    assert "max depth" not in output


def test_open_file_skips_broken_links(tmp_path, capsys):
    """Broken soft or external links (e.g. synchrotron master files without
    their detector files) are skipped: the rest of the file stays browsable.

    Regression: ``open_file`` raised ``AttributeError`` on the first broken link.
    """
    path = tmp_path / "broken.h5"
    with h5py.File(path, "w") as f:
        f["ok"] = np.arange(10.0)
        f["broken"] = h5py.SoftLink("/missing")
        grp = f.create_group("entry")
        grp["frames"] = h5py.ExternalLink("missing_detector.h5", "/frames")
        grp["signal"] = np.linspace(0.0, 1.0, 8)
    result = h5b.open_file("broken.h5", path.read_bytes())
    try:
        nodes = h5b.STATE[result["file_id"]].nodes_by_path
        assert {"/ok", "/entry", "/entry/signal"} <= set(nodes)
        assert not {"/broken", "/entry/frames"} & set(nodes)
        imported = h5b.import_nodes(result["file_id"], ["/ok", "/entry/signal"])
        assert len(imported["objects"]) == 2
    finally:
        h5b.close_all()
    output = capsys.readouterr().out
    assert "'/broken': broken soft link to '/missing'" in output
    assert "broken external link to 'missing_detector.h5:/frames'" in output


def test_open_file_cleans_up_when_tree_fails(h5_bytes, monkeypatch):
    """A failure while building the tree closes the file and removes its
    temporary copy; the next file opens normally."""
    tempdirs = []
    mkdtemp = h5b.tempfile.mkdtemp

    def spy_mkdtemp(*args, **kwargs):
        tempdirs.append(mkdtemp(*args, **kwargs))
        return tempdirs[-1]

    def fail(*_args, **_kwargs):
        raise RuntimeError("tree failure")

    monkeypatch.setattr(h5b.tempfile, "mkdtemp", spy_mkdtemp)
    with monkeypatch.context() as patch:
        patch.setattr(h5b, "_build_node", fail)
        with pytest.raises(RuntimeError, match="tree failure"):
            h5b.open_file("sample.h5", h5_bytes)
    assert len(tempdirs) == 1 and not h5b.osp.exists(tempdirs[0])
    assert not h5b.STATE
    result = h5b.open_file("sample.h5", h5_bytes)
    try:
        assert result["file_id"] in h5b.STATE
    finally:
        h5b.close_all()


@pytest.fixture
def large_h5(tmp_path):
    """Return the path of a file with large datasets of various kinds."""
    path = tmp_path / "large.h5"
    table = np.zeros(5000, dtype=[("x", "f8"), ("y", "f8")])
    mixed = np.zeros(3000, dtype=[("label", "S8"), ("value", "f8")])
    mixed["label"] = b"abc"
    with h5py.File(path, "w") as f:
        f["small"] = np.arange(10.0)
        f["vector"] = np.arange(1_000_000.0)
        f["column"] = np.zeros((50_000, 1))
        f["image"] = np.zeros((300, 400), dtype=np.uint16)
        f["cube"] = np.zeros((20, 30, 40))
        f["text"] = np.array([b"line"] * 1000)
        f["table"] = table
        f["mixed"] = mixed
        f["label"] = "hello"
        f["value"] = 3.5
    return path


def _nodes_by_path(result: dict) -> dict[str, dict]:
    """Return the nodes of an ``open_file`` result by path."""
    nodes = {}
    stack = [result["root"]]
    while stack:
        node = stack.pop()
        nodes[node["id"]] = node
        stack.extend(node["children"])
    return nodes


def test_open_file_reads_only_samples(large_h5, monkeypatch):
    """Opening a file reads a bounded sample of each dataset, not its data.

    Regression: every dataset was read entirely while building the tree, even
    datasets that cannot be imported (e.g. 3D cubes).
    """
    reads: dict[str, int] = {}
    getitem = h5py.Dataset.__getitem__

    def spy(self, *args, **kwargs):
        result = getitem(self, *args, **kwargs)
        reads[self.name] = reads.get(self.name, 0) + int(np.size(result))
        return result

    monkeypatch.setattr(h5py.Dataset, "__getitem__", spy)
    result = h5b.open_file("large.h5", large_h5.read_bytes())
    try:
        assert reads and max(reads.values()) <= h5b._SAMPLE_MAX_ITEMS
        reads.clear()
        h5b.import_nodes(result["file_id"], ["/vector"])
        assert reads == {"/vector": 1_000_000}
    finally:
        h5b.close_all()


def test_sampled_classification_matches_full_read(large_h5, monkeypatch):
    """The nodes classified from samples are those classified from full reads
    (kind, icon, shape, type and support; only the text preview may differ)."""
    sampled = h5b.open_file("large.h5", large_h5.read_bytes())
    h5b.close_all()
    monkeypatch.setattr(h5b, "_read_sample", h5b._safe_read)
    full = h5b.open_file("large.h5", large_h5.read_bytes())
    h5b.close_all()
    sampled_nodes, full_nodes = _nodes_by_path(sampled), _nodes_by_path(full)
    assert sampled_nodes.keys() == full_nodes.keys()
    for path, node in full_nodes.items():
        for key in ("kind", "icon_name", "shape_str", "dtype_str", "is_supported"):
            assert sampled_nodes[path][key] == node[key], (path, key)
    kinds = {path: node["kind"] for path, node in sampled_nodes.items()}
    assert kinds == {
        "/": "group",
        "/small": "signal",
        "/vector": "signal",
        "/column": "signal",
        "/image": "image",
        "/cube": "unknown",
        "/text": "text",
        "/table": "signal",
        "/mixed": "compound",
        "/label": "text",
        "/value": "scalar",
    }
    assert sampled_nodes["/table"]["shape_str"] == "5000 x 2"
    assert sampled_nodes["/image"]["shape_str"] == "300 x 400"


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
    assert result["inexact_values"] is False


@pytest.fixture
def typed_h5(tmp_path):
    """Open a file with datasets of various numeric types (closed afterwards)."""
    path = tmp_path / "types.h5"
    with h5py.File(path, "w") as f:
        f["c64_signal"] = np.array([1 + 2j, 3 + 4j, 5 - 6j], dtype=np.complex64)
        f["c64_image"] = np.full((4, 4), 1 - 2j, dtype=np.complex64)
        f["u32_image"] = np.array(
            [[1, 2**32 - 1, 5], [2**31, 7, 8], [9, 10, 11]], dtype=np.uint32
        )
        f["u16_image"] = np.arange(65527, 65536, dtype=np.uint16).reshape(3, 3)
        f["i64_image"] = np.array([[0, 2**60 + 1, 2], [3, 4, 5], [6, 7, 8]], np.int64)
        f["i64_signal"] = np.array([0, 2**60 + 1, 3], dtype=np.int64)
        f["f32_signal"] = np.array([0.5, 1.5, 2.5], dtype=np.float32)
    result = h5b.open_file("types.h5", path.read_bytes())
    try:
        yield result["file_id"]
    finally:
        h5b.close_all()


def _import_one(file_id: str, node_id: str):
    """Import one node and return ``(object, inexact_values)``."""
    result = h5b.import_nodes(file_id, [node_id])
    ((_kind, obj),) = result["objects"]
    return obj, result["inexact_values"]


def test_import_complex64_keeps_imaginary_part(typed_h5):
    """Regression: complex64 signals lost their imaginary part."""
    signal, inexact = _import_one(typed_h5, "/c64_signal")
    assert signal.y.dtype == np.complex128 and not inexact
    np.testing.assert_array_equal(signal.y, [1 + 2j, 3 + 4j, 5 - 6j])
    image, inexact = _import_one(typed_h5, "/c64_image")
    assert image.data.dtype == np.complex128 and not inexact
    assert image.data[0, 0] == 1 - 2j


def test_import_integers_without_clipping(typed_h5):
    """Regression: uint32 images were clipped to the int32 range."""
    image, inexact = _import_one(typed_h5, "/u32_image")
    assert image.data.dtype == np.float64 and not inexact
    assert image.data[0, 1] == 2**32 - 1 and image.data[1, 0] == 2**31
    image, inexact = _import_one(typed_h5, "/u16_image")
    assert image.data.dtype == np.uint16 and not inexact
    signal, inexact = _import_one(typed_h5, "/f32_signal")
    assert signal.y.dtype == np.float64 and not inexact


@pytest.mark.parametrize("node_id", ["/i64_image", "/i64_signal"])
def test_import_flags_inexact_integers(typed_h5, node_id):
    """Integers beyond 2**53 are converted to float64 and reported."""
    obj, inexact = _import_one(typed_h5, node_id)
    assert inexact
    values = obj.data if node_id.endswith("image") else obj.y
    assert values.dtype == np.float64


def test_preview_complex_and_large_integers(typed_h5):
    """Previews show the real part of complex data and exact integers."""
    prev = h5b.preview(typed_h5, "/c64_signal")
    assert prev["kind"] == "signal" and prev["y"] == [1.0, 3.0, 5.0]
    prev = h5b.preview(typed_h5, "/u32_image")
    assert prev["kind"] == "image" and prev["data"][0][1] == 2**32 - 1


def test_import_nodes_unknown_id_raises(opened):
    file_id = opened["file_id"]
    with pytest.raises(KeyError):
        h5b.import_nodes(file_id, ["/nope"])


def test_import_nodes_unknown_file_raises():
    with pytest.raises(KeyError):
        h5b.import_nodes("never-opened", ["/sig"])
