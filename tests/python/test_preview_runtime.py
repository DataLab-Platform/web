# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for isolated processing preview execution."""

from __future__ import annotations

import warnings
from dataclasses import replace

import numpy as np
import pytest


def test_signal_preview_matches_published_processing(fresh_bootstrap):
    bs = fresh_bootstrap
    xdata = np.linspace(0, 1, 64)
    ydata = np.linspace(0, 10, 64) ** 2
    source_id = bs.add_signal_from_arrays("raw", xdata, ydata)
    tree_before = bs.get_panel_tree("signal")
    history_before = dict(bs._LAST_PROCESSING)

    temporary = bs.preview_feature(
        "moving_average",
        source_id,
        params={"n": 5},
    )

    assert temporary["kind"] == "signal"
    assert bs.get_panel_tree("signal") == tree_before
    assert bs._LAST_PROCESSING == history_before
    assert bs.get_last_processing(source_id) is None
    published_id = bs.apply_feature("moving_average", [source_id], params={"n": 5})[0]
    expected = bs.get_signal_xy(published_id)
    actual = temporary["data"]
    np.testing.assert_allclose(
        np.frombuffer(actual["x_bytes"], dtype=np.float64), expected["x"]
    )
    np.testing.assert_allclose(
        np.frombuffer(actual["y_bytes"], dtype=np.float64), expected["y"]
    )


def test_current_preview_result_is_consumed_once_by_apply(fresh_bootstrap):
    bs = fresh_bootstrap
    source_id = bs.add_signal_from_arrays(
        "raw", np.arange(32, dtype=float), np.arange(32, dtype=float) ** 2
    )
    feature_id = "test_preview_handoff"
    original = bs._CATALOG["moving_average"]
    calls = []

    def counted(source, param):
        calls.append(param.n)
        return original.func(source, param)

    bs._CATALOG[feature_id] = replace(
        original,
        feature_id=feature_id,
        func=counted,
    )
    try:
        params = {"n": 5}
        bs.preview_feature(
            feature_id,
            source_id,
            params=params,
            preview_token="preview-1",
        )
        assert calls == [5]

        [published_id] = bs.apply_feature(
            feature_id,
            [source_id],
            params=params,
            preview_token="preview-1",
        )
        assert calls == [5]
        assert bs.get_last_processing(published_id) is not None

        bs.apply_feature(
            feature_id,
            [source_id],
            params=params,
            preview_token="preview-1",
        )
        assert calls == [5, 5]

        bs.preview_feature(
            feature_id,
            source_id,
            params=params,
            preview_token="preview-2",
        )
        bs.apply_feature(
            feature_id,
            [source_id],
            params={"n": 7},
            preview_token="preview-2",
        )
        assert calls == [5, 5, 5, 7]

        bs.preview_feature(
            feature_id,
            source_id,
            params=params,
            preview_token="preview-3",
        )
        bs.release_preview_result("preview-3")
        bs.apply_feature(
            feature_id,
            [source_id],
            params=params,
            preview_token="preview-3",
        )
        assert calls == [5, 5, 5, 7, 5, 5]

        bs.preview_feature(
            feature_id,
            source_id,
            params=params,
            preview_token="preview-4",
        )
        bs.set_signal_xydata(
            source_id,
            np.arange(32, dtype=float),
            np.arange(32, dtype=float) ** 3,
        )
        bs.apply_feature(
            feature_id,
            [source_id],
            params=params,
            preview_token="preview-4",
        )
        assert calls == [5, 5, 5, 7, 5, 5, 5, 5]
    finally:
        bs._CATALOG.pop(feature_id)


def test_image_preview_matches_published_processing(fresh_bootstrap):
    bs = fresh_bootstrap
    data = np.arange(16 * 12, dtype=float).reshape(12, 16)
    data[0, 0] = -1000.0
    data[-1, -1] = 1000.0
    source_id = bs.add_image_from_array("raw", data, width=16, height=12)
    source = bs._MODEL.get(source_id)
    source.set_coords(np.linspace(0, 30, 16) ** 1.2, np.linspace(0, 20, 12) ** 1.1)
    bs.get_image_data(source_id)
    cached_summary = bs._DATA_SUMMARY_CACHE[source_id]
    revisions_before = dict(bs._DATA_REVISIONS)
    history_before = dict(bs._LAST_PROCESSING)
    tree_before = bs.get_panel_tree("image")
    temporary = bs.preview_feature(
        "image:gaussian_filter",
        source_id,
        params={"sigma": 1.5},
    )

    assert temporary["kind"] == "image"
    assert bs.get_panel_tree("image") == tree_before
    assert bs._LAST_PROCESSING == history_before
    assert bs._DATA_REVISIONS == revisions_before
    assert bs._DATA_SUMMARY_CACHE[source_id] is cached_summary
    assert bs.get_last_processing(source_id) is None
    published_id = bs.apply_feature(
        "image:gaussian_filter", [source_id], params={"sigma": 1.5}
    )[0]
    expected_payload = bs.get_image_data(published_id)
    expected = np.asarray(expected_payload["data"])
    actual = temporary["data"]
    preview_data = np.frombuffer(actual["data"], dtype=np.float32).reshape(
        actual["height"], actual["width"]
    )
    np.testing.assert_allclose(preview_data, expected, rtol=1e-6)
    for key in (
        "title",
        "width",
        "height",
        "dtype",
        "x0",
        "y0",
        "dx",
        "dy",
        "is_uniform_coords",
        "xcoords",
        "ycoords",
        "data_min",
        "data_max",
        "lut_default",
        "xlabel",
        "ylabel",
        "zlabel",
        "xunit",
        "yunit",
        "zunit",
        "colormap",
        "invert_colormap",
        "resample_method",
    ):
        assert actual[key] == expected_payload[key]
    assert actual["is_uniform_coords"] is False
    assert actual["lut_default"] != [actual["data_min"], actual["data_max"]]


def test_image_to_signal_preview_matches_published_processing(fresh_bootstrap):
    bs = fresh_bootstrap
    data = np.arange(9 * 14, dtype=float).reshape(9, 14)
    source_id = bs.add_image_from_array("raw", data, width=14, height=9)
    image_tree_before = bs.get_panel_tree("image")
    signal_tree_before = bs.get_panel_tree("signal")
    params = {"direction": "horizontal", "row": 4, "col": 0}

    temporary = bs.preview_feature(
        "image:line_profile",
        source_id,
        params=params,
    )

    assert temporary["kind"] == "signal"
    assert bs.get_panel_tree("image") == image_tree_before
    assert bs.get_panel_tree("signal") == signal_tree_before
    published_id = bs.apply_feature("image:line_profile", [source_id], params=params)[0]
    expected = bs.get_signal_xy(published_id)
    actual = temporary["data"]
    np.testing.assert_allclose(
        np.frombuffer(actual["x_bytes"], dtype=np.float64), expected["x"]
    )
    np.testing.assert_allclose(
        np.frombuffer(actual["y_bytes"], dtype=np.float64), expected["y"]
    )


@pytest.mark.parametrize(
    "data",
    [np.full((4, 5), 7.0), np.full((4, 5), np.nan)],
    ids=["constant", "all-nan"],
)
def test_image_preview_handles_degenerate_data_without_warnings(fresh_bootstrap, data):
    bs = fresh_bootstrap
    source_id = bs.add_image_from_array("degenerate", data)
    feature_id = "image:test_identity_preview"
    bs._CATALOG[feature_id] = replace(
        bs._CATALOG["image:gaussian_filter"],
        feature_id=feature_id,
        paramclass=None,
        func=lambda source: source,
    )
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            temporary = bs.preview_feature(feature_id, source_id)
    finally:
        bs._CATALOG.pop(feature_id)

    assert caught == []
    actual = temporary["data"]
    preview_data = np.frombuffer(actual["data"], dtype=np.float32).reshape(
        actual["height"], actual["width"]
    )
    np.testing.assert_allclose(preview_data, data, equal_nan=True)
    if np.isnan(data).all():
        assert np.isnan(actual["data_min"])
        assert np.isnan(actual["data_max"])
        assert np.isnan(actual["lut_default"]).all()
    else:
        assert actual["data_min"] == 7.0
        assert actual["data_max"] == 7.0
        assert actual["lut_default"] == [7.0, 7.0]


def test_preview_rejects_unknown_non_unary_and_disabled_features(fresh_bootstrap):
    bs = fresh_bootstrap
    source_id = bs.add_signal_from_arrays("raw", [0, 1], [1, 2])

    with pytest.raises(ValueError, match="Unknown preview feature"):
        bs.preview_feature("does_not_exist", source_id)
    with pytest.raises(ValueError, match="1-to-1"):
        bs.preview_feature("average", source_id)

    feature_id = "test_disabled_preview"
    bs._CATALOG[feature_id] = replace(
        bs._CATALOG["normalize"],
        feature_id=feature_id,
        preview_enabled=False,
    )
    try:
        with pytest.raises(ValueError, match="disabled"):
            bs.preview_feature(feature_id, source_id)
    finally:
        bs._CATALOG.pop(feature_id)
