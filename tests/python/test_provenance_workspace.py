# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Workspace provenance saved in HDF5 files, reopened in a fresh runtime and replayed.

The chain workspace (S0 -> S1 opaque -> S2 -> S3, S0 -> S4) is checked for files
written by this runtime and for the reference files written by DataLab-Web in
Pyodide and by DataLab Desktop.
"""

from __future__ import annotations

import importlib
import io
import sys
from pathlib import Path

import h5py
import numpy as np
import pytest

pytest.importorskip("datalab_capsule")

FIXTURES = Path(__file__).parents[1] / "fixtures" / "provenance"
X = np.array([0.0, 0.25, 0.5, 0.75])
Y = np.array([-2.0, 0.0, 1.0, 4.0])
# Exact analytical oracles (literals, never derived from Sigima)
S1_Y = np.array([-1.0, 1.0, 2.0, 5.0])
S2_Y = np.array([-1 / 5, 1 / 5, 2 / 5, 1.0])
S4_Y = np.array([0.0, 1 / 3, 0.5, 1.0])
NORMALIZE = {"id": "sigima.signal.normalize", "contract_version": 1}


def fresh_runtime():
    """Return a new bootstrap module, as a freshly booted runtime would be."""
    cached = sys.modules.pop("bootstrap", None)
    bs = importlib.import_module("bootstrap")
    if cached is not None:
        bs._CATALOG = cached._CATALOG
    return bs


def build_chain(bs) -> dict[str, str]:
    """Run the chain scenario and return its object ids."""
    s0 = bs.add_signal_from_arrays("S0", X, Y, xunit="s")
    (s1,) = bs.apply_feature("addition_constant", [s0], params={"value": 1.0})
    (s2,) = bs.apply_feature("normalize", [s1], params={"method": "maximum"})
    (s3,) = bs.apply_feature("normalize", [s2], params={"method": "amplitude"})
    (s4,) = bs.apply_feature("normalize", [s0], params={"method": "amplitude"})
    return {"S0": s0, "S1": s1, "S2": s2, "S3": s3, "S4": s4}


def output_object(bs, activity):
    """Return the live object holding an activity's result."""
    state = bs._PROVENANCE.ledger.states[activity["outputs"][0]["state_id"]]
    return bs._find_object_by_uuid(state["object_uuid"])


def check_chain(bs, edition: str) -> None:
    """Check a reopened chain workspace: facts, data and real replays."""
    ledger = bs._PROVENANCE.ledger
    ledger.validate()
    a1, a2, a3, a4 = ledger.activities
    assert {a["edition"] for a in ledger.activities} == {edition}
    assert a1["call"]["operation"] is None
    assert a1["call"]["parameters"] == {"value": 1.0}
    assert [a["call"]["operation"] for a in (a2, a3, a4)] == [NORMALIZE] * 3
    assert [a["call"]["parameters"]["method"] for a in (a2, a3, a4)] == [
        "maximum",
        "amplitude",
        "amplitude",
    ]
    s0_state = a1["call"]["inputs"][0]["binding"]["state_id"]
    assert a4["call"]["inputs"][0]["binding"]["state_id"] == s0_state
    for prev, nxt in ((a1, a2), (a2, a3)):
        assert (
            nxt["call"]["inputs"][0]["binding"]["state_id"]
            == prev["outputs"][0]["state_id"]
        )
    assert bs._PROVENANCE.state_status == {}
    assert bs._PROVENANCE.file_status == "loaded"
    for activity, expected in ((a1, S1_Y), (a2, S2_Y), (a4, S4_Y)):
        obj = output_object(bs, activity)
        assert obj.y.dtype == np.float64 and np.array_equal(obj.y, expected)
        assert np.array_equal(obj.x, X)
    references = {a["activity_id"]: output_object(bs, a).y.copy() for a in (a2, a4)}
    tree = bs.get_panel_tree("signal")
    opaque = bs.replay_activity(a1["activity_id"])
    assert (opaque["restoration"], opaque["eligibility"]) == (
        "opaque",
        "unsupported_operation",
    )
    for activity in (a4, a2):
        report = bs.replay_activity(activity["activity_id"])
        assert report["verdict"] == "exact"
        assert report["restoration"] == "replayable"
        assert report["environment"]["match"] == "different" or edition == "web"
        assert np.array_equal(
            output_object(bs, activity).y, references[activity["activity_id"]]
        )
    assert bs.get_panel_tree("signal") == tree
    assert len(ledger.activities) == 4


def test_round_trip_in_a_fresh_runtime():
    """Save, reopen in a fresh runtime, check facts and replay."""
    writer = fresh_runtime()
    build_chain(writer)
    saved = writer._PROVENANCE.ledger.to_dict()
    data = writer.save_workspace_to_bytes()
    reader = fresh_runtime()
    reader.open_workspace_from_bytes("chain.h5", data, replace=True)
    assert reader._PROVENANCE.ledger.to_dict() == saved
    check_chain(reader, "web")


def test_capsule_export_and_open():
    """An exported capsule validates on its own and reopens like a workspace."""
    from datalab_capsule.archive import read_capsule
    from datalab_capsule.manifest import inspect_manifest

    writer = fresh_runtime()
    build_chain(writer)
    data = writer.export_workspace_capsule(name="chain")
    summary = inspect_manifest(read_capsule(data).manifest)
    assert summary["name"] == "chain"
    assert [a["replayable"] for a in summary["activities"]] == [
        False,
        True,
        True,
        True,
    ]
    reader = fresh_runtime()
    reader.open_workspace_capsule("chain.dlcapsule", data, replace=True)
    check_chain(reader, "web")
    with pytest.raises(ValueError):
        reader.open_workspace_capsule("bad.dlcapsule", b"not a zip", replace=True)
    check_chain(reader, "web")


def test_processing_tab_records_are_rebuilt():
    """Replayable results get their Processing-tab record back after reopening."""
    writer = fresh_runtime()
    ids = build_chain(writer)
    data = writer.save_workspace_to_bytes()
    reader = fresh_runtime()
    reader.open_workspace_from_bytes("chain.h5", data, replace=True)
    oid_of = {
        reader._object_uuid(e.obj): oid for oid, e in reader._MODEL._objects.items()
    }
    s0, s2, s4 = (
        oid_of[writer._object_uuid(writer._MODEL.get(ids[name]))]
        for name in ("S0", "S2", "S4")
    )
    record = reader.get_last_processing(s4)
    assert record["feature_id"] == "normalize"
    assert record["source_ids"] == [s0]
    for name, oid in (("S4", s4), ("S2", s2)):
        expected = writer.get_last_processing(ids[name])["values"]
        assert reader.get_last_processing(oid)["values"] == expected
    assert reader.get_last_processing(s0) is None
    s1 = oid_of[writer._object_uuid(writer._MODEL.get(ids["S1"]))]
    assert reader.get_last_processing(s1) is None  # opaque step


@pytest.mark.parametrize(
    "name, edition", [("web_chain.h5", "web"), ("desktop_chain.h5", "desktop")]
)
def test_reference_files(name: str, edition: str):
    """Reference files of both editions reopen and replay here."""
    bs = fresh_runtime()
    bs.open_workspace_from_bytes(name, (FIXTURES / name).read_bytes(), replace=True)
    check_chain(bs, edition)


def _edit(data: bytes, edit) -> bytes:
    buffer = io.BytesIO(data)
    with h5py.File(buffer, "r+") as h5file:
        edit(h5file)
    return buffer.getvalue()


def test_invalid_block_leaves_the_workspace_unchanged():
    """An invalid block raises before the current workspace is replaced."""
    writer = fresh_runtime()
    build_chain(writer)

    def corrupt(h5file):
        del h5file["DataLab_Provenance/ledger_json"]
        h5file["DataLab_Provenance/ledger_json"] = "{not json"

    data = _edit(writer.save_workspace_to_bytes(), corrupt)
    bs = fresh_runtime()
    current = bs.add_signal_from_arrays("current", X, Y)
    tree = bs.get_panel_tree("signal")
    with pytest.raises(ValueError):
        bs.open_workspace_from_bytes("chain.h5", data, replace=True)
    assert bs.get_panel_tree("signal") == tree
    assert bs._MODEL.has(current)


def test_altered_and_missing_objects():
    """Altered data and a deleted source are refused before any computation."""
    writer = fresh_runtime()
    ids = build_chain(writer)
    s0_uuid = writer._object_uuid(writer._MODEL.get(ids["S0"]))
    writer.delete_object(ids["S1"])
    data = writer.save_workspace_to_bytes()

    bs = fresh_runtime()
    bs.open_workspace_from_bytes("chain.h5", data, replace=True)
    a1, a2, _a3, a4 = bs._PROVENANCE.ledger.activities
    assert bs._PROVENANCE.state_status == {a1["outputs"][0]["state_id"]: "unavailable"}
    assert bs.replay_activity(a2["activity_id"])["eligibility"] == "missing_input"
    assert bs.replay_activity(a4["activity_id"])["verdict"] == "exact"

    def alter(h5file):
        for group in h5file["DataLab_Sig"].values():
            for obj in group.values():
                if "metadata" in obj and obj["metadata"].attrs["__uuid"] == s0_uuid:
                    obj["xydata"][1, 0] = -3.0

    bs = fresh_runtime()
    bs.open_workspace_from_bytes("chain.h5", _edit(data, alter), replace=True)
    a4 = bs._PROVENANCE.ledger.activities[3]
    s0_state = a4["call"]["inputs"][0]["binding"]["state_id"]
    assert bs._PROVENANCE.state_status[s0_state] == "altered"
    assert bs.replay_activity(a4["activity_id"])["eligibility"] == "input_changed"


def test_file_without_block_and_append():
    """An old file reports provenance as absent; appending never merges ledgers."""
    writer = fresh_runtime()
    writer.add_signal_from_arrays("S", X, Y)
    old = _edit(
        writer.save_workspace_to_bytes(), lambda f: f.__delitem__("DataLab_Provenance")
    )
    bs = fresh_runtime()
    bs.open_workspace_from_bytes("old.h5", old, replace=True)
    assert bs._PROVENANCE.file_status == "absent"
    assert bs._PROVENANCE.ledger.activities == ()
    build_chain(bs)
    activities = bs._PROVENANCE.ledger.activities
    bs.open_workspace_from_bytes(
        "chain.h5", (FIXTURES / "web_chain.h5").read_bytes(), replace=False
    )
    assert bs._PROVENANCE.ledger.activities == activities
    assert bs._PROVENANCE.notices
