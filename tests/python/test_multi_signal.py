# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the multi-signal payload helpers.

Covers ``get_signals_xy`` (batched fetch used by :class:`SignalPlot` to
overlay several selected signals) and the optional ``style`` block
exposed on every signal payload (driving the per-curve color / dash
overrides on the JS side).
"""

from __future__ import annotations

import math

import numpy as np


def _add(bs, title: str) -> str:
    return bs.add_signal_from_arrays(title, np.linspace(0, 1, 5), np.zeros(5))


def test_get_signal_xy_includes_style_block(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = _add(bs, "S1")
    payload = bs.get_signal_xy(oid)
    # ``style`` is always present; its fields default to ``None`` when the
    # underlying SignalObj has no per-curve metadata yet.
    assert "style" in payload
    style = payload["style"]
    assert style == {"color": None, "linestyle": None, "linewidth": None}


def test_get_signal_xy_reads_style_from_metadata(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.create_signal(
        kind="sine",
        title="sin",
        size=16,
        xmin=0.0,
        xmax=2 * math.pi,
        a=1.0,
        freq=1.0,
        phase=0.0,
    )
    obj = bs._MODEL.get(oid)
    obj.metadata["color"] = "#ff7f0e"
    obj.metadata["linestyle"] = "DashLine"
    obj.metadata["linewidth"] = "2.5"
    style = bs.get_signal_xy(oid)["style"]
    assert style == {"color": "#ff7f0e", "linestyle": "DashLine", "linewidth": 2.5}


def test_get_signals_xy_returns_one_payload_per_known_id(fresh_bootstrap):
    bs = fresh_bootstrap
    o1 = _add(bs, "A")
    o2 = _add(bs, "B")
    payloads = bs.get_signals_xy([o1, "missing-id", o2])
    assert [p["title"] for p in payloads] == ["A", "B"]
    assert all("style" in p and "x" in p and "y" in p for p in payloads)


def test_get_signals_xy_with_empty_input_returns_empty_list(fresh_bootstrap):
    bs = fresh_bootstrap
    assert bs.get_signals_xy([]) == []
