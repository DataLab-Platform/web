# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the feature catalogue and the apply_feature dispatcher."""

from __future__ import annotations

import re

import numpy as np
import pytest


def test_list_features_returns_metadata_records(bootstrap_module):
    bs = bootstrap_module
    feats = bs.list_features()
    assert feats
    sample = feats[0]
    for key in ("id", "label", "menu_path", "pattern"):
        assert key in sample


def test_known_signal_features_present(bootstrap_module):
    bs = bootstrap_module
    ids = {f["id"] for f in bs.list_features()}
    # A handful of well-known Sigima signal processings registered by
    # the curated overrides — see ``processor.SIGNAL_OVERRIDES``.
    for expected in ("normalize", "fft", "moving_average", "addition"):
        assert expected in ids, f"feature {expected!r} missing from catalogue"


def test_apply_normalize_returns_new_signal(fresh_bootstrap):
    bs = fresh_bootstrap
    src = bs.add_signal_from_arrays(
        "raw", np.linspace(0, 1, 64), np.linspace(0, 10, 64)
    )
    new_ids = bs.apply_feature("normalize", [src])
    assert len(new_ids) == 1
    new_oid = new_ids[0]
    assert new_oid != src
    payload = bs.get_signal_xy(new_oid)
    # Default normalisation method is min-max (0..1 range).
    assert max(payload["y"]) == pytest.approx(1.0, abs=1e-6)
    assert min(payload["y"]) == pytest.approx(0.0, abs=1e-6)


def test_apply_unknown_feature_raises(fresh_bootstrap):
    bs = fresh_bootstrap
    src = bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    with pytest.raises(ValueError):
        bs.apply_feature("does_not_exist", [src])


def test_apply_feature_requires_at_least_one_source(fresh_bootstrap):
    bs = fresh_bootstrap
    with pytest.raises(ValueError):
        bs.apply_feature("normalize", [])


def test_apply_n_to_1_average(fresh_bootstrap):
    bs = fresh_bootstrap
    x = np.linspace(0, 1, 50)
    a = bs.add_signal_from_arrays("a", x, np.zeros_like(x))
    b = bs.add_signal_from_arrays("b", x, np.ones_like(x) * 2)
    new_ids = bs.apply_feature("average", [a, b])
    assert len(new_ids) == 1
    avg = bs.get_signal_xy(new_ids[0])
    np.testing.assert_allclose(avg["y"], np.ones(50))


def test_get_last_processing_records_feature(fresh_bootstrap):
    bs = fresh_bootstrap
    src = bs.add_signal_from_arrays("S", np.linspace(0, 1, 32), np.linspace(0, 1, 32))
    new_id = bs.apply_feature("normalize", [src])[0]
    record = bs.get_last_processing(new_id)
    assert record is not None
    assert record["feature_id"] == "normalize"
    assert record["source_ids"] == [src]


def test_get_last_processing_returns_none_for_originals(fresh_bootstrap):
    bs = fresh_bootstrap
    src = bs.add_signal_from_arrays("S", [0, 1], [0, 0])
    assert bs.get_last_processing(src) is None


def test_reapply_last_processing_replaces_object_in_place(fresh_bootstrap):
    """``reapply_last_processing`` keeps the *same* oid (in-place swap).

    This preserves tree selection / plot anchoring on the React side.
    """
    bs = fresh_bootstrap
    src = bs.add_signal_from_arrays("S", np.linspace(0, 1, 32), np.linspace(0, 1, 32))
    first = bs.apply_feature("normalize", [src])[0]
    again = bs.reapply_last_processing(first)
    assert again == first  # same oid
    assert bs.get_last_processing(again) is not None


def test_get_feature_schema_for_parametric_feature(bootstrap_module):
    bs = bootstrap_module
    schema = bs.get_feature_schema("moving_average")
    assert schema is not None
    assert "schema" in schema and "values" in schema


def test_list_processings_returns_signal_only(bootstrap_module):
    bs = bootstrap_module
    procs = bs.list_processings()
    # ``list_processings`` is the legacy signal-only catalogue.
    assert procs
    for p in procs:
        assert "id" in p and "label" in p


# ---------------------------------------------------------------------------
# Title placeholder substitution — mirrors the DataLab desktop behaviour
# (Sigima's ``PlaceholderTitleFormatter`` + ``patch_title_with_ids``).
# ---------------------------------------------------------------------------


def _assert_title_resolved(title: str, *src_oids: str) -> None:
    """All source oids must appear in *title* and no ``{n}`` placeholders left."""
    assert not re.search(r"\{\d+\}", title), f"unresolved placeholder in: {title!r}"
    for oid in src_oids:
        assert oid in title, f"source oid {oid!r} missing in title: {title!r}"


def test_apply_1_to_1_title_embeds_source_oid(fresh_bootstrap):
    bs = fresh_bootstrap
    src = bs.add_signal_from_arrays(
        "raw", np.linspace(0, 1, 32), np.linspace(0, 10, 32)
    )
    new_oid = bs.apply_feature("normalize", [src])[0]
    _assert_title_resolved(bs.get_object_meta(new_oid)["title"], src)


def test_apply_2_to_1_title_embeds_both_source_oids(fresh_bootstrap):
    bs = fresh_bootstrap
    x = np.linspace(0, 1, 32)
    a = bs.add_signal_from_arrays("a", x, np.ones_like(x))
    b = bs.add_signal_from_arrays("b", x, np.zeros_like(x))
    new_oid = bs.apply_feature("difference", [a], operand_id=b)[0]
    _assert_title_resolved(bs.get_object_meta(new_oid)["title"], a, b)


def test_apply_n_to_1_title_embeds_all_source_oids(fresh_bootstrap):
    bs = fresh_bootstrap
    x = np.linspace(0, 1, 32)
    a = bs.add_signal_from_arrays("a", x, np.zeros_like(x))
    b = bs.add_signal_from_arrays("b", x, np.ones_like(x) * 2)
    new_oid = bs.apply_feature("average", [a, b])[0]
    _assert_title_resolved(bs.get_object_meta(new_oid)["title"], a, b)


# ---------------------------------------------------------------------------
# ROI extraction & erase — these go through dedicated bootstrap helpers
# (``extract_signal_rois`` / ``extract_image_rois`` / ``erase_image_area``)
# rather than ``apply_feature``, so they must also resolve the ``{n}``
# placeholders emitted by Sigima's ``PlaceholderTitleFormatter``.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("merged", [False, True])
def test_extract_signal_rois_title_resolves_placeholder(fresh_bootstrap, merged):
    bs = fresh_bootstrap
    x = np.linspace(0, 10, 128)
    src = bs.add_signal_from_arrays("raw", x, np.sin(x))
    bs.set_signal_roi(src, [{"xmin": 1.0, "xmax": 4.0}, {"xmin": 6.0, "xmax": 9.0}])
    out_ids = bs.extract_signal_rois(src, merged)
    assert out_ids
    for oid in out_ids:
        _assert_title_resolved(bs.get_object_meta(oid)["title"], src)


@pytest.mark.parametrize("merged", [False, True])
def test_extract_image_rois_title_resolves_placeholder(fresh_bootstrap, merged):
    bs = fresh_bootstrap
    data = np.arange(64 * 64, dtype=float).reshape(64, 64)
    src = bs.add_image_from_array("img", data, width=64, height=64)
    bs.set_image_roi(
        src,
        [
            {"geometry": "rectangle", "x0": 4, "y0": 4, "dx": 20, "dy": 20},
            {"geometry": "rectangle", "x0": 32, "y0": 32, "dx": 20, "dy": 20},
        ],
    )
    out_ids = bs.extract_image_rois(src, merged)
    assert out_ids
    for oid in out_ids:
        _assert_title_resolved(bs.get_object_meta(oid)["title"], src)


def test_erase_image_area_title_resolves_placeholder(fresh_bootstrap):
    bs = fresh_bootstrap
    data = np.arange(64 * 64, dtype=float).reshape(64, 64)
    src = bs.add_image_from_array("img", data, width=64, height=64)
    new_oid = bs.erase_image_area(
        src, [{"geometry": "rectangle", "x0": 8, "y0": 8, "dx": 16, "dy": 16}]
    )
    _assert_title_resolved(bs.get_object_meta(new_oid)["title"], src)
