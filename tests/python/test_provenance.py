# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the workspace provenance ledger of the browser runtime."""

from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("datalab_capsule")

X = np.array([0.0, 1.0, 2.0, 3.0])
Y = np.array([-2.0, 0.0, 1.0, 4.0])
MAXIMUM_Y = np.array([-0.5, 0.0, 0.25, 1.0])
AMPLITUDE_Y = np.array([0.0, 1 / 3, 0.5, 1.0])
NORMALIZE = {"id": "sigima.signal.normalize", "contract_version": 1}


def add_signal(bs, y=Y, title: str = "oracle") -> str:
    """Add a signal and return its object id."""
    return bs.add_signal_from_arrays(title, X, np.asarray(y, dtype=float))


def uuid_of(bs, oid: str) -> str:
    """Return the persistent UUID of object *oid*."""
    return bs._object_uuid(bs._MODEL.get(oid))


def ledger(bs):
    """Return the live provenance ledger."""
    return bs._PROVENANCE.ledger


def state(bs, state_id: str) -> dict:
    """Return a ledger state."""
    return ledger(bs).states[state_id]


def input_state(bs, activity) -> dict:
    """Return the source state of an activity."""
    return state(bs, activity["call"]["inputs"][0]["binding"]["state_id"])


def output_state(bs, activity) -> dict:
    """Return the result state of an activity."""
    return state(bs, activity["outputs"][0]["state_id"])


def test_apply_feature_records_a_qualified_activity(fresh_bootstrap):
    bs = fresh_bootstrap
    src = add_signal(bs)
    (result,) = bs.apply_feature("normalize", [src], params={"method": "maximum"})
    np.testing.assert_array_equal(bs._MODEL.get(result).y, MAXIMUM_Y)
    (activity,) = ledger(bs).activities
    assert activity["call"]["operation"] == NORMALIZE
    assert activity["call"]["parameters"] == {"method": "maximum"}
    assert activity["origin"] == "ordinary"
    assert activity["edition"] == "web"
    assert input_state(bs, activity)["object_uuid"] == uuid_of(bs, src)
    assert output_state(bs, activity)["object_uuid"] == uuid_of(bs, result)
    ledger(bs).validate()
    info = bs.get_provenance_ledger()
    assert info["available"] is True
    assert len(info["ledger"]["activities"]) == 1


def test_selected_group_shares_one_command(fresh_bootstrap):
    bs = fresh_bootstrap
    first = add_signal(bs, title="A")
    second = add_signal(bs, Y * 2, title="B")
    gid = bs._MODEL.panel("signal").find_group_of(first).gid
    results = bs.apply_feature("normalize", [first, second], group_ids=[gid])
    activities = ledger(bs).activities
    assert len(activities) == 2
    assert activities[0]["command_id"] == activities[1]["command_id"]
    for activity, source, result in zip(activities, (first, second), results):
        assert input_state(bs, activity)["object_uuid"] == uuid_of(bs, source)
        assert output_state(bs, activity)["object_uuid"] == uuid_of(bs, result)


def test_adopted_preview_records_its_parameters(fresh_bootstrap):
    bs = fresh_bootstrap
    src = add_signal(bs)
    params = {"method": "amplitude"}
    bs.preview_feature("normalize", src, params, preview_token="token")
    assert ledger(bs).activities == ()
    (result,) = bs.apply_feature(
        "normalize", [src], params=params, preview_token="token"
    )
    np.testing.assert_allclose(bs._MODEL.get(result).y, AMPLITUDE_Y)
    (activity,) = ledger(bs).activities
    assert activity["call"]["parameters"] == params
    assert output_state(bs, activity)["object_uuid"] == uuid_of(bs, result)


def test_unqualified_operation_is_recorded_as_opaque(fresh_bootstrap):
    bs = fresh_bootstrap
    src = add_signal(bs)
    bs.apply_feature("moving_average", [src], params={"n": 3})
    (activity,) = ledger(bs).activities
    assert activity["call"]["operation"] is None
    assert activity["call"]["parameters"]["n"] == 3


def test_reapply_keeps_uuid_and_records_recompute(fresh_bootstrap):
    bs = fresh_bootstrap
    src = add_signal(bs)
    (result,) = bs.apply_feature("normalize", [src], params={"method": "maximum"})
    result_uuid = uuid_of(bs, result)
    with pytest.raises(ValueError, match="do not match"):
        bs.reapply_last_processing(result, {"method": "amplitude"}, source_ids=[result])
    assert (
        bs.reapply_last_processing(
            result, {"method": "amplitude"}, source_ids=[src], operand_id=None
        )
        == result
    )
    assert uuid_of(bs, result) == result_uuid
    first, second = ledger(bs).activities
    assert second["origin"] == "recompute_in_place"
    assert second["call"]["parameters"] == {"method": "amplitude"}
    assert output_state(bs, second)["object_uuid"] == result_uuid
    assert output_state(bs, first)["state_id"] != output_state(bs, second)["state_id"]
    report = bs.replay_activity(second["activity_id"])
    assert report["verdict"] == "exact"
    # The superseded result state is no longer the object's current state.
    report = bs.replay_activity(first["activity_id"])
    assert report["reference"]["status"] == "altered"
    assert report["verdict"] == "not_verified"


def test_replay_activity_verifies_without_changing_the_workspace(fresh_bootstrap):
    bs = fresh_bootstrap
    src = add_signal(bs)
    (result,) = bs.apply_feature("normalize", [src], params={"method": "maximum"})
    (activity,) = ledger(bs).activities
    tree = bs.get_panel_tree("signal")
    report = bs.replay_activity(activity["activity_id"])
    assert report["verdict"] == "exact"
    assert report["restoration"] == "replayable"
    assert report["eligibility"] == "ready"
    assert report["reference"]["status"] == "available"
    assert bs.get_panel_tree("signal") == tree
    assert len(ledger(bs).activities) == 1

    obj = bs._MODEL.get(result)
    obj.set_xydata(obj.x, obj.y + np.array([0.0, 0.0, 0.0, 0.5]))
    report = bs.replay_activity(activity["activity_id"])
    assert report["reference"]["status"] == "altered"
    assert report["verdict"] == "not_verified"

    bs.delete_object(src)
    report = bs.replay_activity(activity["activity_id"])
    assert report["eligibility"] == "missing_input"
    assert report["verdict"] == "not_verified"


def test_spilled_objects_are_never_fingerprinted(fresh_bootstrap):
    bs = fresh_bootstrap
    src = add_signal(bs)
    assert bs.detach_object_array(src)
    failures = bs._PROVENANCE.capture_failures
    spec = bs._CATALOG["normalize"]
    assert bs._begin_provenance(spec, None, [bs._MODEL.get(src)], [src]) == {}
    assert bs._PROVENANCE.capture_failures == failures + 1
    assert not ledger(bs).states


def test_reset_all_starts_an_empty_ledger(fresh_bootstrap):
    bs = fresh_bootstrap
    bs.apply_feature("normalize", [add_signal(bs)])
    assert ledger(bs).activities
    bs.reset_all()
    assert ledger(bs).activities == ()


def test_processing_runs_unchanged_without_capsule(fresh_bootstrap):
    bs = fresh_bootstrap
    bs._PROVENANCE.ledger = None
    (result,) = bs.apply_feature("normalize", [add_signal(bs)], params={})
    assert bs._MODEL.has(result)
    info = bs.get_provenance_ledger()
    assert info["available"] is False
    assert info["ledger"] is None
