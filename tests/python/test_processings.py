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


def test_image_analysis_blob_detectors_share_submenu(bootstrap_module):
    bs = bootstrap_module
    entries = {e["id"]: e for e in bs.list_image_analysis()}
    # The four blob detectors are grouped under a "Blob detection" submenu
    # to mirror the DataLab desktop "Analysis > Blob detection" sub-menu.
    for fid in ("blob_dog", "blob_doh", "blob_log", "blob_opencv"):
        assert fid in entries, f"{fid!r} missing from image-analysis catalogue"
        assert entries[fid]["submenu"] == "Blob detection"
    # Non-blob analyses stay at the top level (no submenu).
    assert entries["centroid"]["submenu"] is None


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
# Group-exclusive processing — mirrors DataLab desktop: selecting group(s)
# and applying a processing creates new result group(s) titled after the
# processing, holding the per-object (or per-group aggregated) results.
# ---------------------------------------------------------------------------


def _groups_by_gid(bs, kind="signal"):
    return {g["gid"]: g for g in bs.get_panel_tree(kind)["groups"]}


def _result_group(bs, new_ids, kind="signal"):
    """Return the single group whose objects are exactly *new_ids*."""
    matches = [
        g
        for g in bs.get_panel_tree(kind)["groups"]
        if {o["id"] for o in g["objects"]} == set(new_ids)
    ]
    assert len(matches) == 1, f"expected one result group, got {len(matches)}"
    return matches[0]


def test_apply_1_to_1_on_group_creates_result_group(fresh_bootstrap):
    bs = fresh_bootstrap
    x = np.linspace(0, 1, 32)
    g1 = bs.create_group("signal", "G1")
    a = bs.add_signal_from_arrays("a", x, np.linspace(0, 10, 32), group_id=g1)
    b = bs.add_signal_from_arrays("b", x, np.linspace(0, 5, 32), group_id=g1)
    new_ids = bs.apply_feature("normalize", [a, b], group_ids=[g1])
    assert len(new_ids) == 2
    # Source group is untouched...
    assert len(_groups_by_gid(bs)[g1]["objects"]) == 2
    # ...and a new result group holds both results, titled after the
    # processing function with the source gid embedded (clickable link).
    rg = _result_group(bs, new_ids)
    assert rg["gid"] != g1
    assert rg["name"].startswith("normalize(")
    assert g1 in rg["name"]


def test_apply_1_to_1_on_multiple_groups_creates_one_group_each(fresh_bootstrap):
    bs = fresh_bootstrap
    x = np.linspace(0, 1, 32)
    g1 = bs.create_group("signal", "G1")
    a = bs.add_signal_from_arrays("a", x, np.linspace(0, 10, 32), group_id=g1)
    g2 = bs.create_group("signal", "G2")
    b = bs.add_signal_from_arrays("b", x, np.linspace(0, 5, 32), group_id=g2)
    new_ids = bs.apply_feature("normalize", [a, b], group_ids=[g1, g2])
    assert len(new_ids) == 2
    groups = {g["name"]: g for g in bs.get_panel_tree("signal")["groups"]}
    assert f"normalize({g1})" in groups
    assert f"normalize({g2})" in groups
    assert len(groups[f"normalize({g1})"]["objects"]) == 1
    assert len(groups[f"normalize({g2})"]["objects"]) == 1


def test_apply_n_to_1_on_groups_aggregates_per_group(fresh_bootstrap):
    bs = fresh_bootstrap
    x = np.linspace(0, 1, 50)
    g1 = bs.create_group("signal", "G1")
    bs.add_signal_from_arrays("a1", x, np.zeros_like(x), group_id=g1)
    bs.add_signal_from_arrays("a2", x, np.ones_like(x) * 2, group_id=g1)
    g2 = bs.create_group("signal", "G2")
    bs.add_signal_from_arrays("b1", x, np.ones_like(x) * 4, group_id=g2)
    bs.add_signal_from_arrays("b2", x, np.ones_like(x) * 6, group_id=g2)
    src_ids = [
        o["id"] for g in bs.get_panel_tree("signal")["groups"] for o in g["objects"]
    ]
    new_ids = bs.apply_feature("average", src_ids, group_ids=[g1, g2])
    # One aggregated result per source group, in a single result group.
    assert len(new_ids) == 2
    rg = _result_group(bs, new_ids)
    assert rg["name"].startswith("average(")
    assert g1 in rg["name"] and g2 in rg["name"]
    means = sorted(float(np.mean(bs.get_signal_xy(oid)["y"])) for oid in new_ids)
    np.testing.assert_allclose(means, [1.0, 5.0])


def test_apply_2_to_1_on_group_creates_result_group(fresh_bootstrap):
    bs = fresh_bootstrap
    x = np.linspace(0, 1, 32)
    g1 = bs.create_group("signal", "G1")
    a = bs.add_signal_from_arrays("a", x, np.ones_like(x), group_id=g1)
    b = bs.add_signal_from_arrays("b", x, np.ones_like(x) * 3, group_id=g1)
    operand = bs.add_signal_from_arrays("op", x, np.ones_like(x))
    new_ids = bs.apply_feature("difference", [a, b], operand_id=operand, group_ids=[g1])
    assert len(new_ids) == 2
    rg = _result_group(bs, new_ids)
    assert rg["name"].startswith("difference(")
    assert g1 in rg["name"]


def test_apply_on_group_falls_back_when_group_ids_empty(fresh_bootstrap):
    bs = fresh_bootstrap
    x = np.linspace(0, 1, 32)
    g1 = bs.create_group("signal", "G1")
    a = bs.add_signal_from_arrays("a", x, np.linspace(0, 10, 32), group_id=g1)
    # No group_ids → legacy behaviour: result lands in the source group.
    new_ids = bs.apply_feature("normalize", [a])
    assert len(new_ids) == 1
    assert new_ids[0] in {o["id"] for o in _groups_by_gid(bs)[g1]["objects"]}


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


# ---------------------------------------------------------------------------
# Radial profile — the parameter dialog must bind to the source image so the
# centre coordinates pre-fill and recompute exactly like DataLab desktop's
# ``RadialProfileParam`` (no graphical preview; plain DataSet dialog).
# ---------------------------------------------------------------------------


def test_radial_profile_schema_binds_source_object(fresh_bootstrap):
    """``get_feature_schema`` with a source oid binds the image so the
    centre coordinates derive from it (``RadialProfileParam.update_from_obj``
    + the default ``"centroid"`` callback), matching DataLab desktop.
    """
    bs = fresh_bootstrap
    data = np.zeros((64, 48), dtype=float)
    # Off-centre bright blob so the centroid is well-defined and non-zero.
    data[10:16, 4:10] = 1000.0
    src = bs.add_image_from_array("img", data, width=48, height=64)
    # Without binding: the callback no-ops, so x0/y0 stay at their defaults.
    bare = bs.get_feature_schema("image:radial_profile")
    assert bare["values"]["x0"] == 0.0
    assert bare["values"]["y0"] == 0.0
    # With binding: the default "centroid" mode resolves to the blob centroid.
    bound = bs.get_feature_schema("image:radial_profile", src)
    assert bound["values"]["x0"] > 0.0
    assert bound["values"]["y0"] > 0.0
    assert bound["values"]["x0"] < 24.0  # left of the geometric centre
    assert bound["values"]["y0"] < 32.0  # above the geometric centre


def test_radial_profile_callback_recomputes_centre(fresh_bootstrap):
    """Switching the centre mode recomputes ``x0``/``y0`` via the bound
    source object, mirroring ``RadialProfileParam.choice_callback``.
    """
    bs = fresh_bootstrap
    data = np.zeros((64, 48), dtype=float)
    # Off-centre bright blob so the centroid differs from the geometric centre.
    data[10:16, 4:10] = 1000.0
    src = bs.add_image_from_array("img", data, width=48, height=64)
    # "center" mode resets x0/y0 to the geometric centre even from stale 0,0.
    centred = bs.resolve_feature_callbacks(
        "image:radial_profile",
        "center",
        {"center": "center", "x0": 0.0, "y0": 0.0},
        src,
    )
    assert centred["x0"] == pytest.approx(24.0)
    assert centred["y0"] == pytest.approx(32.0)
    # "centroid" mode computes the intensity centroid (near the blob).
    centroid = bs.resolve_feature_callbacks(
        "image:radial_profile",
        "center",
        {"center": "centroid", "x0": 0.0, "y0": 0.0},
        src,
    )
    assert centroid["x0"] < 24.0
    assert centroid["y0"] < 32.0
