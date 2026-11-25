"""Small CPython tests of the WASM64-only presentation and benchmark contracts."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import pytest


def test_wasm64_view_and_stats(fresh_bootstrap, monkeypatch):
    bs = fresh_bootstrap
    monkeypatch.setattr(bs, "_WASM64_VIEW", True)
    data = np.zeros((517, 519), dtype=np.float64)
    data[3, 3], data[4, 4], data[128, 96], data[-1, -1] = np.nan, np.inf, -17, 51
    a, b = (bs.add_image_from_array(name, data) for name in ("a", "b"))
    obj = bs._MODEL.get(a)
    obj.x0, obj.dx = 13.0, 0.25
    snapshot = bs.get_image_view_snapshot(a, [a, b])
    for img in snapshot["images"]:
        pixels = np.frombuffer(img["data"], dtype=np.float32).reshape(512, 512)
        p = img["preview"]
        assert len(img["data"]) == 1024**2
        assert p["native_shape"] == [517, 519] and p["native_dtype"] == "float64"
        np.testing.assert_equal(pixels, data[np.ix_(p["rows"], p["cols"])])
    first = snapshot["images"][0]
    assert first["preview"]["x_edges"] == [12.875, 142.625]
    assert first["x0"] == 12.875 + first["dx"] / 2
    stats = bs.get_properties_snapshot(a)["stats"]
    assert (stats["min"], stats["max"], stats["median"]) == (-17, 51, None)
    assert stats["bounded"]
    with pytest.raises(ValueError, match="Full image"):
        bs.get_image_data(a)
    with pytest.raises(ValueError, match="budget"):
        bs.get_image_view_snapshot(a, [a], max_size=10000)
    obj.data.fill(12)
    bs._mark_object_data_changed(a)
    assert bs.get_image_view_snapshot(a, [a])["images"][0]["lut_default"] == [12, 12]
    obj.data.fill(np.nan)
    bs._mark_object_data_changed(a)
    assert bs.get_object_stats(a)["min"] is None
    small = bs.add_image_from_array("small", np.ones((6, 5)))
    assert bs.get_image_view_snapshot(small, [small])["images"][0]["preview"] is None


def test_nonuniform_preview_uses_physical_centres_and_outer_edges(
    fresh_bootstrap, monkeypatch
):
    bs = fresh_bootstrap
    monkeypatch.setattr(bs, "_WASM64_VIEW", True)
    raw = np.arange(2 * 517).reshape(2, 517)
    oid = bs.add_image_from_array("detector", raw)
    xc = np.arange(517, dtype=float)[::-1] ** 2
    bs._MODEL.get(oid).set_coords(xc, np.array([-4.0, 6.0]))
    image = bs.get_image_view_snapshot(oid, [oid])["images"][0]
    preview = image["preview"]
    edges = [xc[0] + (xc[0] - xc[1]) / 2, xc[-1] + (xc[-1] - xc[-2]) / 2]
    assert preview["x_edges"] == edges and preview["y_edges"] == [-9.0, 11.0]
    centres = image["x0"] + np.arange(image["width"]) * image["dx"]
    np.testing.assert_equal(preview["cols"], [np.argmin(abs(xc - v)) for v in centres])


def test_fixed_oracle_through_real_catalog(fresh_bootstrap, monkeypatch):
    bs = fresh_bootstrap
    path = Path(__file__).parents[1] / "wasm64" / "benchmark" / "workspace.py"
    spec = importlib.util.spec_from_file_location("qualify", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    q = module.Qualification(vars(bs))
    with pytest.raises(ValueError, match="tier"):
        q.prepare(1000000, "")
    with pytest.raises(ValueError, match="consent"):
        q.prepare("18432", "no")
    with pytest.raises(ValueError, match="actual WASM64"):
        q.prepare("smoke", "DEDICATED:smoke")
    monkeypatch.setattr(bs, "_WASM64_VIEW", True)
    ids = q.prepare("smoke", "DEDICATED:smoke")
    (out,) = bs.apply_feature("image:addition", ids)
    report = q.verify()
    assert report["mismatches"] == [0, 0, 0] and report["ids"] == [*ids, out]
    assert report["extrema"] == [0, 8 * 576]
    assert module.boundary_indices(2**32 - 8, 4, 4) == [1, 2]
    bs._MODEL.get(out).data[47, 325] += 1
    with pytest.raises(ValueError, match="Numerical failure"):
        q.verify()
