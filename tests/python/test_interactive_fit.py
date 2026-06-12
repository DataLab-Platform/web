# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the interactive-fit helpers (``dlw_interactive_fit``).

The module exposes a JSON-friendly fitting API consumed by the React
``InteractiveFitDialog``. These tests drive a Gaussian signal through
the full session lifecycle (catalogue → init → evaluate → auto-fit →
commit) under CPython, with the live ``_MODEL`` borrowed from a fresh
bootstrap and published on ``__main__`` (where ``_get_model`` reads it).
"""

from __future__ import annotations

import sys

import dlw_interactive_fit as ifit
import numpy as np
import pytest


def _gaussian_xy():
    """Return a clean Gaussian (amp=3, mu=0.5, sigma=0.8, y0=0.1)."""
    x = np.linspace(-5.0, 5.0, 200)
    y = 3.0 * np.exp(-((x - 0.5) ** 2) / (2.0 * 0.8**2)) + 0.1
    return x, y


@pytest.fixture
def fit_session(fresh_bootstrap, monkeypatch):
    """Create a Gaussian signal and expose ``_MODEL`` on ``__main__``."""
    bs = fresh_bootstrap
    main_mod = sys.modules["__main__"]
    monkeypatch.setattr(main_mod, "_MODEL", bs._MODEL, raising=False)
    x, y = _gaussian_xy()
    oid = bs.add_signal_from_arrays("Gaussian", x, y)
    return bs, oid


# ---------------------------------------------------------------------------
# Catalogue
# ---------------------------------------------------------------------------


def test_list_interactive_fits_catalogue():
    fits = ifit.list_interactive_fits()
    ids = {f["id"] for f in fits}
    assert {"linear_fit", "gaussian_fit", "polynomial_fit"} <= ids
    # Each entry exposes the menu-rendering contract.
    for entry in fits:
        assert set(entry) == {"id", "label", "needs_degree"}
    poly = next(f for f in fits if f["id"] == "polynomial_fit")
    assert poly["needs_degree"] is True


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------


def test_init_interactive_fit_returns_session(fit_session):
    _bs, oid = fit_session
    session = ifit.init_interactive_fit(oid, "gaussian_fit")
    assert session["fit_id"] == "gaussian_fit"
    assert len(session["x"]) == len(session["y"]) == 200
    assert len(session["y_fit"]) == 200
    assert session["params"]  # at least one slider row
    for row in session["params"]:
        assert set(row) >= {"name", "label", "value", "min", "max"}
        # The initial value always lies within the slider bounds.
        assert row["min"] <= row["value"] <= row["max"]


def test_evaluate_interactive_fit_matches_length(fit_session):
    _bs, oid = fit_session
    session = ifit.init_interactive_fit(oid, "gaussian_fit")
    values = {p["name"]: p["value"] for p in session["params"]}
    x = session["x"]
    y_eval = ifit.evaluate_interactive_fit("gaussian_fit", x, values)
    assert len(y_eval) == len(x)
    assert all(np.isfinite(y_eval))


def test_auto_fit_recovers_gaussian_params(fit_session):
    _bs, oid = fit_session
    result = ifit.auto_fit_interactive(oid, "gaussian_fit")
    assert len(result["y_fit"]) == 200
    # The optimiser should fit clean synthetic data almost exactly.
    assert result["residual_rms"] < 1e-3
    # The fitted curve reproduces the source Gaussian (peak ≈ 3.1, the
    # 3.0 amplitude plus the 0.1 offset) — independent of how Sigima
    # parametrises the model internally.
    _x, y = _gaussian_xy()
    assert abs(max(result["y_fit"]) - float(y.max())) < 0.05


def test_commit_interactive_fit_adds_signal(fit_session):
    bs, oid = fit_session
    before = len(bs.get_object_uuids("signal"))
    session = ifit.init_interactive_fit(oid, "gaussian_fit")
    values = {p["name"]: p["value"] for p in session["params"]}
    new_oid = ifit.commit_interactive_fit(oid, "gaussian_fit", values)
    assert new_oid != oid
    after = bs.get_object_uuids("signal")
    assert len(after) == before + 1
    assert new_oid in after
    # The committed signal carries interactive-fit metadata.
    obj = bs._MODEL.get(new_oid)
    assert obj.metadata["fit_params"]["interactive"] is True


def test_evaluate_polynomial_uses_degree(fit_session):
    _bs, oid = fit_session
    session = ifit.init_interactive_fit(oid, "polynomial_fit", {"degree": 2})
    values = {p["name"]: p["value"] for p in session["params"]}
    y_eval = ifit.evaluate_interactive_fit(
        "polynomial_fit", session["x"], values, {"degree": 2}
    )
    assert len(y_eval) == len(session["x"])
    assert all(np.isfinite(y_eval))
