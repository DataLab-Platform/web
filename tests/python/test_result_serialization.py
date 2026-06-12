# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for analysis-result serialization (``_serialize_result``).

The displayed table view must mirror DataLab desktop (Qt): a geometry
``segment`` result (e.g. FWHM) collapses to a single ``Δx`` column via
Sigima's ``to_dataframe(visible_only=True)``, while the raw ``coords``
are still shipped for the plot overlays.
"""

from __future__ import annotations

import asyncio

import numpy as np


def _make_gaussian(bs, title: str = "g") -> str:
    """Create a Gaussian signal and return its object id."""
    x = np.linspace(-10, 10, 201)
    y = np.exp(-(x**2) / 2.0)
    return bs.add_signal_from_arrays(title, x, y)


def test_fwhm_result_shows_single_delta_column(fresh_bootstrap):
    """FWHM (segment) is displayed as one Δx column, like DataLab Qt."""
    bs = fresh_bootstrap
    oid = _make_gaussian(bs)
    asyncio.run(bs.run_signal_analysis(oid, "fwhm"))

    results = bs.list_signal_results(oid)
    assert len(results) == 1
    res = results[0]

    assert res["category"] == "geometry"
    assert res["kind"] == "segment"

    # Displayed table: a single derived column (Δx / Δy / length), NOT
    # the four raw x0/y0/x1/y1 coordinates.
    assert res["headers"] == ["Δx"]
    assert len(res["data"]) == 1
    assert len(res["data"][0]) == 1
    # The FWHM of a unit-variance Gaussian is 2*sqrt(2*ln 2) ≈ 2.3548;
    # allow a generous margin for the discrete-sampling estimate.
    np.testing.assert_allclose(res["data"][0][0], 2.3548, atol=0.1)

    # Raw coordinates are still shipped (used by the plot overlay) as the
    # full segment [x0, y0, x1, y1].
    assert len(res["coords"]) == 1
    assert len(res["coords"][0]) == 4
