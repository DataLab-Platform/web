# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for image ROI helpers (rectangular / circular / polygonal)."""

from __future__ import annotations

import numpy as np


def test_no_image_roi_by_default(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_image_from_array("I", np.zeros((10, 10)))
    assert bs.get_image_roi(oid) == []


def test_set_rectangular_roi_round_trip(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_image_from_array("I", np.zeros((20, 20)))
    bs.set_image_roi(
        oid,
        [
            {
                "geometry": "rectangle",
                "x0": 2.0,
                "y0": 3.0,
                "dx": 5.0,
                "dy": 6.0,
                "title": "rect",
            },
        ],
    )
    rois = bs.get_image_roi(oid)
    assert len(rois) == 1
    assert rois[0]["geometry"] == "rectangle"


def test_set_circular_roi_round_trip(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_image_from_array("I", np.zeros((30, 30)))
    bs.set_image_roi(
        oid,
        [
            {"geometry": "circle", "xc": 10.0, "yc": 12.0, "r": 5.0},
        ],
    )
    rois = bs.get_image_roi(oid)
    assert len(rois) == 1
    assert rois[0]["geometry"] == "circle"


def test_set_polygonal_roi_round_trip(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_image_from_array("I", np.zeros((30, 30)))
    bs.set_image_roi(
        oid,
        [
            {"geometry": "polygon", "points": [[0, 0], [10, 0], [10, 10], [0, 10]]},
        ],
    )
    rois = bs.get_image_roi(oid)
    assert len(rois) == 1
    assert rois[0]["geometry"] == "polygon"


def test_clear_image_roi_with_none(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_image_from_array("I", np.zeros((10, 10)))
    bs.set_image_roi(
        oid,
        [
            {"geometry": "rectangle", "x0": 0.0, "y0": 0.0, "dx": 4.0, "dy": 4.0},
        ],
    )
    bs.set_image_roi(oid, None)
    assert bs.get_image_roi(oid) == []


def test_delete_image_roi_at(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_image_from_array("I", np.zeros((20, 20)))
    bs.set_image_roi(
        oid,
        [
            {"geometry": "rectangle", "x0": 0.0, "y0": 0.0, "dx": 5.0, "dy": 5.0},
            {"geometry": "circle", "xc": 10.0, "yc": 10.0, "r": 3.0},
        ],
    )
    bs.delete_image_roi_at(oid, 0)
    rois = bs.get_image_roi(oid)
    assert len(rois) == 1
    assert rois[0]["geometry"] == "circle"


def test_extract_image_rois_separated(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_image_from_array("I", np.arange(400, dtype=float).reshape(20, 20))
    bs.set_image_roi(
        oid,
        [
            {"geometry": "rectangle", "x0": 0.0, "y0": 0.0, "dx": 5.0, "dy": 5.0},
            {"geometry": "rectangle", "x0": 10.0, "y0": 10.0, "dx": 4.0, "dy": 4.0},
        ],
    )
    new_ids = bs.extract_image_rois(oid, merged=False)
    assert len(new_ids) == 2


def test_extract_image_rois_applies_first_roi_to_all_selected(fresh_bootstrap):
    """The ROI of the first image is applied to every selected image.

    Mirrors DataLab desktop's ``compute_roi_extraction`` ("if multiple
    objs are selected, apply the first obj ROI to all").
    """
    bs = fresh_bootstrap
    a = bs.add_image_from_array("A", np.arange(400, dtype=float).reshape(20, 20))
    b = bs.add_image_from_array("B", np.ones((20, 20), dtype=float))
    # Only A has a ROI; B has none.
    bs.set_image_roi(
        a,
        [
            {"geometry": "rectangle", "x0": 0.0, "y0": 0.0, "dx": 5.0, "dy": 5.0},
            {"geometry": "rectangle", "x0": 10.0, "y0": 10.0, "dx": 4.0, "dy": 4.0},
        ],
    )
    new_ids = bs.extract_image_rois([a, b], merged=False)
    # 2 images x 2 ROIs = 4 extracted images.
    assert len(new_ids) == 4
    # B itself must be left untouched (its ROI is still empty).
    assert bs.get_image_roi(b) == []
