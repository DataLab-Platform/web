# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the Coords / XY editor bridge RPCs (Phase D).

Covers:

* :func:`bootstrap.get_image_coords` materialises both uniform and
  non-uniform representations as plain Python lists.
* :func:`bootstrap.set_image_coords` validates lengths and switches the
  image to non-uniform.
* :func:`bootstrap.switch_image_coords_type` round-trips and rejects
  invalid targets.
* :func:`bootstrap.set_signal_xy` validates lengths and strict
  monotonicity of X.
"""

from __future__ import annotations

import numpy as np
import pytest


def _create_image(bs, shape=(4, 5)):
    data = np.arange(shape[0] * shape[1], dtype=float).reshape(shape)
    return bs.add_image_from_array("img", data)


def test_get_image_coords_uniform(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = _create_image(bs, shape=(3, 4))
    obj = bs._MODEL.get(oid)
    obj.set_uniform_coords(dx=2.0, dy=0.5, x0=10.0, y0=-1.0)
    out = bs.get_image_coords(oid)
    assert out["is_uniform"] is True
    assert out["shape"] == [3, 4]
    assert out["x"] == [10.0, 12.0, 14.0, 16.0]
    assert out["y"] == [-1.0, -0.5, 0.0]


def test_get_image_coords_non_uniform(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = _create_image(bs, shape=(2, 3))
    bs._MODEL.get(oid).set_coords(np.array([0.0, 0.5, 2.0]), np.array([10.0, 12.0]))
    out = bs.get_image_coords(oid)
    assert out["is_uniform"] is False
    assert out["x"] == [0.0, 0.5, 2.0]
    assert out["y"] == [10.0, 12.0]


def test_set_image_coords_success(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = _create_image(bs, shape=(2, 3))
    bs.set_image_coords(oid, [0.0, 1.0, 4.0], [100.0, 200.0])
    obj = bs._MODEL.get(oid)
    assert obj.is_uniform_coords is False
    assert obj.xcoords.tolist() == [0.0, 1.0, 4.0]
    assert obj.ycoords.tolist() == [100.0, 200.0]


def test_set_image_coords_length_mismatch(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = _create_image(bs, shape=(2, 3))
    with pytest.raises(ValueError, match="Coords length mismatch"):
        bs.set_image_coords(oid, [0.0, 1.0], [100.0, 200.0])
    with pytest.raises(ValueError, match="Coords length mismatch"):
        bs.set_image_coords(oid, [0.0, 1.0, 2.0], [100.0])


def test_switch_image_coords_type_roundtrip(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = _create_image(bs, shape=(3, 4))
    bs._MODEL.get(oid).set_uniform_coords(dx=1.5, dy=2.0, x0=5.0, y0=-2.0)
    out = bs.switch_image_coords_type(oid, "non-uniform")
    assert out == {"is_uniform": False}
    obj = bs._MODEL.get(oid)
    assert obj.xcoords.tolist() == [5.0, 6.5, 8.0, 9.5]
    out = bs.switch_image_coords_type(oid, "uniform")
    assert out == {"is_uniform": True}
    assert obj.dx == pytest.approx(1.5)
    assert obj.x0 == pytest.approx(5.0)


def test_switch_image_coords_type_invalid(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = _create_image(bs)
    with pytest.raises(ValueError, match="must be 'uniform' or 'non-uniform'"):
        bs.switch_image_coords_type(oid, "bogus")


def test_set_signal_xy_success(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0.0, 1.0, 2.0], [10.0, 20.0, 30.0])
    bs.set_signal_xy(oid, [0.0, 0.5, 1.0, 2.5], [1.0, 2.0, 3.0, 4.0])
    obj = bs._MODEL.get(oid)
    assert obj.x.tolist() == [0.0, 0.5, 1.0, 2.5]
    assert obj.y.tolist() == [1.0, 2.0, 3.0, 4.0]


def test_set_signal_xy_length_mismatch(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0.0, 1.0], [10.0, 20.0])
    with pytest.raises(ValueError, match="Length mismatch"):
        bs.set_signal_xy(oid, [0.0, 1.0, 2.0], [1.0, 2.0])


def test_set_signal_xy_non_monotonic(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0.0, 1.0], [10.0, 20.0])
    with pytest.raises(ValueError, match="strictly increasing"):
        bs.set_signal_xy(oid, [0.0, 2.0, 1.0], [1.0, 2.0, 3.0])


def test_set_signal_xy_too_few(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0.0, 1.0], [10.0, 20.0])
    with pytest.raises(ValueError, match="At least 2"):
        bs.set_signal_xy(oid, [0.0], [1.0])
