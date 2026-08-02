# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for atomic view and properties snapshots."""

from __future__ import annotations

import numpy as np


def test_signal_view_snapshot_groups_current_and_overlay_payloads(
    fresh_bootstrap, monkeypatch
):
    bs = fresh_bootstrap
    first = bs.add_signal_from_arrays("A", [0, 1], [2, 3])
    current = bs.add_signal_from_arrays("B", [0, 1], [4, 5])
    bs.set_plotly_annotations(
        current, {"shapes": [{"type": "line"}], "annotations": []}
    )
    extra_result = {"kind": "geometry", "title": "Peak"}
    monkeypatch.setattr(
        bs,
        "list_signal_results",
        lambda oid: [extra_result] if oid == first else [],
    )

    snapshot = bs.get_signal_view_snapshot(current, [first, current], encoding="list")

    assert snapshot["kind"] == "signal"
    assert snapshot["current"]["id"] == current
    assert [item["id"] for item in snapshot["extras"]] == [first]
    assert snapshot["annotations"]["shapes"] == [{"type": "line"}]
    assert snapshot["roi"] == []
    assert snapshot["results"] == []
    assert snapshot["extra_results"] == [
        {"signal_id": first, "results": [extra_result]}
    ]


def test_multi_image_snapshot_uses_one_bounded_batch(fresh_bootstrap, monkeypatch):
    bs = fresh_bootstrap
    first = bs.add_image_from_array("A", np.arange(16).reshape(4, 4))
    current = bs.add_image_from_array("B", np.arange(25).reshape(5, 5))
    batch_calls: list[tuple[list[str], int | None, str]] = []
    image_calls: list[int | None] = []
    original_batch = bs.get_images_data
    original_image = bs.get_image_data

    def counted_batch(oids, max_size=None, encoding="list"):
        batch_calls.append((list(oids), max_size, encoding))
        return original_batch(oids, max_size=max_size, encoding=encoding)

    def counted_image(oid, max_size=None, encoding="list"):
        image_calls.append(max_size)
        return original_image(oid, max_size=max_size, encoding=encoding)

    monkeypatch.setattr(bs, "get_images_data", counted_batch)
    monkeypatch.setattr(bs, "get_image_data", counted_image)

    snapshot = bs.get_image_view_snapshot(
        current, [first, current], max_size=2, encoding="list"
    )

    assert snapshot["kind"] == "image"
    assert snapshot["mode"] == "multi"
    assert batch_calls == [([current, first], 2, "list")]
    assert image_calls == [2, 2]
    assert [item["id"] for item in snapshot["images"]] == [current, first]
    assert all(max(item["width"], item["height"]) <= 2 for item in snapshot["images"])


def test_single_image_snapshot_keeps_full_resolution(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_image_from_array("I", np.arange(30).reshape(5, 6))

    snapshot = bs.get_image_view_snapshot(oid, [oid], max_size=2, encoding="list")

    assert snapshot["mode"] == "single"
    assert snapshot["images"][0]["width"] == 6
    assert snapshot["images"][0]["height"] == 5


def test_properties_snapshot_includes_signal_preview_only(fresh_bootstrap):
    bs = fresh_bootstrap
    signal = bs.add_signal_from_arrays("S", range(20), range(20))
    image = bs.add_image_from_array("I", np.zeros((2, 2)))

    signal_snapshot = bs.get_properties_snapshot(signal, preview_head=2, preview_tail=3)
    image_snapshot = bs.get_properties_snapshot(image)

    assert signal_snapshot["schema"]["values"]
    assert signal_snapshot["stats"]["n_points"] == 20
    assert signal_snapshot["signal_preview"]["indices"] == [0, 1, 17, 18, 19]
    assert image_snapshot["stats"]["shape"] == [2, 2]
    assert image_snapshot["signal_preview"] is None
