# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Processing restores and applies again every recorded call (DataLab-Web).

After reopening a workspace, the Processing tab restores the call that produced
a result from the provenance ledger: 1-to-1, 2-to-1 and n-to-1 processing,
conversions between signals and images, with or without parameters, every
input in order. Applying it again keeps the result in place and records a new
activity describing all its inputs, on the final UUID of the result.
"""

from __future__ import annotations

import dataclasses
import os

import numpy as np
import pytest

if os.environ.get("DLW_REQUIRE_PROVENANCE") == "1":
    import datalab_capsule  # noqa: F401  # CI must not skip these tests
else:
    pytest.importorskip("datalab_capsule")

from test_provenance_difference import (  # noqa: E402
    A_MINUS_B,
    RULE,
    build_differences,
)
from test_provenance_workspace import X, Y, fresh_runtime  # noqa: E402


def reopen(writer):
    """Save *writer*'s workspace and reopen it in a fresh runtime.

    Returns:
        ``(reader, oid_of)``: the new runtime and a function mapping a writer
        object id to the reader object id.
    """
    data = writer.save_workspace_to_bytes()
    uuids = {
        oid: writer._object_uuid(entry.obj)
        for oid, entry in writer._MODEL._objects.items()
    }
    reader = fresh_runtime()
    reader.open_workspace_from_bytes("workspace.h5", data, replace=True)
    by_uuid = {
        reader._object_uuid(entry.obj): oid
        for oid, entry in reader._MODEL._objects.items()
    }
    return reader, lambda oid: by_uuid[uuids[oid]]


def inputs_of(bs, activity) -> list[tuple[str, str]]:
    """Return the ``(role, object uuid)`` inputs of an activity."""
    states = bs._PROVENANCE.ledger.states
    return [
        (item["role"], states[item["binding"]["state_id"]]["object_uuid"])
        for item in activity["call"]["inputs"]
    ]


def output_uuid(bs, activity) -> str:
    """Return the object UUID of the result of an activity."""
    states = bs._PROVENANCE.ledger.states
    return states[activity["outputs"][0]["state_id"]]["object_uuid"]


def uuid_of(bs, oid: str) -> str:
    """Return the persistent UUID of an object."""
    return bs._object_uuid(bs._MODEL.get(oid))


def test_filter_is_restored_with_typed_values_and_applied_again():
    """1-to-1: decoded parameters become form values; re-application recorded."""
    writer = fresh_runtime()
    s0 = writer.add_signal_from_arrays("S0", X, Y, xunit="s")
    (s1,) = writer.apply_feature("gaussian_filter", [s0], params={"sigma": 2.0})
    expected = writer.get_last_processing(s1)["values"]
    reader, oid_of = reopen(writer)
    record = reader.get_last_processing(oid_of(s1))
    assert record["values"] == expected
    assert record["inputs"] == [{"role": "source", "id": oid_of(s0), "title": "S0"}]
    assert record["unavailable_reason"] is None
    count = len(reader._PROVENANCE.ledger.activities)
    assert reader.reapply_last_processing(oid_of(s1), {"sigma": 5.0}) == oid_of(s1)
    activities = reader._PROVENANCE.ledger.activities
    assert len(activities) == count + 1
    activity = activities[-1]
    assert activity["origin"] == "recompute_in_place"
    assert activity["call"]["parameters"]["sigma"] == 5.0
    assert inputs_of(reader, activity) == [("source", uuid_of(reader, oid_of(s0)))]
    assert output_uuid(reader, activity) == uuid_of(reader, oid_of(s1))
    reader._PROVENANCE.ledger.validate()


def test_difference_records_source_and_operand_when_applied_again():
    """2-to-1: the re-application records the source and the operand."""
    writer = fresh_runtime()
    ids = build_differences(writer)
    reader, oid_of = reopen(writer)
    a, b, a_b = (oid_of(ids[name]) for name in ("A", "B", "A-B"))
    record = reader.get_last_processing(a_b)
    assert [(i["role"], i["id"]) for i in record["inputs"]] == [
        ("source", a),
        ("operand", b),
    ]
    reader._MODEL.get(a_b).y[:] = 0.0
    reader.reapply_last_processing(a_b, None, [a], b)
    activity = reader._PROVENANCE.ledger.activities[-1]
    assert activity["origin"] == "recompute_in_place"
    assert inputs_of(reader, activity) == [
        ("source", uuid_of(reader, a)),
        ("operand", uuid_of(reader, b)),
    ]
    assert activity["context"]["x_alignment"] == RULE
    assert output_uuid(reader, activity) == uuid_of(reader, a_b)
    assert np.array_equal(reader._MODEL.get(a_b).y, A_MINUS_B)
    report = reader.replay_activity(activity["activity_id"])
    assert report["verdict"] == "exact", report


@pytest.mark.parametrize(
    ("feature", "kind"), [("average", "signal"), ("image:average", "image")]
)
def test_average_without_parameters_restores_every_source(feature: str, kind: str):
    """n-to-1 without parameters: all sources restored, re-application recorded."""
    writer = fresh_runtime()
    if kind == "signal":
        sources = [
            writer.add_signal_from_arrays(f"S{i}", X, Y * (i + 1), xunit="s")
            for i in range(3)
        ]
    else:
        base = np.arange(12.0).reshape(3, 4)
        sources = [
            writer.add_image_from_array(f"I{i}", base * (i + 1)) for i in range(3)
        ]
    (mean,) = writer.apply_feature(feature, sources)
    reader, oid_of = reopen(writer)
    mean = oid_of(mean)
    sources = [oid_of(oid) for oid in sources]
    record = reader.get_last_processing(mean)
    assert record["pattern"] == "n_to_1" and not record["has_params"]
    assert record["source_ids"] == sources and record["operand_id"] is None
    assert [i["role"] for i in record["inputs"]] == ["sources"] * 3
    obj = reader._MODEL.get(mean)
    expected = (obj.data if kind == "image" else obj.y).copy()
    count = len(reader._PROVENANCE.ledger.activities)
    reader.reapply_last_processing(mean, None, sources, None)
    activities = reader._PROVENANCE.ledger.activities
    assert len(activities) == count + 1
    activity = activities[-1]
    assert inputs_of(reader, activity) == [
        ("sources", uuid_of(reader, oid)) for oid in sources
    ]
    assert output_uuid(reader, activity) == uuid_of(reader, mean)
    obj = reader._MODEL.get(mean)
    assert np.array_equal(obj.data if kind == "image" else obj.y, expected)
    reader._PROVENANCE.ledger.validate()


def test_two_input_aggregation_keeps_two_aggregation_roles():
    """n-to-1 with two inputs is not turned into a source and an operand."""
    writer = fresh_runtime()
    a = writer.add_signal_from_arrays("A", X, Y, xunit="s")
    b = writer.add_signal_from_arrays("B", X, Y * 3, xunit="s")
    (mean,) = writer.apply_feature("average", [a, b])
    reader, oid_of = reopen(writer)
    record = reader.get_last_processing(oid_of(mean))
    assert record["source_ids"] == [oid_of(a), oid_of(b)]
    assert record["operand_id"] is None
    reader.reapply_last_processing(oid_of(mean), None)
    activity = reader._PROVENANCE.ledger.activities[-1]
    assert [role for role, _uid in inputs_of(reader, activity)] == ["sources"] * 2


def test_signals_to_image_keeps_its_parameters():
    """Conversion signals -> image: parameters and every source restored."""
    writer = fresh_runtime()
    sources = [
        writer.add_signal_from_arrays(f"S{i}", X, Y + i, xunit="s") for i in range(3)
    ]
    params = {"orientation": "columns", "normalize": False}
    (image,) = writer.apply_feature("signals_to_image", sources, params=params)
    expected = writer.get_last_processing(image)["values"]
    reader, oid_of = reopen(writer)
    image = oid_of(image)
    record = reader.get_last_processing(image)
    assert record["values"] == expected
    assert record["values"]["orientation"].lower() == "columns"
    shape = reader._MODEL.get(image).data.shape
    rows = "ROWS" if record["values"]["orientation"] == "COLUMNS" else "rows"
    values = dict(record["values"], orientation=rows)
    reader.reapply_last_processing(image, values)
    assert reader._MODEL.get(image).data.shape == shape[::-1]
    activity = reader._PROVENANCE.ledger.activities[-1]
    assert activity["call"]["parameters"]["orientation"] == "rows"
    assert inputs_of(reader, activity) == [
        ("sources", uuid_of(reader, oid_of(oid))) for oid in sources
    ]
    assert output_uuid(reader, activity) == uuid_of(reader, image)


def test_image_to_signal_conversion():
    """Conversion image -> signal: restored and applied again."""
    writer = fresh_runtime()
    image = writer.add_image_from_array("I", np.outer(np.hanning(32), np.hanning(32)))
    params = {"center": "user", "x0": 16, "y0": 16}
    (profile,) = writer.apply_feature("image:radial_profile", [image], params=params)
    reader, oid_of = reopen(writer)
    record = reader.get_last_processing(oid_of(profile))
    assert (record["values"]["x0"], record["values"]["y0"]) == (16, 16)
    reader.reapply_last_processing(
        oid_of(profile), dict(record["values"], x0=10, y0=10)
    )
    activity = reader._PROVENANCE.ledger.activities[-1]
    assert inputs_of(reader, activity) == [("source", uuid_of(reader, oid_of(image)))]
    assert output_uuid(reader, activity) == uuid_of(reader, oid_of(profile))


def test_missing_input_keeps_the_record_and_refuses():
    """A deleted input stays listed as missing; nothing is substituted."""
    writer = fresh_runtime()
    sources = [
        writer.add_signal_from_arrays(f"S{i}", X, Y * (i + 1), xunit="s")
        for i in range(3)
    ]
    (mean,) = writer.apply_feature("average", sources)
    writer.delete_object(sources[1])
    deleted_uuid = None
    reader, oid_of = reopen(writer)
    states = reader._PROVENANCE.ledger.states
    activity = reader._PROVENANCE.ledger.activities[0]
    deleted_uuid = states[activity["call"]["inputs"][1]["binding"]["state_id"]][
        "object_uuid"
    ]
    record = reader.get_last_processing(oid_of(mean))
    assert record["missing_source_ids"] == [deleted_uuid]
    assert record["inputs"][1] == {"role": "sources", "id": deleted_uuid, "title": None}
    count = len(reader._PROVENANCE.ledger.activities)
    with pytest.raises(ValueError, match="no longer exist"):
        reader.reapply_last_processing(oid_of(mean), None)
    assert len(reader._PROVENANCE.ledger.activities) == count


def test_unqualified_operation_is_restored(monkeypatch):
    """Knowing an operation is enough for Processing; verification refuses."""
    writer = fresh_runtime()
    s0 = writer.add_signal_from_arrays("S0", X, Y, xunit="s")
    writer.apply_feature("normalize", [s0], params={"method": "maximum"})
    data = writer.save_workspace_to_bytes()
    reader = fresh_runtime()
    monkeypatch.setattr(
        reader._PROVENANCE,
        "computation",
        dataclasses.replace(
            reader._PROVENANCE.computation,
            qualification_status=lambda _contract: "not_qualified",
        ),
    )
    reader.open_workspace_from_bytes("workspace.h5", data, replace=True)
    (result,) = [
        oid for oid, entry in reader._MODEL._objects.items() if entry.obj.title != "S0"
    ]
    record = reader.get_last_processing(result)
    assert record is not None and record["feature_id"] == "normalize"
    reader.reapply_last_processing(result, {"method": "amplitude"})
    activity = reader._PROVENANCE.ledger.activities[-1]
    report = reader.replay_activity(activity["activity_id"])
    assert report["eligibility"] == "unsupported_contract"


def test_failed_reapplication_records_nothing(monkeypatch):
    """An error leaves the result and the ledger unchanged."""
    bs = fresh_runtime()
    sources = [
        bs.add_signal_from_arrays(f"S{i}", X, Y * (i + 1), xunit="s") for i in range(2)
    ]
    (mean,) = bs.apply_feature("average", sources)
    before = bs._MODEL.get(mean).y.copy()
    count = len(bs._PROVENANCE.ledger.activities)

    def failing(*_args, **_kwargs):
        raise RuntimeError("simulated failure")

    monkeypatch.setattr(bs._PROCESSOR, "apply", failing)
    with pytest.raises(RuntimeError):
        bs.reapply_last_processing(mean, None)
    assert len(bs._PROVENANCE.ledger.activities) == count
    assert np.array_equal(bs._MODEL.get(mean).y, before)


def _oid(bs, object_uuid: str) -> str:
    (oid,) = [
        oid
        for oid, entry in bs._MODEL._objects.items()  # noqa: SLF001
        if bs._object_uuid(entry.obj) == object_uuid
    ]
    return oid


def test_desktop_files_are_described_and_applied_again():
    """Reference files written by DataLab Desktop: consulted, restored, reapplied."""
    from test_provenance_workspace import FIXTURES  # noqa: PLC0415

    bs = fresh_runtime()
    bs.open_workspace_from_bytes(
        "chain.h5", (FIXTURES / "desktop_chain.h5").read_bytes(), replace=True
    )
    ledger = bs._PROVENANCE.ledger
    _a1, a2, _a3, _a4 = ledger.activities
    s1, s2 = _oid(bs, inputs_of(bs, a2)[0][1]), _oid(bs, output_uuid(bs, a2))
    view = bs.describe_object_provenance(s2, check_data=True)
    production = view["production"]
    assert production["activity_id"] == a2["activity_id"]
    assert production["environment"]["edition"] == "desktop"
    assert production["inputs"][0]["id"] == s1
    assert view["anchor"]["content"] == "matches"
    record = bs.get_last_processing(s2)
    assert record["feature_id"] == "normalize" and record["pattern"] == "1_to_1"
    assert record["inputs"][0]["id"] == s1 and record["unavailable_reason"] is None
    assert bs.reapply_last_processing(s2, {"method": "amplitude"}) == s2
    activity = bs._PROVENANCE.ledger.activities[-1]
    assert (activity["edition"], activity["origin"]) == ("web", "recompute_in_place")
    assert inputs_of(bs, activity) == [("source", uuid_of(bs, s1))]
    assert output_uuid(bs, activity) == uuid_of(bs, s2)

    bs = fresh_runtime()
    bs.open_workspace_from_bytes(
        "diff.h5", (FIXTURES / "desktop_difference.h5").read_bytes(), replace=True
    )
    act_ab, _act_ba = bs._PROVENANCE.ledger.activities
    (source, a_uuid), (operand, b_uuid) = inputs_of(bs, act_ab)
    assert (source, operand) == ("source", "operand")
    a_b = _oid(bs, output_uuid(bs, act_ab))
    record = bs.get_last_processing(a_b)
    assert [(i["role"], i["id"]) for i in record["inputs"]] == [
        ("source", _oid(bs, a_uuid)),
        ("operand", _oid(bs, b_uuid)),
    ]
    bs._MODEL.get(a_b).y[:] = 0.0
    bs.reapply_last_processing(a_b, None, [_oid(bs, a_uuid)], _oid(bs, b_uuid))
    assert np.array_equal(bs._MODEL.get(a_b).y, A_MINUS_B)
    activity = bs._PROVENANCE.ledger.activities[-1]
    assert activity["context"]["x_alignment"] == RULE
    assert bs.replay_activity(activity["activity_id"])["verdict"] == "exact"
