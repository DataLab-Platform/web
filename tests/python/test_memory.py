# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the memory-reclamation helper (``collect_garbage``).

These exercise the *impact* of the garbage-collection pass that backs the
"Free memory" UI action: the WASM heap never shrinks back to the OS, so the
measurable effect is that unreachable Python references are dropped and
subsequent allocations reuse freed pages instead of growing the heap.

Under CPython we cannot observe the WASM heap, but we *can* observe the two
proxies for the same effect: the live-object count returned by
:func:`gc.get_objects` and the emptiness of the in-memory model after a
delete pass.
"""

from __future__ import annotations

import numpy as np


def test_collect_garbage_reports_expected_shape(fresh_bootstrap):
    bs = fresh_bootstrap
    result = bs.collect_garbage()
    assert set(result) == {"collected", "objects_before", "objects_after"}
    assert all(isinstance(value, int) for value in result.values())
    assert result["collected"] >= 0
    assert result["objects_before"] > 0
    assert result["objects_after"] > 0


def test_delete_all_then_collect_empties_model(fresh_bootstrap):
    bs = fresh_bootstrap
    for i in range(3):
        bs.add_image_from_array(f"img{i}", np.zeros((128, 128)))
    bs.delete_all_objects("image")
    result = bs.collect_garbage()
    tree = bs.get_panel_tree("image")
    remaining = [obj for group in tree["groups"] for obj in group["objects"]]
    assert remaining == []
    assert result["collected"] >= 0


def test_collect_garbage_bounds_object_growth(fresh_bootstrap):
    """Repeated create/delete/collect cycles must not leak linearly.

    Without the delete pass + collect, each cycle would retain its five
    large arrays (and all their wrapper objects), so the live-object count
    would climb by hundreds per cycle. With reclamation working, the count
    stabilises and the net drift across ten cycles stays small.
    """
    bs = fresh_bootstrap

    def cycle() -> None:
        for i in range(5):
            bs.add_image_from_array(f"img{i}", np.zeros((256, 256)))
        bs.delete_all_objects("image")
        bs.collect_garbage()

    # Warm-up cycle to populate any one-off caches (catalogue, metadata).
    cycle()
    baseline = bs.collect_garbage()["objects_after"]

    for _ in range(10):
        cycle()
    after = bs.collect_garbage()["objects_after"]

    # A small bounded drift is acceptable; linear growth (10 cycles ×
    # 5 images plus their arrays) would add thousands of objects.
    assert after - baseline < 500, (
        f"object count grew by {after - baseline} across 10 cycles "
        "— reclamation is not bounding growth"
    )


def test_get_data_memory_reports_expected_shape(fresh_bootstrap):
    bs = fresh_bootstrap
    result = bs.get_data_memory()
    assert set(result) == {"data_bytes", "object_count"}
    assert all(isinstance(value, int) for value in result.values())
    assert result["data_bytes"] == 0
    assert result["object_count"] == 0


def test_get_data_memory_tracks_image_arrays(fresh_bootstrap):
    """The data figure must rise with loaded arrays and drop on delete.

    Unlike the WASM heap, this metric reflects the memory the user can
    actually act on, so it backs the UI feedback that deleting objects had
    an effect.
    """
    bs = fresh_bootstrap
    # Three float64 256×256 images: 256*256*8 = 524288 bytes each.
    expected = 3 * 256 * 256 * 8
    for i in range(3):
        bs.add_image_from_array(f"img{i}", np.zeros((256, 256), dtype=np.float64))
    loaded = bs.get_data_memory()
    assert loaded["object_count"] == 3
    assert loaded["data_bytes"] == expected

    bs.delete_all_objects("image")
    after = bs.get_data_memory()
    assert after["object_count"] == 0
    assert after["data_bytes"] == 0
