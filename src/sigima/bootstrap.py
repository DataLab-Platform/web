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

#: Catalogue of processings exposed to the front-end.  The MVP wraps a few
#: 1-to-1 functions; extending it is a one-line change.
_PROCESSINGS: dict[str, dict[str, Any]] = {
    "normalize_minmax": {
        "label": "Normalize (min/max)",
        "func": sips.normalize,
        "kwargs": {"method": "minmax"},
    },
    "normalize_maximum": {
        "label": "Normalize (maximum)",
        "func": sips.normalize,
        "kwargs": {"method": "maximum"},
    },
    "derivative": {
        "label": "Derivative",
        "func": sips.derivative,
        "kwargs": {},
    },
    "integral": {
        "label": "Integral",
        "func": sips.integral,
        "kwargs": {},
    },
    "fft": {
        "label": "FFT",
        "func": sips.fft,
        "kwargs": {},
    },
    "absolute": {
        "label": "Absolute value",
        "func": sips.absolute,
        "kwargs": {},
    },
    "log10": {
        "label": "Log10",
        "func": sips.log10,
        "kwargs": {},
    },
}


def list_processings() -> list[dict[str, str]]:
    """Return the human-readable processing catalogue."""
    return [{"id": pid, "label": meta["label"]} for pid, meta in _PROCESSINGS.items()]


def apply_processing(oid: str, processing_id: str) -> str:
    """Apply *processing_id* to signal *oid* and return the new object id."""
    if processing_id not in _PROCESSINGS:
        raise ValueError(f"Unknown processing: {processing_id!r}")
    spec = _PROCESSINGS[processing_id]
    src = _STORE[oid]
    dst = spec["func"](src, **spec["kwargs"])
    new_oid = _new_id()
    _STORE[new_oid] = dst
    return new_oid


__all__ = [
    "create_signal",
    "list_signals",
    "get_signal_xy",
    "delete_signal",
    "list_processings",
    "apply_processing",
]
