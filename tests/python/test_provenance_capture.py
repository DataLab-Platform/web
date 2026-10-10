# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Provenance capture of images, analyses, n-to-1 operations, ROI and uncertainty."""

from __future__ import annotations

import asyncio
import os

import numpy as np
import pytest

if os.environ.get("DLW_REQUIRE_PROVENANCE") == "1":
    import datalab_capsule  # noqa: F401  # CI must not skip these tests
else:
    pytest.importorskip("datalab_capsule")

import sigima.objects  # noqa: E402
from test_provenance_workspace import fresh_runtime  # noqa: E402

X = np.array([0.0, 0.25, 0.5, 0.75])
Y = np.array([-2.0, 0.0, 1.0, 4.0])


def add_signal(bs, y=Y, x=X, title: str = "S") -> str:
    """Add a signal (X in s) and return its object id."""
    return bs.add_signal_from_arrays(title, np.asarray(x), np.asarray(y), "s")


def add_image(bs, title: str = "I") -> str:
    """Add a 3x4 image and return its object id."""
    data = np.arange(12, dtype=np.float64).reshape(3, 4)
    return bs.add_image_from_array(title, data, "mm", "mm", "counts")


def ledger(bs):
    """Return the live provenance ledger."""
    return bs._PROVENANCE.ledger


def uuid_of(bs, oid: str) -> str:
    """Return the persistent UUID of object *oid*."""
    return bs._object_uuid(bs._MODEL.get(oid))


def inputs_of(bs, activity) -> list[dict]:
    """Return the input states of an activity, in role order."""
    return [
        ledger(bs).states[i["binding"]["state_id"]] for i in activity["call"]["inputs"]
    ]


def test_image_processing_is_captured(fresh_bootstrap):
    """An image 1-to-1 records image states: shape, units, image fingerprint."""
    bs = fresh_bootstrap
    src = add_image(bs)
    (result,) = bs.apply_feature("image:gaussian_filter", [src], params={"sigma": 1.0})
    (activity,) = ledger(bs).activities
    (source,) = inputs_of(bs, activity)
    assert source["kind"] == "image" and source["shape"] == [3, 4]
    assert source["units"] == {"x": "mm", "y": "mm", "z": "counts"}
    assert source["fingerprint"]["scheme"] == "datalab-image-v1"
    output = ledger(bs).states[activity["outputs"][0]["state_id"]]
    assert output["kind"] == "image" and output["object_uuid"] == uuid_of(bs, result)
    assert activity["call"]["parameters"]["sigma"] == 1.0
    ledger(bs).validate()


def test_n_to_1_records_every_source_in_order(fresh_bootstrap):
    """Average of three signals: three ``sources`` inputs, in selection order."""
    bs = fresh_bootstrap
    oids = [add_signal(bs, Y * k, title=f"S{k}") for k in (1, 2, 3)]
    (result,) = bs.apply_feature("average", oids)
    (activity,) = ledger(bs).activities
    assert [i["role"] for i in activity["call"]["inputs"]] == ["sources"] * 3
    assert [s["object_uuid"] for s in inputs_of(bs, activity)] == [
        uuid_of(bs, oid) for oid in oids
    ]
    assert np.array_equal(bs._MODEL.get(result).y, Y * 2)
    assert activity["limits"] == []
    gid = bs._MODEL.panel("signal").find_group_of(oids[0]).gid
    bs.apply_feature("average", oids, group_ids=[gid])
    grouped = ledger(bs).activities[-1]
    assert [s["object_uuid"] for s in inputs_of(bs, grouped)] == [
        uuid_of(bs, oid) for oid in oids
    ]


def test_legacy_interpolation_is_flagged(fresh_bootstrap):
    """Inputs interpolated before an n-to-1 call are flagged; originals recorded."""
    bs = fresh_bootstrap
    first = add_signal(bs, title="first")
    second = add_signal(bs, x=[0.0, 0.5, 0.6, 0.75], title="second")
    bs.apply_feature("average", [first, second])
    (activity,) = ledger(bs).activities
    assert activity["limits"] == ["x_interpolated"]
    recorded = inputs_of(bs, activity)[1]
    assert recorded["state_id"] == bs._PROVENANCE.observe(bs._MODEL.get(second))


def test_analyses_record_artifacts(fresh_bootstrap):
    """Signal and image analyses record their result as an artifact output."""
    bs = fresh_bootstrap
    signal = add_signal(bs)
    asyncio.run(bs.run_signal_analysis(signal, "stats"))
    image = add_image(bs)
    asyncio.run(bs.run_image_analysis(image, "centroid"))
    stats, centroid = ledger(bs).activities
    for activity, oid, kind in (
        (stats, signal, "table"),
        (centroid, image, "geometry"),
    ):
        (output,) = activity["outputs"]
        artifact = output["artifact"]
        assert artifact["kind"] == kind
        assert artifact["object_uuid"] == uuid_of(bs, oid)
        assert artifact["key"] in bs._MODEL.get(oid).metadata
        assert inputs_of(bs, activity)[0]["object_uuid"] == uuid_of(bs, oid)
    ledger(bs).validate()


def test_roi_and_uncertainty_are_recorded(fresh_bootstrap):
    """ROI definitions and uncertainty rows are part of the recorded states."""
    bs = fresh_bootstrap
    oid = add_signal(bs)
    obj = bs._MODEL.get(oid)
    obj.dy = np.full(4, 0.1)
    obj.roi = sigima.objects.create_signal_roi([0.0, 0.5])
    bs.apply_feature("normalize", [oid])
    (activity,) = ledger(bs).activities
    (source,) = inputs_of(bs, activity)
    assert source["rows"] == ["x", "y", "dy"] and source["limits"] == []
    assert source["fingerprint"] is not None
    assert source["roi"]["definition"]["single_rois"][0]["coords"] == [0.0, 0.5]
    # Qualified normalisation refuses ROI and uncertainty: recorded as opaque.
    assert activity["call"]["operation"] is None
    image = bs._MODEL.get(add_image(bs))
    image.roi = sigima.objects.create_image_roi("rectangle", [0, 0, 2, 2])
    state = ledger(bs).states[bs._PROVENANCE.observe(image)]
    assert state["roi"]["definition"]["single_rois"][0]["coords"] == [0, 0, 2, 2]


def test_round_trip_with_images_and_analyses():
    """Images, ROI, uncertainty and artifacts survive a save and a reopening."""
    writer = fresh_runtime()
    image = add_image(writer)
    writer._MODEL.get(image).roi = sigima.objects.create_image_roi(
        "rectangle", [0, 0, 2, 2]
    )
    asyncio.run(writer.run_image_analysis(image, "centroid"))
    signal = add_signal(writer)
    writer._MODEL.get(signal).dy = np.full(4, 0.1)
    writer.apply_feature("gaussian_filter", [signal], params={"sigma": 1.0})
    saved = writer._PROVENANCE.ledger.to_dict()
    reader = fresh_runtime()
    reader.open_workspace_from_bytes(
        "capture.h5", writer.save_workspace_to_bytes(), replace=True
    )
    assert reader._PROVENANCE.ledger.to_dict() == saved
    assert reader._PROVENANCE.state_status == {}
    reader._PROVENANCE.ledger.validate()
