# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the worker-side macro proxy (``macro_proxy``).

The proxy never touches the live model directly: every method serialises
its arguments and ``await`` s a single round-trip through the JS bridge
(``js._dlw_bridge_call``). Under CPython we install a fake bridge that
records each ``(method, payload)`` pair and returns a canned reply, so we
can assert the request shape without a real worker.
"""

from __future__ import annotations

import asyncio
import base64
import pickle

import macro_proxy
import numpy as np
import pytest


class FakeBridge:
    """Async stand-in for ``js._dlw_bridge_call``.

    Records every call and returns the pre-seeded reply (default ``None``).
    """

    def __init__(self, reply=None):
        self.calls: list[tuple[str, object]] = []
        self.reply = reply

    async def __call__(self, method, payload):
        self.calls.append((method, payload))
        return self.reply


class SignalObj:
    """Picklable stand-in whose class name drives ``_detect_kind``."""

    def __init__(self, value=0):
        self.value = value


class ImageObj:
    """Picklable stand-in whose class name drives ``_detect_kind``."""

    def __init__(self, value=0):
        self.value = value


@pytest.fixture
def bridge(monkeypatch):
    """Install a fresh :class:`FakeBridge` as the proxy's JS bridge."""
    fake = FakeBridge()
    monkeypatch.setattr(macro_proxy.js, "_dlw_bridge_call", fake)
    return fake


def run(coro):
    """Drive an async proxy call to completion under CPython."""
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_to_jsable_converts_numpy_array():
    out = macro_proxy._to_jsable(np.array([1, 2, 3]))
    assert out == [1, 2, 3]
    assert isinstance(out, list)


def test_to_jsable_recurses_into_containers():
    payload = {"a": np.array([1.0, 2.0]), "b": [np.array([3]), 4], "c": "x"}
    out = macro_proxy._to_jsable(payload)
    assert out == {"a": [1.0, 2.0], "b": [[3], 4], "c": "x"}


def test_to_jsable_passes_scalars_through():
    assert macro_proxy._to_jsable(42) == 42
    assert macro_proxy._to_jsable("hello") == "hello"
    assert macro_proxy._to_jsable(None) is None


def test_detect_kind_signal_and_image():
    assert macro_proxy._detect_kind(SignalObj()) == "signal"
    assert macro_proxy._detect_kind(ImageObj()) == "image"


def test_detect_kind_rejects_other_types():
    with pytest.raises(TypeError):
        macro_proxy._detect_kind(object())


# ---------------------------------------------------------------------------
# Bridge round-trips
# ---------------------------------------------------------------------------


def test_add_signal_forwards_all_fields(bridge):
    bridge.reply = "sig-1"
    oid = run(
        macro_proxy.proxy.add_signal(
            "S", [0, 1, 2], np.array([1.0, 2.0, 3.0]), xunit="s", yunit="V"
        )
    )
    assert oid == "sig-1"
    assert len(bridge.calls) == 1
    method, payload = bridge.calls[0]
    assert method == "add_signal"
    assert payload["title"] == "S"
    # Numpy Y data is normalised to a plain list across the bridge.
    assert payload["ydata"] == [1.0, 2.0, 3.0]
    assert payload["xunit"] == "s"
    assert payload["yunit"] == "V"
    assert payload["group_id"] is None


def test_add_image_forwards_data(bridge):
    bridge.reply = "img-1"
    oid = run(macro_proxy.proxy.add_image("I", np.array([[1, 2], [3, 4]])))
    assert oid == "img-1"
    method, payload = bridge.calls[0]
    assert method == "add_image"
    assert payload["data"] == [[1, 2], [3, 4]]


def test_calc_maps_to_apply_feature(bridge):
    run(macro_proxy.proxy.calc("normalize", params={"method": "minmax"}))
    method, payload = bridge.calls[0]
    assert method == "apply_feature"
    assert payload["feature_id"] == "normalize"
    assert payload["params"] == {"method": "minmax"}
    assert payload["sources"] is None
    assert payload["operand"] is None


def test_select_objects_coerces_to_list(bridge):
    run(macro_proxy.proxy.select_objects(("a", "b")))
    _method, payload = bridge.calls[0]
    assert payload["oids"] == ["a", "b"]
    assert isinstance(payload["oids"], list)


def test_call_method_passes_args_and_kwargs(bridge):
    run(macro_proxy.proxy.call_method("delete_all_objects", "x", force=True))
    method, payload = bridge.calls[0]
    assert method == "call_method"
    assert payload["name"] == "delete_all_objects"
    assert payload["args"] == ["x"]
    assert payload["kwargs"] == {"force": True}


def test_reset_all_takes_no_payload(bridge):
    run(macro_proxy.proxy.reset_all())
    method, payload = bridge.calls[0]
    assert method == "reset_all"
    assert payload == {}


def test_add_object_pickles_and_tags_kind(bridge):
    bridge.reply = "obj-1"
    oid = run(macro_proxy.proxy.add_object(SignalObj(7), group_id="g1"))
    assert oid == "obj-1"
    method, payload = bridge.calls[0]
    assert method == "add_object"
    assert payload["kind"] == "signal"
    assert payload["group_id"] == "g1"
    # The pickled payload round-trips back to an equivalent object.
    restored = pickle.loads(base64.b64decode(payload["pickled_b64"]))
    assert restored.value == 7
