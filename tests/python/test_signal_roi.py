# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for signal ROI helpers."""

from __future__ import annotations

import numpy as np
import pytest


def test_no_roi_by_default(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", np.linspace(0, 1, 16), np.zeros(16))
    assert bs.get_signal_roi(oid) == []


def test_set_and_get_signal_roi_round_trip(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", np.linspace(0, 10, 100), np.zeros(100))
    bs.set_signal_roi(
        oid,
        [
            {"xmin": 1.0, "xmax": 3.0, "title": "left"},
            {"xmin": 6.0, "xmax": 9.0, "title": "right"},
        ],
    )
    rois = bs.get_signal_roi(oid)
    assert len(rois) == 2
    assert rois[0]["xmin"] == 1.0 and rois[0]["xmax"] == 3.0
    assert rois[0]["title"] == "left"
    assert rois[1]["title"] == "right"


def test_set_signal_roi_invalid_segment_raises(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    with pytest.raises(ValueError):
        bs.set_signal_roi(oid, [{"xmin": 5.0, "xmax": 1.0}])  # xmax <= xmin


def test_set_signal_roi_clears_when_none(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", np.linspace(0, 1, 32), np.zeros(32))
    bs.set_signal_roi(oid, [{"xmin": 0.1, "xmax": 0.5}])
    assert bs.get_signal_roi(oid)
    bs.set_signal_roi(oid, None)
    assert bs.get_signal_roi(oid) == []


def test_delete_signal_roi_at(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", np.linspace(0, 1, 32), np.zeros(32))
    bs.set_signal_roi(
        oid,
        [
            {"xmin": 0.0, "xmax": 0.3},
            {"xmin": 0.5, "xmax": 0.9},
        ],
    )
    bs.delete_signal_roi_at(oid, 0)
    rois = bs.get_signal_roi(oid)
    assert len(rois) == 1
    assert rois[0]["xmin"] == 0.5


def test_delete_signal_roi_out_of_bounds_is_noop(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    bs.delete_signal_roi_at(oid, 99)  # must not raise


def test_extract_signal_rois_separated(fresh_bootstrap):
    bs = fresh_bootstrap
    x = np.linspace(0, 10, 200)
    y = np.sin(x)
    oid = bs.add_signal_from_arrays("S", x, y)
    bs.set_signal_roi(
        oid,
        [
            {"xmin": 1.0, "xmax": 3.0},
            {"xmin": 6.0, "xmax": 8.0},
        ],
    )
    new_ids = bs.extract_signal_rois(oid, merged=False)
    assert len(new_ids) == 2
    # Each extracted child should have fewer points than the original.
    for child_oid in new_ids:
        child = bs.get_signal_xy(child_oid)
        assert len(child["x"]) < len(x)


def test_extract_signal_rois_merged(fresh_bootstrap):
    bs = fresh_bootstrap
    x = np.linspace(0, 10, 200)
    oid = bs.add_signal_from_arrays("S", x, np.zeros_like(x))
    bs.set_signal_roi(
        oid,
        [
            {"xmin": 1.0, "xmax": 2.0},
            {"xmin": 5.0, "xmax": 6.0},
        ],
    )
    new_ids = bs.extract_signal_rois(oid, merged=True)
    assert len(new_ids) == 1


def test_extract_without_roi_returns_empty(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    assert bs.extract_signal_rois(oid, merged=False) == []
