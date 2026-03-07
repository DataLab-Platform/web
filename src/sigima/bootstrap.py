# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""
Sigima bootstrap script for DataLab-Web.

Loaded once into Pyodide at application start-up. It:

* installs Sigima and its runtime dependencies via micropip,
* exposes a small object store (``_STORE``) keyed by string ids,
* exposes thin Python helpers that the JavaScript layer calls
  (``create_signal``, ``list_signals``, ``get_signal_xy``,
  ``apply_processing``, ``delete_signal``).

The helpers always return JSON-serialisable values so they can cross the
Pyodide / JS bridge cheaply through ``pyodide.toJs``.
"""

from __future__ import annotations

import uuid
from typing import Any

import numpy as np
import sigima
import sigima.params
import sigima.proc.signal as sips
from guidata.dataset import (
    DataSet,
    dataset_to_schema_with_values,
    resolve_dynamic_choices,
    update_dataset,
)
from sigima.objects import SignalObj

# ---------------------------------------------------------------------------
# In-memory object store
# ---------------------------------------------------------------------------

# Keyed by short uuid string.  Mirrors the role of ``ObjectModel`` in the
# desktop application, but kept intentionally minimal for the MVP.
#
# Important: this module may be re-executed by the dev-server's Python HMR
# plugin (plugins/vite-plugin-python-hmr.ts).  We therefore preserve any
# existing ``_STORE`` across reloads so user data is not wiped when only
# helpers / catalogue entries change.
_STORE: dict[str, SignalObj] = globals().get("_STORE", {})  # type: ignore[assignment]


def _new_id() -> str:
    """Return a short, unique object identifier."""
    return uuid.uuid4().hex[:8]


def _meta(obj: SignalObj) -> dict[str, Any]:
    """Return JSON-friendly metadata for *obj*."""
    return {
        "uuid": obj.uuid if hasattr(obj, "uuid") else None,
        "title": obj.title,
        "size": int(obj.x.size),
        "xlabel": obj.xlabel or "",
        "ylabel": obj.ylabel or "",
        "xunit": obj.xunit or "",
        "yunit": obj.yunit or "",
    }


# ---------------------------------------------------------------------------
# Signal creation helpers
# ---------------------------------------------------------------------------


def create_signal(kind: str, title: str, size: int, xmin: float, xmax: float,
                  a: float = 1.0, freq: float = 1.0, phase: float = 0.0,
                  mu: float = 0.0, sigma: float = 1.0) -> str:
    """Create a synthetic signal and store it.

    Args:
        kind: One of ``"sine"``, ``"cosine"``, ``"gauss"``, ``"noise"``.
        title: Display name.
        size: Number of samples.
        xmin: X-axis lower bound.
        xmax: X-axis upper bound.
        a: Amplitude (sine/cosine/gauss).
        freq: Frequency in Hz (sine/cosine).
        phase: Phase in radians (sine/cosine).
        mu: Mean (gauss).
        sigma: Standard deviation (gauss).

    Returns:
        The newly assigned object id.
    """
    x = np.linspace(xmin, xmax, int(size))
    if kind == "sine":
        y = a * np.sin(2 * np.pi * freq * x + phase)
    elif kind == "cosine":
        y = a * np.cos(2 * np.pi * freq * x + phase)
    elif kind == "gauss":
        y = a * np.exp(-0.5 * ((x - mu) / sigma) ** 2)
    elif kind == "noise":
        rng = np.random.default_rng()
        y = a * rng.standard_normal(int(size))
    else:
        raise ValueError(f"Unknown signal kind: {kind!r}")
    obj = sigima.create_signal(title=title, x=x, y=y)
    oid = _new_id()
    _STORE[oid] = obj
    return oid


def list_signals() -> list[dict[str, Any]]:
    """Return metadata for every stored signal."""
    return [{"id": oid, **_meta(obj)} for oid, obj in _STORE.items()]


def get_signal_xy(oid: str) -> dict[str, Any]:
    """Return the X / Y arrays of *oid* in JSON-friendly form."""
    obj = _STORE[oid]
    return {
        "id": oid,
        "x": obj.x.tolist(),
        "y": obj.y.tolist(),
        **_meta(obj),
    }


def delete_signal(oid: str) -> None:
    """Remove *oid* from the store."""
    _STORE.pop(oid, None)


# ---------------------------------------------------------------------------
# Processing
# ---------------------------------------------------------------------------

#: Catalogue of processings exposed to the front-end. Each entry has:
#:   - ``label``: human-readable name for the menu
#:   - ``func``: the Sigima processing callable
#:   - ``paramclass``: optional ``guidata.dataset.DataSet`` subclass; when
#:     present, the front-end renders a parameter dialog generated from
#:     ``dataset_to_schema_with_values`` before applying the processing.
_PROCESSINGS: dict[str, dict[str, Any]] = {
    "normalize": {
        "label": "Normalize\u2026",
        "func": sips.normalize,
        "paramclass": sigima.params.NormalizeParam,
    },
    "moving_average": {
        "label": "Moving average\u2026",
        "func": sips.moving_average,
        "paramclass": sigima.params.MovingAverageParam,
    },
    "derivative": {
        "label": "Derivative",
        "func": sips.derivative,
        "paramclass": None,
    },
    "integral": {
        "label": "Integral",
        "func": sips.integral,
        "paramclass": None,
    },
    "fft": {
        "label": "FFT",
        "func": sips.fft,
        "paramclass": None,
    },
    "absolute": {
        "label": "Absolute value",
        "func": sips.absolute,
        "paramclass": None,
    },
    "log10": {
        "label": "Log10",
        "func": sips.log10,
        "paramclass": None,
    },
}


def list_processings() -> list[dict[str, Any]]:
    """Return the human-readable processing catalogue.

    Each entry carries ``has_params`` so the front-end knows whether to
    open a parameter dialog before invoking the processing.
    """
    return [
        {
            "id": pid,
            "label": meta["label"],
            "has_params": meta["paramclass"] is not None,
        }
        for pid, meta in _PROCESSINGS.items()
    ]


def _get_paramclass(processing_id: str) -> type[DataSet] | None:
    if processing_id not in _PROCESSINGS:
        raise ValueError(f"Unknown processing: {processing_id!r}")
    return _PROCESSINGS[processing_id]["paramclass"]


def get_processing_schema(processing_id: str) -> dict[str, Any] | None:
    """Return ``{schema, values}`` for *processing_id*, or ``None`` if the
    processing takes no parameters.
    """
    paramclass = _get_paramclass(processing_id)
    if paramclass is None:
        return None
    return dataset_to_schema_with_values(paramclass())


def resolve_processing_choices(
    processing_id: str, item_name: str, values: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """Resolve a dynamic ChoiceItem against the current dialog state."""
    paramclass = _get_paramclass(processing_id)
    if paramclass is None:
        raise ValueError(f"Processing {processing_id!r} has no parameters.")
    instance = paramclass()
    if values:
        update_dataset(instance, values)
    return resolve_dynamic_choices(instance, item_name)


def apply_processing(
    oid: str, processing_id: str, params: dict[str, Any] | None = None
) -> str:
    """Apply *processing_id* to signal *oid* and return the new object id.

    Args:
        oid: Source signal id.
        processing_id: Catalogue entry id.
        params: Optional dict of user-edited parameter values. Used when
            the catalogue entry declares a ``paramclass``.
    """
    if processing_id not in _PROCESSINGS:
        raise ValueError(f"Unknown processing: {processing_id!r}")
    spec = _PROCESSINGS[processing_id]
    src = _STORE[oid]
    paramclass = spec["paramclass"]
    if paramclass is None:
        dst = spec["func"](src)
    else:
        instance = paramclass()
        if params:
            update_dataset(instance, params)
        dst = spec["func"](src, instance)
    new_oid = _new_id()
    _STORE[new_oid] = dst
    return new_oid


__all__ = [
    "create_signal",
    "list_signals",
    "get_signal_xy",
    "delete_signal",
    "list_processings",
    "get_processing_schema",
    "resolve_processing_choices",
    "apply_processing",
]
