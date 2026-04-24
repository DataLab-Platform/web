# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""
Interactive fitting helpers for DataLab-Web.

Mirrors the desktop application's "Processing > Fitting > Interactive
fitting" submenu.  The Qt version uses :class:`plotpy.widgets.fit.FitDialog`,
which is not available in the browser, so this module exposes a JSON-friendly
API (``init_interactive_fit``, ``evaluate_interactive_fit``,
``auto_fit_interactive``, ``commit_interactive_fit``) that the React
:component:`InteractiveFitDialog` consumes.

All algorithms are reused unchanged from
:mod:`sigima.tools.signal.fitting` (the same ``FitComputer`` family that
powers the headless / automatic fits).
"""

from __future__ import annotations

import sys
from typing import Any

import numpy as np
from sigima.tools.signal import fitting as _fit

# ---------------------------------------------------------------------------
# Catalogue of interactive fit kinds
# ---------------------------------------------------------------------------


class _FitKind:
    """One interactive fit kind: label + computer factory."""

    # Holder dataclass-style — a single ``make_computer`` method is enough.
    # pylint: disable=too-few-public-methods

    def __init__(
        self,
        fit_id: str,
        label: str,
        computer: type[_fit.FitComputer],
        param_labels: dict[str, str] | None = None,
        needs_degree: bool = False,
    ) -> None:
        self.fit_id = fit_id
        self.label = label
        self.computer = computer
        self.param_labels = param_labels or {}
        self.needs_degree = needs_degree

    def make_computer(
        self, x: np.ndarray, y: np.ndarray, extras: dict[str, Any] | None
    ) -> _fit.FitComputer:
        """Instantiate the wrapped computer with the parameters from *extras*."""
        if self.needs_degree:
            degree = int((extras or {}).get("degree", 3))
            return self.computer(x, y, degree=degree)  # type: ignore[call-arg]
        return self.computer(x, y)


# Common pretty parameter labels (Greek letters etc.).
_PRETTY_PARAMS: dict[str, str] = {
    "amp": "A",
    "sigma": "σ",
    "x0": "μ",
    "y0": "y₀",
    "a": "a",
    "b": "b",
    "c": "c",
    "phase": "φ",
    "freq": "f",
    "T": "T",
    "tau": "τ",
    "tau1": "τ₁",
    "tau2": "τ₂",
}

_INTERACTIVE_FITS: dict[str, _FitKind] = {
    "linear_fit": _FitKind("linear_fit", "Linear fit", _fit.LinearFitComputer),
    "polynomial_fit": _FitKind(
        "polynomial_fit",
        "Polynomial fit",
        _fit.PolynomialFitComputer,
        needs_degree=True,
    ),
    "gaussian_fit": _FitKind("gaussian_fit", "Gaussian fit", _fit.GaussianFitComputer),
    "lorentzian_fit": _FitKind(
        "lorentzian_fit", "Lorentzian fit", _fit.LorentzianFitComputer
    ),
    "voigt_fit": _FitKind("voigt_fit", "Voigt fit", _fit.VoigtFitComputer),
    "exponential_fit": _FitKind(
        "exponential_fit", "Exponential fit", _fit.ExponentialFitComputer
    ),
    "sinusoidal_fit": _FitKind(
        "sinusoidal_fit", "Sinusoidal fit", _fit.SinusoidalFitComputer
    ),
    "planckian_fit": _FitKind(
        "planckian_fit", "Planckian fit", _fit.PlanckianFitComputer
    ),
    "twohalfgaussian_fit": _FitKind(
        "twohalfgaussian_fit",
        "Two half-Gaussians fit",
        _fit.TwoHalfGaussianFitComputer,
    ),
    "cdf_fit": _FitKind("cdf_fit", "CDF fit", _fit.CDFFitComputer),
    "sigmoid_fit": _FitKind("sigmoid_fit", "Sigmoid fit", _fit.SigmoidFitComputer),
    "piecewiseexponential_fit": _FitKind(
        "piecewiseexponential_fit",
        "Piecewise exponential fit",
        _fit.DoubleExponentialFitComputer,
    ),
}


# ---------------------------------------------------------------------------
# Public API (called from runtime.ts via ``callPy``)
# ---------------------------------------------------------------------------


def list_interactive_fits() -> list[dict[str, Any]]:
    """Return the menu catalogue of interactive fits."""
    return [
        {
            "id": k.fit_id,
            "label": k.label,
            "needs_degree": k.needs_degree,
        }
        for k in _INTERACTIVE_FITS.values()
    ]


def _pretty_label(name: str) -> str:
    return _PRETTY_PARAMS.get(name, name)


def _make_param_descriptors(
    computer: _fit.FitComputer,
    initial: dict[str, float],
    bounds: list[tuple[float, float]] | None,
) -> list[dict[str, Any]]:
    """Pack initial values + bounds into JSON-friendly slider rows."""
    names = computer.get_params_names()
    descriptors: list[dict[str, Any]] = []
    for idx, name in enumerate(names):
        value = float(initial[name])
        if bounds is not None and idx < len(bounds):
            lo, hi = float(bounds[idx][0]), float(bounds[idx][1])
        else:
            # Fallback: ±2× current value (unbounded params).
            span = max(abs(value) * 2.0, 1.0)
            lo, hi = value - span, value + span
        # Always make sure value stays inside [lo, hi].
        lo = min(lo, value)
        hi = max(hi, value)
        descriptors.append(
            {
                "name": name,
                "label": _pretty_label(name),
                "value": value,
                "min": lo,
                "max": hi,
            }
        )
    return descriptors


def _resolve_signal(oid_or_obj: Any) -> Any:
    """Resolve *oid_or_obj* to a SignalObj using the live model."""
    if isinstance(oid_or_obj, str):
        return _get_model().get(oid_or_obj)
    return oid_or_obj


def _get_model() -> Any:
    """Return the live ``_MODEL`` instance owned by ``bootstrap.py``.

    Bootstrap runs as ``__main__`` (not as an importable module), so we
    fish ``_MODEL`` out of its module namespace via :mod:`sys`.
    """
    main = sys.modules.get("__main__")
    model = getattr(main, "_MODEL", None)
    if model is None:
        raise RuntimeError(
            "DataLab-Web object model not initialised: bootstrap not run yet."
        )
    return model


def _roi_xy(obj: Any) -> tuple[np.ndarray, np.ndarray]:
    """Return X / Y restricted to the active ROI (full data otherwise)."""
    masked = obj.get_masked_view()
    x_roi = obj.x[~masked.mask] if hasattr(masked, "mask") else obj.x
    y_roi = masked.compressed() if hasattr(masked, "compressed") else obj.y
    if x_roi.size == 0:
        x_roi = obj.x
        y_roi = obj.y
    return np.asarray(x_roi, dtype=float), np.asarray(y_roi, dtype=float)


def init_interactive_fit(
    oid: str, fit_id: str, extras: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Initialise an interactive fit session.

    Returns the source X / Y arrays (full range, restricted to ROI when
    one is set), the parameter descriptors with initial estimates +
    bounds, and the initial fitted Y array (computed over the full X).
    """
    if hasattr(extras, "to_py"):
        extras = extras.to_py()  # type: ignore[union-attr]
    kind = _INTERACTIVE_FITS[fit_id]
    obj = _resolve_signal(oid)
    x_roi, y_roi = _roi_xy(obj)
    computer = kind.make_computer(x_roi, y_roi, extras)
    initial = computer.compute_initial_params()
    bounds = computer.compute_bounds(**initial)
    params = _make_param_descriptors(computer, initial, bounds)
    # Evaluate initial fit on the full X axis (not just ROI) so the user
    # sees the model extrapolated outside the fitting region too.
    x_full = np.asarray(obj.x, dtype=float)
    y_fit = _evaluate(kind, x_full, {p["name"]: p["value"] for p in params})
    return {
        "fit_id": fit_id,
        "label": kind.label,
        "x": x_full.tolist(),
        "y": np.asarray(obj.y, dtype=float).tolist(),
        "x_roi": x_roi.tolist(),
        "y_roi": y_roi.tolist(),
        "params": params,
        "y_fit": y_fit.tolist(),
        "needs_degree": kind.needs_degree,
        "extras": dict(extras or {}),
    }


def _evaluate(kind: _FitKind, x: np.ndarray, values: dict[str, float]) -> np.ndarray:
    """Evaluate the model — works for both classmethod and instance evaluators."""
    try:
        return np.asarray(kind.computer.evaluate(x, **values), dtype=float)
    except TypeError:
        # Polynomial: parameter names depend on the degree, no classmethod path
        # (we'd need an instance to know the degree).  Build a tiny instance
        # using the supplied X just for evaluation purposes.
        comp = kind.computer(x, x)  # type: ignore[call-arg]
        return np.asarray(comp.evaluate(x, **values), dtype=float)


def evaluate_interactive_fit(
    fit_id: str,
    x: list[float],
    values: dict[str, float],
    extras: dict[str, Any] | None = None,
) -> list[float]:
    """Evaluate the model at *x* with the given parameter *values*.

    Used by the React dialog on every slider change to refresh the
    overlay curve without round-tripping through the panel model.
    """
    if hasattr(values, "to_py"):
        values = values.to_py()  # type: ignore[union-attr]
    if hasattr(extras, "to_py"):
        extras = extras.to_py()  # type: ignore[union-attr]
    if hasattr(x, "to_py"):
        x = x.to_py()  # type: ignore[union-attr]
    kind = _INTERACTIVE_FITS[fit_id]
    x_arr = np.asarray(x, dtype=float)
    if kind.needs_degree:
        # Polynomial: evaluate via numpy.polyval on coefficients in name order.
        ordered = [values[name] for name in sorted(values.keys())]
        return np.polyval(ordered, x_arr).astype(float).tolist()
    return _evaluate(kind, x_arr, {k: float(v) for k, v in values.items()}).tolist()


def auto_fit_interactive(
    oid: str, fit_id: str, extras: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Run the auto-fitter (scipy.curve_fit) and return optimised params.

    The optimisation always restarts from the model's recommended initial
    estimates (matching the desktop ``FitDialog.autofit`` behaviour).
    """
    if hasattr(extras, "to_py"):
        extras = extras.to_py()  # type: ignore[union-attr]
    kind = _INTERACTIVE_FITS[fit_id]
    obj = _resolve_signal(oid)
    x_roi, y_roi = _roi_xy(obj)
    computer = kind.make_computer(x_roi, y_roi, extras)
    _y, params = computer.optimize_fit_with_scipy()
    # Strip housekeeping keys added by ``create_params``.
    clean = {
        k: float(v) for k, v in params.items() if k not in {"fit_type", "residual_rms"}
    }
    x_full = np.asarray(obj.x, dtype=float)
    y_fit = _evaluate(kind, x_full, clean)
    return {
        "values": clean,
        "y_fit": y_fit.tolist(),
        "residual_rms": float(params.get("residual_rms", 0.0)),
    }


def commit_interactive_fit(
    oid: str,
    fit_id: str,
    values: dict[str, float],
    extras: dict[str, Any] | None = None,
) -> str:
    """Add the fitted curve to the panel as a new signal; return its id."""
    if hasattr(values, "to_py"):
        values = values.to_py()  # type: ignore[union-attr]
    if hasattr(extras, "to_py"):
        extras = extras.to_py()  # type: ignore[union-attr]
    model = _get_model()

    kind = _INTERACTIVE_FITS[fit_id]
    src = model.get(oid)
    x_full = np.asarray(src.x, dtype=float)
    y_fit = _evaluate(kind, x_full, {k: float(v) for k, v in values.items()})
    dst = src.copy()
    dst.set_xydata(x_full, y_fit)
    # Title carries the fit kind and the parameter values for traceability.
    pretty = ", ".join(f"{_pretty_label(k)}={v:g}" for k, v in values.items())
    dst.title = f"{kind.label}({pretty})"
    # Store fit metadata so the Properties tab can surface it (matches the
    # auto-fit convention from sigima.proc.signal.fitting).
    dst.metadata["fit_params"] = {
        **{k: float(v) for k, v in values.items()},
        "fit_type": fit_id.replace("_fit", ""),
        "interactive": True,
    }
    panel = model.panel("signal")
    group = panel.find_group_of(oid)
    return model.add_object("signal", dst, group_id=group.gid)


__all__ = [
    "auto_fit_interactive",
    "commit_interactive_fit",
    "evaluate_interactive_fit",
    "init_interactive_fit",
    "list_interactive_fits",
]
