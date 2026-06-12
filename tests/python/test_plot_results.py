# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the "Analysis ▸ Plot results" aggregation helpers.

Mirrors DataLab desktop's ``BasePanel.plot_results``: analysis results
stored on the selected objects are aggregated into new result signals,
grouped in a dedicated "Results" signal group.
"""

from __future__ import annotations

import asyncio

import numpy as np


def _make_signal(bs, title: str, scale: float):
    """Create a Gaussian-like signal and return its object id."""
    x = np.linspace(-5, 5, 128)
    y = scale * np.exp(-(x**2))
    return bs.add_signal_from_arrays(title, x, y)


def _run_stats(bs, oid: str) -> None:
    """Run the (non-parametric) ``stats`` analysis on signal *oid*."""
    asyncio.run(bs.run_signal_analysis(oid, "stats"))


def test_get_plot_results_schemas_empty_without_results(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = _make_signal(bs, "s", 1.0)
    assert bs.get_plot_results_schemas([oid]) == []


def test_get_plot_results_schemas_lists_numeric_columns(fresh_bootstrap):
    bs = fresh_bootstrap
    s1 = _make_signal(bs, "s1", 1.0)
    s2 = _make_signal(bs, "s2", 2.0)
    _run_stats(bs, s1)
    _run_stats(bs, s2)

    schemas = bs.get_plot_results_schemas([s1, s2])
    assert schemas, "expected at least one plottable result category"
    entry = schemas[0]
    assert entry["numeric_headers"], "stats should expose numeric columns"
    # One value per object (single ROI) ⇒ default to one curve per title.
    assert entry["default_kind"] == "one_curve_per_title"
    assert entry["is_geometry"] is False


def test_plot_results_one_curve_per_title(fresh_bootstrap):
    bs = fresh_bootstrap
    s1 = _make_signal(bs, "s1", 1.0)
    s2 = _make_signal(bs, "s2", 2.0)
    _run_stats(bs, s1)
    _run_stats(bs, s2)

    entry = bs.get_plot_results_schemas([s1, s2])[0]
    yaxis = entry["numeric_headers"][0]
    new_ids = bs.plot_results(
        [s1, s2],
        entry["category"],
        "one_curve_per_title",
        "indices",
        yaxis,
        "Results",
    )
    # One title aggregated across the two objects ⇒ a single result curve.
    assert len(new_ids) == 1
    payload = bs.get_signal_xy(new_ids[0])
    assert len(payload["y"]) == 2  # one point per source object

    # The result signal lands in a get-or-create "Results" signal group.
    tree = bs.get_panel_tree("signal")
    results_group = next((g for g in tree["groups"] if g["name"] == "Results"), None)
    assert results_group is not None
    assert new_ids[0] in [o["id"] for o in results_group["objects"]]


def test_plot_results_one_curve_per_object(fresh_bootstrap):
    bs = fresh_bootstrap
    s1 = _make_signal(bs, "s1", 1.0)
    s2 = _make_signal(bs, "s2", 2.0)
    _run_stats(bs, s1)
    _run_stats(bs, s2)

    entry = bs.get_plot_results_schemas([s1, s2])[0]
    yaxis = entry["numeric_headers"][0]
    new_ids = bs.plot_results(
        [s1, s2],
        entry["category"],
        "one_curve_per_object",
        "indices",
        yaxis,
        "Results",
    )
    # One curve per object (each with a single ROI / row).
    assert len(new_ids) == 2


def test_plot_results_reuses_existing_results_group(fresh_bootstrap):
    bs = fresh_bootstrap
    s1 = _make_signal(bs, "s1", 1.0)
    _run_stats(bs, s1)
    entry = bs.get_plot_results_schemas([s1])[0]
    yaxis = entry["numeric_headers"][0]

    bs.plot_results(
        [s1], entry["category"], "one_curve_per_object", "indices", yaxis, "Results"
    )
    bs.plot_results(
        [s1], entry["category"], "one_curve_per_object", "indices", yaxis, "Results"
    )
    tree = bs.get_panel_tree("signal")
    results_groups = [g for g in tree["groups"] if g["name"] == "Results"]
    assert len(results_groups) == 1  # group is reused, not duplicated
