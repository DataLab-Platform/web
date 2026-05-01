"""Regression tests for the zero-copy binary transfer path.

The remote bridge ships large signals/images across the iframe as
typed-array buffers (memoryview / bytes on the Python side) rather
than as Python lists.  These tests exercise the dedicated codepaths
in :mod:`bootstrap` so we keep them green when refactoring.
"""

from __future__ import annotations

import numpy as np
import pytest


def test_add_signal_from_arrays_accepts_bytes_buffer(fresh_bootstrap):
    """A raw little-endian float64 byte buffer must reconstruct
    exactly the same signal as the equivalent list / ndarray input."""
    bs = fresh_bootstrap
    x = np.linspace(0, 1, 1024, dtype=np.float64)
    y = np.sin(2 * np.pi * x).astype(np.float64)
    oid = bs.add_signal_from_arrays(
        "Binary",
        x.tobytes(),
        y.tobytes(),
        dtype="float64",
    )
    payload = bs.get_signal_xy(oid)
    np.testing.assert_array_equal(np.asarray(payload["x"]), x)
    np.testing.assert_array_equal(np.asarray(payload["y"]), y)


def test_get_signal_xy_bytes_round_trip(fresh_bootstrap):
    """``encoding="bytes"`` returns raw float64 bytes that decode
    exactly to the original arrays."""
    bs = fresh_bootstrap
    x = np.linspace(0, 10, 5000, dtype=np.float64)
    y = (x * 2.5 - 1).astype(np.float64)
    oid = bs.add_signal_from_arrays("Roundtrip", x, y)
    payload = bs.get_signal_xy(oid, encoding="bytes")
    assert payload["encoding"] == "f64"
    assert payload["dtype"] == "float64"
    assert payload["size"] == x.size
    x_back = np.frombuffer(payload["x_bytes"], dtype=np.float64)
    y_back = np.frombuffer(payload["y_bytes"], dtype=np.float64)
    np.testing.assert_array_equal(x_back, x)
    np.testing.assert_array_equal(y_back, y)


def test_get_signal_xy_default_remains_list(fresh_bootstrap):
    """The default ``encoding="list"`` mode must keep emitting Python
    lists so existing callers (notebook, old SDKs) keep working."""
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("Legacy", [0.0, 1.0, 2.0], [3.0, 4.0, 5.0])
    payload = bs.get_signal_xy(oid)
    assert payload["encoding"] == "list"
    assert payload["x"] == [0.0, 1.0, 2.0]
    assert payload["y"] == [3.0, 4.0, 5.0]


def test_add_image_from_array_flat_buffer_with_shape(fresh_bootstrap):
    """Large images travel as a flat byte buffer + ``width``/``height``;
    the bootstrap helper must reshape without copying."""
    bs = fresh_bootstrap
    h, w = 5, 7
    src = np.arange(h * w, dtype=np.float64).reshape(h, w)
    oid = bs.add_image_from_array(
        "FlatImg",
        src.tobytes(),
        width=w,
        height=h,
        dtype="float64",
    )
    payload = bs.get_image_data(oid)
    np.testing.assert_array_equal(np.asarray(payload["data"]), src)


def test_add_image_from_array_buffer_size_mismatch_raises(fresh_bootstrap):
    """A clearly wrong width/height combination must fail loudly
    rather than silently truncating user data."""
    bs = fresh_bootstrap
    buf = np.zeros(10, dtype=np.float64).tobytes()
    with pytest.raises(ValueError):
        bs.add_image_from_array("Bad", buf, width=4, height=4, dtype="float64")
