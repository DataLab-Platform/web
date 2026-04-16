# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the feature catalogue and the apply_feature dispatcher."""

from __future__ import annotations

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
