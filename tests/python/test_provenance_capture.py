# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Provenance capture of images, analyses, n-to-1 operations, ROI and uncertainty."""

from __future__ import annotations

import asyncio
import io
import os
from pathlib import Path

import h5py
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


def _reopen(bs, edit=None):
    """Save the workspace, optionally edit the file, reopen it in a new runtime."""
    data = bs.save_workspace_to_bytes()
    if edit is not None:
        buffer = io.BytesIO(data)
        with h5py.File(buffer, "r+") as h5file:
            edit(h5file)
        data = buffer.getvalue()
    reader = fresh_runtime()
    reader.open_workspace_from_bytes("w.h5", data, replace=True)
    return reader


def _node_of(h5file, object_uuid: str):
    """Return the HDF5 group of the object with *object_uuid*."""
    for panel in ("DataLab_Sig", "DataLab_Ima"):
        for group in h5file.get(panel, {}).values():
            for obj in group.values():
                if obj["metadata"].attrs["__uuid"] == object_uuid:
                    return obj
    raise KeyError(object_uuid)


def _image_with_roi(bs) -> tuple[str, dict]:
    """Filter an image holding a ROI; return its id and the recorded activity."""
    oid = add_image(bs)
    bs._MODEL.get(oid).roi = sigima.objects.create_image_roi("rectangle", [0, 0, 2, 2])
    bs.apply_feature("image:gaussian_filter", [oid], params={"sigma": 1.0})
    return oid, ledger(bs).activities[-1]


def test_roi_only_change_is_a_new_state(fresh_bootstrap):
    """Same pixels, different ROI: a new state is recorded, not reused."""
    bs = fresh_bootstrap
    oid, first = _image_with_roi(bs)
    bs._MODEL.get(oid).roi = sigima.objects.create_image_roi("rectangle", [0, 0, 3, 2])
    bs.apply_feature("image:gaussian_filter", [oid], params={"sigma": 1.0})
    second = ledger(bs).activities[-1]
    before, after = inputs_of(bs, first)[0], inputs_of(bs, second)[0]
    assert before["state_id"] != after["state_id"]
    assert before["fingerprint"] == after["fingerprint"]
    assert before["roi"]["digest"] != after["roi"]["digest"]


@pytest.mark.parametrize(
    "path, edit",
    [
        (
            "roi",
            lambda n: n["metadata/_roi_/single_rois/__seq0/coords"].__setitem__(2, 3.0),
        ),
        ("roi_removed", lambda n: n["metadata"].__delitem__("_roi_")),
        ("x0", lambda n: n.attrs.__setitem__("x0", 0.5)),
        ("dy", lambda n: n.attrs.__setitem__("dy", 2.0)),
        ("zunit", lambda n: n.attrs.__setitem__("zunit", "V")),
    ],
)
def test_roi_calibration_or_unit_change_in_file_is_altered(fresh_bootstrap, path, edit):
    """Unchanged pixels with another ROI, calibration or unit are not intact."""
    bs = fresh_bootstrap
    oid, activity = _image_with_roi(bs)
    object_uuid = uuid_of(bs, oid)
    reader = _reopen(bs)
    assert reader._PROVENANCE.state_status == {}
    source = activity["call"]["inputs"][0]["binding"]["state_id"]
    assert (
        reader._PROVENANCE.observe(reader._find_object_by_uuid(object_uuid)) == source
    )
    reader = _reopen(bs, lambda f: edit(_node_of(f, object_uuid)))
    assert reader._PROVENANCE.state_status[source] == "altered"
    # The reopened object is not taken for the recorded state either.
    assert (
        reader._PROVENANCE.observe(reader._find_object_by_uuid(object_uuid)) != source
    )


def test_replaced_analysis_result_is_not_attributed(fresh_bootstrap):
    """Two analyses replacing the same result: the first is reported replaced."""
    bs = fresh_bootstrap
    oid = add_signal(bs)
    asyncio.run(bs.run_signal_analysis(oid, "stats"))
    bs._MODEL.get(oid).set_xydata(X, Y * 2.0)
    asyncio.run(bs.run_signal_analysis(oid, "stats"))
    first, second = ledger(bs).activities
    key = first["outputs"][0]["artifact"]["key"]
    assert second["outputs"][0]["artifact"]["key"] == key
    assert (
        first["outputs"][0]["artifact"]["digest"]
        != second["outputs"][0]["artifact"]["digest"]
    )
    expected = {first["activity_id"]: "replaced", second["activity_id"]: "available"}
    for runtime in (bs, _reopen(bs)):
        statuses = runtime.get_provenance_ledger()["artifact_status"]
        assert {k: v[0]["status"] for k, v in statuses.items()} == expected
    reader = _reopen(
        bs, lambda f: _node_of(f, uuid_of(bs, oid))["metadata"].__delitem__(key)
    )
    statuses = reader.get_provenance_ledger()["artifact_status"]
    assert {v[0]["status"] for v in statuses.values()} == {"missing"}


# -- Cross-edition reference files ----------------------------------------
#
# The same scenario is written by each edition: an image with a rectangular ROI
# (x0=0, y0=0, dx=2, dy=2) analysed (centroid) then filtered (Gaussian, sigma=1),
# and a signal analysed (statistics). DataLab-Web writes ``web_capture.h5`` from
# Pyodide (``provenance_capture.spec.ts``, ``DLW_WRITE_PROVENANCE_FIXTURE=1``);
# DataLab Desktop writes ``desktop_capture.h5``
# (``datalab/tests/features/common/provenance_capture_unit_test.py``).

FIXTURES = Path(__file__).parents[1] / "fixtures" / "provenance"
CAPTURE_SHAPE = [
    ("image", None, "geometry"),
    ("image", "image", None),
    ("signal", None, "table"),
]


def build_capture(bs) -> None:
    """Run the cross-edition capture scenario."""
    image = add_image(bs)
    bs.set_image_roi(
        image, [{"geometry": "rectangle", "x0": 0, "y0": 0, "dx": 2, "dy": 2}]
    )
    asyncio.run(bs.run_image_analysis(image, "centroid"))
    bs.apply_feature("image:gaussian_filter", [image], params={"sigma": 1.0})
    asyncio.run(bs.run_signal_analysis(add_signal(bs), "stats"))


def check_capture(bs, edition: str) -> None:
    """Check a reopened capture workspace written by *edition*."""
    provenance = bs._PROVENANCE
    ledger(bs).validate()
    assert provenance.state_status == {}
    statuses = bs.get_provenance_ledger()["artifact_status"]
    shape = []
    for activity in ledger(bs).activities:
        assert activity["edition"] == edition
        (source,) = inputs_of(bs, activity)
        (output,) = activity["outputs"]
        result = ledger(bs).states[output["state_id"]] if "state_id" in output else None
        artifact = output.get("artifact")
        shape.append(
            (source["kind"], result and result["kind"], artifact and artifact["kind"])
        )
        if source["kind"] == "image":
            (roi,) = source["roi"]["definition"]["single_rois"]
            assert roi["coords"] == [0, 0, 2, 2]
        if artifact is not None:
            assert [s["status"] for s in statuses[activity["activity_id"]]] == [
                "available"
            ]
    assert shape == CAPTURE_SHAPE
    centroid, gaussian, _stats = ledger(bs).activities
    assert centroid["call"]["inputs"] == gaussian["call"]["inputs"]
    # Every reopened object is recognised as its latest recorded state, ROI
    # included, by this edition's own reading of the other edition's file.
    for object_uuid in ledger(bs).object_uuids():
        obj = bs._find_object_by_uuid(object_uuid)
        latest = ledger(bs).latest_state(object_uuid)["state_id"]
        assert provenance.observe(obj) == latest


def test_capture_round_trip(fresh_bootstrap):
    """The capture scenario reopens intact in a fresh runtime."""
    bs = fresh_bootstrap
    build_capture(bs)
    check_capture(_reopen(bs), "web")


@pytest.mark.parametrize(
    "name, edition", [("web_capture.h5", "web"), ("desktop_capture.h5", "desktop")]
)
def test_capture_reference_files(name: str, edition: str):
    """Reference capture files of both editions reopen intact in this runtime."""
    bs = fresh_runtime()
    bs.open_workspace_from_bytes(name, (FIXTURES / name).read_bytes(), replace=True)
    check_capture(bs, edition)


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
