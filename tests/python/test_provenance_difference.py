# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Signal difference: X alignment on the source grid, capture and verification."""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pytest

if os.environ.get("DLW_REQUIRE_PROVENANCE") == "1":
    import datalab_capsule  # noqa: F401  # CI must not skip these tests
else:
    pytest.importorskip("datalab_capsule")

from test_provenance_workspace import fresh_runtime  # noqa: E402

FIXTURES = Path(__file__).parents[1] / "fixtures" / "provenance"
# Asymmetric case where both orders are valid (exact analytical oracles).
A_X, A_Y = [0.0, 1.0, 2.0, 3.0], [0.0, 1.0, 4.0, 9.0]
B_X, B_Y = [0.0, 1.5, 3.0], [0.0, 3.0, 6.0]
A_MINUS_B = [0.0, -1.0, 0.0, 3.0]
B_MINUS_A = [0.0, 0.5, -3.0]
DIFFERENCE = {"id": "sigima.signal.difference", "contract_version": 1}
RULE = {
    "rule": "sigima.signal.x_alignment.source_grid_linear",
    "version": 1,
    "interpolated": True,
}


def add(bs, x, y, title: str, yunit: str = "V") -> str:
    """Add a signal and return its object id."""
    return bs.add_signal_from_arrays(
        title, np.array(x, dtype=float), np.array(y, dtype=float), "s", yunit
    )


def roles(bs, activity) -> list[tuple[str, str]]:
    """Return the ``(role, object uuid)`` inputs of an activity."""
    states = bs._PROVENANCE.ledger.states
    return [
        (item["role"], states[item["binding"]["state_id"]]["object_uuid"])
        for item in activity["call"]["inputs"]
    ]


def build_differences(bs) -> dict[str, str]:
    """Compute A - B and B - A; return the object ids."""
    a = add(bs, A_X, A_Y, "A")
    b = add(bs, B_X, B_Y, "B")
    (a_b,) = bs.apply_feature("difference", [a], operand_id=b)
    (b_a,) = bs.apply_feature("difference", [b], operand_id=a)
    return {"A": a, "B": b, "A-B": a_b, "B-A": b_a}


def check_differences(bs, edition: str = "web") -> None:
    """Check the two recorded differences of a workspace and replay them."""
    ledger = bs._PROVENANCE.ledger
    ledger.validate()
    act_ab, act_ba = ledger.activities
    sources, operands = [], []
    for activity in (act_ab, act_ba):
        assert activity["edition"] == edition
        assert activity["call"]["operation"] == DIFFERENCE
        assert activity["call"]["parameters"] == {}
        assert activity["context"]["x_alignment"] == RULE
        (source, uid1), (operand, uid2) = roles(bs, activity)
        assert (source, operand) == ("source", "operand")
        sources.append(uid1)
        operands.append(uid2)
    assert sources == operands[::-1]
    for activity, expected in ((act_ab, A_MINUS_B), (act_ba, B_MINUS_A)):
        state = ledger.states[activity["outputs"][0]["state_id"]]
        result = bs._find_object_by_uuid(state["object_uuid"])
        assert np.array_equal(result.y, expected)
    tree = bs.get_panel_tree("signal")
    for activity in (act_ab, act_ba):
        report = bs.replay_activity(activity["activity_id"])
        assert report["verdict"] == "exact", report
        assert report["context"]["x_alignment"] == RULE
    assert bs.get_panel_tree("signal") == tree
    assert len(ledger.activities) == 2


def test_same_size_and_ends_are_not_the_same_grid(fresh_bootstrap):
    """[0, 1, 2] and [0, 0.5, 2] differ: no index-by-index subtraction."""
    bs = fresh_bootstrap
    source = add(bs, [0, 1, 2], [0, 1, 2], "source")
    operand = add(bs, [0, 0.5, 2], [0, 0.5, 2], "operand")
    (result,) = bs.apply_feature("difference", [source], operand_id=operand)
    assert np.array_equal(bs._MODEL.get(result).x, [0.0, 1.0, 2.0])
    assert np.array_equal(bs._MODEL.get(result).y, [0.0, 0.0, 0.0])


def test_capture_and_verification(fresh_bootstrap):
    """Roles, original inputs and the rule are recorded; replays are exact."""
    bs = fresh_bootstrap
    ids = build_differences(bs)
    for name, x, y in (("A", A_X, A_Y), ("B", B_X, B_Y)):
        obj = bs._MODEL.get(ids[name])
        assert np.array_equal(obj.x, x) and np.array_equal(obj.y, y)
    assert np.array_equal(bs._MODEL.get(ids["A-B"]).x, A_X)
    assert np.array_equal(bs._MODEL.get(ids["B-A"]).x, B_X)
    act_ab, _act_ba = bs._PROVENANCE.ledger.activities
    uuid = bs._object_uuid
    assert roles(bs, act_ab) == [
        ("source", uuid(bs._MODEL.get(ids["A"]))),
        ("operand", uuid(bs._MODEL.get(ids["B"]))),
    ]
    check_differences(bs)


def test_group_selection_records_the_rule(fresh_bootstrap):
    """A group-exclusive difference records each pair with the rule."""
    bs = fresh_bootstrap
    a = add(bs, A_X, A_Y, "A")
    b = add(bs, B_X, B_Y, "B")
    gid = bs._MODEL.panel("signal").find_group_of(a).gid
    bs.apply_feature("difference", [a], operand_id=b, group_ids=[gid])
    (activity,) = bs._PROVENANCE.ledger.activities
    assert activity["context"]["x_alignment"] == RULE
    assert bs.replay_activity(activity["activity_id"])["verdict"] == "exact"


def test_swapped_roles_give_a_different_result(fresh_bootstrap):
    """Replaying with the roles swapped computes the other difference."""
    bs = fresh_bootstrap
    build_differences(bs)
    act_ab = bs._PROVENANCE.ledger.activities[0]
    inputs = act_ab["call"]["inputs"]
    inputs[0]["binding"], inputs[1]["binding"] = (
        inputs[1]["binding"],
        inputs[0]["binding"],
    )
    report = bs.replay_activity(act_ab["activity_id"])
    assert report["eligibility"] == "ready"
    assert report["verdict"] == "different"


def test_verification_refusals(fresh_bootstrap, counted_apply):
    """Missing or changed operands and unknown rules are refused, uncomputed."""
    bs = fresh_bootstrap
    ids = build_differences(bs)
    act_ab = bs._PROVENANCE.ledger.activities[0]
    act_id = act_ab["activity_id"]
    count = counted_apply["count"]

    for recorded in (dict(RULE, version=2), dict(RULE, rule="unknown.rule"), None):
        act_ab["context"]["x_alignment"] = recorded
        report = bs.replay_activity(act_id)
        assert report["eligibility"] == "unsupported_context"
    act_ab["context"]["x_alignment"] = dict(RULE)

    operand = bs._MODEL.get(ids["B"])
    operand.set_xydata(operand.x, np.array([0.0, 3.0, 7.0]))
    report = bs.replay_activity(act_id)
    assert (report["eligibility"], report["verdict"]) == (
        "input_changed",
        "not_verified",
    )
    bs.delete_object(ids["B"])
    assert bs.replay_activity(act_id)["eligibility"] == "missing_input"
    assert counted_apply["count"] == count


def test_refused_alignment_creates_nothing(fresh_bootstrap):
    """An uncovered or unit-mismatched operand raises; nothing is created."""
    from sigima.proc.alignment import XAlignmentError

    bs = fresh_bootstrap
    source = add(bs, [0, 1, 2], [0, 1, 2], "source")
    short = add(bs, [0.5, 1, 2], [0, 1, 2], "short")
    millivolts = add(bs, [0, 1, 2], [0, 1, 2], "mV", yunit="mV")
    tree = bs.get_panel_tree("signal")
    for operand, code in (
        (short, "insufficient_coverage"),
        (millivolts, "incompatible_units"),
    ):
        with pytest.raises(XAlignmentError) as info:
            bs.apply_feature("difference", [source], operand_id=operand)
        assert info.value.code == code
    assert bs.get_panel_tree("signal") == tree
    assert bs._PROVENANCE.ledger.activities == ()


def test_other_two_input_operations_are_opaque(fresh_bootstrap):
    """Other 2-to-1 operations keep their behaviour and are captured opaque."""
    bs = fresh_bootstrap
    a = add(bs, [0, 1, 2], [2, 4, 6], "A")
    b = add(bs, [0, 1, 2], [1, 2, 3], "B")
    bs.apply_feature("division", [a], operand_id=b)
    (activity,) = bs._PROVENANCE.ledger.activities
    assert activity["call"]["operation"] is None
    assert [role for role, _uid in roles(bs, activity)] == ["source", "operand"]
    assert activity["context"]["x_alignment"] is None
    assert bs.replay_activity(activity["activity_id"])["restoration"] == "opaque"


def test_round_trip_in_a_fresh_runtime():
    """Saved and reopened in a fresh runtime, both differences replay exactly."""
    writer = fresh_runtime()
    build_differences(writer)
    saved = writer._PROVENANCE.ledger.to_dict()
    data = writer.save_workspace_to_bytes()
    reader = fresh_runtime()
    reader.open_workspace_from_bytes("differences.h5", data, replace=True)
    assert reader._PROVENANCE.ledger.to_dict() == saved
    check_differences(reader)


def test_processing_tab_records_keep_the_operand():
    """Reopened differences get their Processing-tab record with the operand."""
    writer = fresh_runtime()
    ids = build_differences(writer)
    reader = fresh_runtime()
    reader.open_workspace_from_bytes(
        "differences.h5", writer.save_workspace_to_bytes(), replace=True
    )
    oid_of = {
        reader._object_uuid(e.obj): oid for oid, e in reader._MODEL._objects.items()
    }
    a, b, a_b = (
        oid_of[writer._object_uuid(writer._MODEL.get(ids[name]))]
        for name in ("A", "B", "A-B")
    )
    record = reader.get_last_processing(a_b)
    assert record["feature_id"] == "difference"
    assert (record["source_ids"], record["operand_id"]) == ([a], b)


@pytest.mark.parametrize(
    "name, edition",
    [("web_difference.h5", "web"), ("desktop_difference.h5", "desktop")],
)
def test_reference_files(name: str, edition: str):
    """Reference files of both editions reopen and replay here."""
    bs = fresh_runtime()
    bs.open_workspace_from_bytes(name, (FIXTURES / name).read_bytes(), replace=True)
    check_differences(bs, edition)


def test_fingerprints_match_across_runtimes():
    """CPython, Pyodide (Web file) and Desktop record the same state fingerprints."""

    def fingerprints(ledger) -> list[list[dict]]:
        states = ledger.states
        return [
            [
                states[i["binding"]["state_id"]]["fingerprint"]
                for i in a["call"]["inputs"]
            ]
            + [states[a["outputs"][0]["state_id"]]["fingerprint"]]
            for a in ledger.activities
        ]

    writer = fresh_runtime()
    build_differences(writer)
    expected = fingerprints(writer._PROVENANCE.ledger)
    for name in ("web_difference.h5", "desktop_difference.h5"):
        bs = fresh_runtime()
        bs.open_workspace_from_bytes(name, (FIXTURES / name).read_bytes(), replace=True)
        assert fingerprints(bs._PROVENANCE.ledger) == expected, name
