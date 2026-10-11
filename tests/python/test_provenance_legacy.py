# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Legacy workspaces: processing records saved without provenance (DataLab-Web).

The reference file was saved by the released DataLab 1.3.0 (Sigima 1.2.0) with
DataLab's ``scripts/provenance_legacy_fixture.py``: S0 -> normalize -> S1 ->
moving average -> S2; average of S0 and T (T then deleted) -> S3; statistics on
S1; image I with a ROI -> Gaussian filter -> J; centroid on I.
"""

from __future__ import annotations

import io
import os
from pathlib import Path

import h5py
import pytest

if os.environ.get("DLW_REQUIRE_PROVENANCE") == "1":
    import datalab_capsule  # noqa: F401  # CI must not skip these tests
else:
    pytest.importorskip("datalab_capsule")

from test_provenance_workspace import fresh_runtime  # noqa: E402

LEGACY = Path(__file__).parents[1] / "fixtures" / "provenance" / "legacy_1.3.0.h5"
# Holder title prefix, record key, operation, input titles (None: missing), issues.
# DataLab-Web never compares versions (see ``WebProvenance.load``).
EXPECTED = [
    ("normalize", "__processing_parameters", "normalize", ["S0"], []),
    ("normalize", "__analysis_parameters", "stats", None, ["result_not_identified"]),
    ("moving_average", "__processing_parameters", "moving_average", None, []),
    (
        "\u00b5(s001",
        "__processing_parameters",
        "average",
        ["S0", None],
        ["unavailable_input"],
    ),
    ("I", "__analysis_parameters", "centroid", ["I"], ["result_not_identified"]),
    ("gaussian_filter", "__processing_parameters", "gaussian_filter", ["I"], []),
]


def _title(bs, uid: str) -> str | None:
    obj = bs._find_object_by_uuid(uid)
    return None if obj is None else obj.title


def check_legacy(bs) -> None:
    """Check the activities imported from the reference legacy workspace."""
    info = bs.get_provenance_ledger()
    bs._PROVENANCE.ledger.validate()
    legacy = info["legacy"]
    assert legacy["activities"] == len(EXPECTED)
    for item, (title, key, operation, inputs, issues) in zip(legacy["items"], EXPECTED):
        assert _title(bs, item["object_uuid"]).startswith(title)
        assert (item["key"], item["operation"]) == (key, operation)
        assert item["issues"] == issues
        if inputs is not None:
            assert [_title(bs, uid) for uid in item["inputs"]] == inputs
    activities = bs._PROVENANCE.ledger.activities
    for activity in activities:
        assert activity["origin"] == "legacy_metadata"
        assert activity["call"]["operation"] is None
        assert activity["call"]["parameters"] is None
        assert activity["environment_id"] is None and activity["edition"] is None
    assert activities[0]["legacy"]["parameters"] == {
        "class": "sigima.proc.base.NormalizeParam",
        "values": {"method": "MAXIMUM"},
    }
    observed = 0
    for activity in activities:
        assert activity["outputs"] == []
        state_id = activity["legacy"].get("observed_state_id")
        if state_id is not None:
            observed += 1
            state = bs._PROVENANCE.ledger.states[state_id]
            assert state["produced_by"] is None
            obj = bs._find_object_by_uuid(state["object_uuid"])
            assert bs._PROVENANCE.observe(obj) == state_id
    assert observed == 4


def _observed_fingerprint(bs, operation: str) -> str:
    activity = next(
        a
        for a in bs._PROVENANCE.ledger.activities
        if a["legacy"]["record"]["func_name"] == operation
    )
    assert activity["outputs"] == []
    state = bs._PROVENANCE.ledger.states[activity["legacy"]["observed_state_id"]]
    assert state["produced_by"] is None
    return state["fingerprint"]["value"]


def test_modified_old_result_is_not_attested():
    """Data changed after the processing, record unchanged: nothing is attested."""
    buffer = io.BytesIO(LEGACY.read_bytes())
    with h5py.File(buffer, "r+") as h5file:
        for group in h5file["DataLab_Sig"].values():
            for name, node in group.items():
                if name.startswith("s002"):
                    node["xydata"][1, 0] += 1.0
    original = fresh_runtime()
    _open(original, LEGACY.read_bytes())
    modified = fresh_runtime()
    _open(modified, buffer.getvalue())
    assert _observed_fingerprint(modified, "normalize") != _observed_fingerprint(
        original, "normalize"
    )
    assert modified.get_provenance_ledger()["legacy"]["items"][0]["issues"] == []


def _open(bs, data: bytes, replace: bool = True) -> None:
    bs.open_workspace_from_bytes("legacy.h5", data, replace=replace)


def test_legacy_workspace_is_imported():
    """Records become legacy activities with explicit unknowns and issues."""
    bs = fresh_runtime()
    _open(bs, LEGACY.read_bytes())
    assert bs.get_provenance_ledger()["file_status"] == "absent"
    check_legacy(bs)
    assert any("legacy" in notice for notice in bs.get_provenance_ledger()["notices"])


def test_legacy_activities_are_never_replayed(fresh_bootstrap, counted_apply):
    """Verification refuses a legacy activity before any computation."""
    bs = fresh_bootstrap
    _open(bs, LEGACY.read_bytes())
    for activity in bs._PROVENANCE.ledger.activities:
        report = bs.replay_activity(activity["activity_id"])
        assert report["restoration"] == "opaque"
        assert report["eligibility"] == "unsupported_operation"
        assert report["environment"]["match"] == "unknown"
    assert counted_apply["count"] == 0


def test_new_processing_continues_the_legacy_chain(fresh_bootstrap):
    """A new activity's input is the legacy output state of its source."""
    bs = fresh_bootstrap
    _open(bs, LEGACY.read_bytes())
    oid, s2 = next(
        (oid, obj)
        for oid, obj in bs._MODEL.iter_all("signal")
        if obj.title.startswith("moving")
    )
    ledger = bs._PROVENANCE.ledger
    legacy_state = ledger.latest_state(bs._object_uuid(s2))["state_id"]
    bs.apply_feature("normalize", [oid], params={"method": "maximum"})
    activity = ledger.activities[-1]
    assert activity["origin"] == "ordinary"
    assert activity["call"]["inputs"][0]["binding"]["state_id"] == legacy_state
    ledger.validate()


def test_round_trip_keeps_legacy_activities():
    """Saved with its ledger, the workspace reopens without a second import."""
    writer = fresh_runtime()
    _open(writer, LEGACY.read_bytes())
    data = writer.save_workspace_to_bytes()
    saved = writer._PROVENANCE.ledger.to_dict()
    reader = fresh_runtime()
    _open(reader, data)
    assert reader.get_provenance_ledger()["file_status"] == "loaded"
    assert reader._PROVENANCE.ledger.to_dict() == saved
    assert reader._PROVENANCE.state_status == {}
    check_legacy(reader)


def test_appending_a_legacy_workspace_imports_nothing():
    """Appending never merges provenance, legacy records included."""
    bs = fresh_runtime()
    _open(bs, LEGACY.read_bytes(), replace=False)
    assert bs._PROVENANCE.ledger.activities == ()
    assert bs.get_provenance_ledger()["legacy"]["activities"] == 0
