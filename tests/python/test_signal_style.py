"""Tests for the per-curve style helpers (``set_signal_style``)."""

from __future__ import annotations

import numpy as np
import pytest


def test_set_signal_style_round_trip(fresh_bootstrap):
    bs = fresh_bootstrap
    x = np.linspace(0, 1, 10)
    oid = bs.add_signal_from_arrays("S", x, np.sin(x))

    # Default: every field is None.
    assert bs.get_signal_xy(oid)["style"] == {
        "color": None,
        "linestyle": None,
        "linewidth": None,
        "curvestyle": None,
    }

    # Set everything; fields are written to canonical metadata keys.
    bs.set_signal_style(
        oid,
        color="#ff7f0e",
        linestyle="DashLine",
        linewidth=2.5,
        curvestyle="Sticks",
    )
    assert bs.get_signal_xy(oid)["style"] == {
        "color": "#ff7f0e",
        "linestyle": "DashLine",
        "linewidth": 2.5,
        "curvestyle": "Sticks",
    }


def test_set_signal_style_clears_when_none(fresh_bootstrap):
    bs = fresh_bootstrap
    x = np.linspace(0, 1, 10)
    oid = bs.add_signal_from_arrays("S", x, np.sin(x))
    bs.set_signal_style(
        oid,
        color="#ff7f0e",
        linestyle="DashLine",
        linewidth=2.5,
        curvestyle="Sticks",
    )
    # Per-field clear (keep some, drop others).
    bs.set_signal_style(oid, linestyle=None, linewidth=None)
    style = bs.get_signal_xy(oid)["style"]
    assert style["color"] is None  # default-None clears too
    assert style["linestyle"] is None
    assert style["linewidth"] is None
    assert style["curvestyle"] is None


def test_set_signal_style_clears_alias_keys(fresh_bootstrap):
    bs = fresh_bootstrap
    x = np.linspace(0, 1, 10)
    oid = bs.add_signal_from_arrays("S", x, np.sin(x))
    obj = bs._MODEL.get(oid)  # noqa: SLF001
    # Pre-populate the legacy / aliased keys to verify they are wiped.
    obj.metadata["curvecolor"] = "#abcdef"
    obj.metadata["line_style"] = "DashLine"
    obj.metadata["line_width"] = 1.5
    obj.metadata["curve_style"] = "Lines"
    bs.set_signal_style(oid)  # all-None: clears everything
    md = obj.metadata
    for key in (
        "color",
        "curvecolor",
        "linestyle",
        "line_style",
        "linewidth",
        "line_width",
        "curvestyle",
        "curve_style",
    ):
        assert key not in md, f"expected {key!r} to be cleared"


def test_set_signal_style_invalid_linewidth(fresh_bootstrap):
    bs = fresh_bootstrap
    x = np.linspace(0, 1, 10)
    oid = bs.add_signal_from_arrays("S", x, np.sin(x))
    with pytest.raises(ValueError):
        bs.set_signal_style(oid, linewidth="not-a-number")
