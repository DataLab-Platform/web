# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Capsule exchange between two runtimes: inspect, open, replay, revise, review.

Three results are kept apart: the integrity of the capsule (no computation),
the checks of the reports and reviews supplied with it (what their authors
claim, not recomputed), and the local replay of an activity.
"""

from __future__ import annotations

import json
import os

import pytest

if os.environ.get("DLW_REQUIRE_PROVENANCE") == "1":
    import datalab_capsule  # noqa: F401  # CI must not skip these tests
else:
    pytest.importorskip("datalab_capsule")

from test_provenance_workspace import build_chain, check_chain, fresh_runtime  # noqa: E402

REF = "https://data.example.org/chain.h5"


def _objects(bs) -> list[str]:
    """Object ids of the signal panel, in tree order."""
    tree = bs.get_panel_tree("signal")
    return [obj["id"] for group in tree["groups"] for obj in group["objects"]]


def _exported(name: str = "chain") -> tuple[object, bytes]:
    writer = fresh_runtime()
    build_chain(writer)
    return writer, writer.export_workspace_capsule(name=name)


def test_inspection_separates_integrity_from_documents(counted_apply):
    """Inspecting computes nothing and keeps integrity and documents apart."""
    writer, data = _exported()
    activity = writer._PROVENANCE.ledger.activities[3]
    report = writer.replay_activity(activity["activity_id"])
    reader = fresh_runtime()
    before = counted_apply["count"]
    result = reader.inspect_workspace_capsule(
        data, reports=[json.dumps(report), "{not json"]
    )
    assert counted_apply["count"] == before
    assert result["summary"]["name"] == "chain"
    assert len(result["summary"]["activities"]) == 4
    integrity = result["integrity"]
    assert integrity["valid"] and integrity["workspace"] == "verified"
    assert integrity["states_located"] == 5 and integrity["problems"] == []
    documents = result["documents"]
    assert [r["verdict"] for r in documents["reports"]] == ["exact"]
    assert documents["reports"][0]["status"] == "valid"
    assert documents["unreadable"][0]["kind"] == "report"
    # Nothing was opened.
    assert _objects(reader) == []


def test_invalid_document_does_not_affect_integrity():
    """A report on an unknown activity is a document problem, not an integrity one."""
    writer, data = _exported()
    report = writer.replay_activity(
        writer._PROVENANCE.ledger.activities[3]["activity_id"]
    )
    report["activity_id"] = "00000000-0000-4000-8000-0000000000ff"
    result = fresh_runtime().inspect_workspace_capsule(
        data, reports=[json.dumps(report)]
    )
    assert result["integrity"]["valid"] and result["integrity"]["problems"] == []
    assert result["documents"]["reports"][0]["status"] == (
        "The report names an activity absent from the capsule"
    )


def test_tampered_capsule_is_reported_not_raised():
    """An invalid capsule gives an integrity result without summary."""
    _writer, data = _exported()
    tampered = bytearray(data)
    tampered[-30] ^= 0xFF
    result = fresh_runtime().inspect_workspace_capsule(bytes(tampered))
    assert result["summary"] is None and result["documents"] is None
    assert not result["integrity"]["valid"]
    assert result["integrity"]["problems"][0].startswith("Invalid capsule")


def test_revision_review_and_comparison_across_runtimes():
    """Open, replay locally, export a child revision, review it, compare both."""
    _writer, parent = _exported("chain")
    reader = fresh_runtime()
    parent_info = reader.inspect_workspace_capsule(parent)
    reader.open_workspace_capsule("chain.dlcapsule", parent, replace=True)
    check_chain(reader, "web")
    origin = reader.get_provenance_ledger()["capsule_origin"]
    assert origin == {
        "fingerprint": parent_info["integrity"]["fingerprint"],
        "name": "chain",
    }
    # A new processing, then a child revision naming its parent.
    oid = _objects(reader)[0]
    reader.apply_feature("normalize", [oid], params={"method": "maximum"})
    child = reader.export_workspace_capsule(
        name="chain, continued", revision_of=origin["fingerprint"]
    )
    child_info = reader.inspect_workspace_capsule(child)
    assert child_info["summary"]["revision_of"] == origin["fingerprint"]
    diff = reader.diff_capsule_manifests(
        parent_info["manifest"], child_info["manifest"]
    )
    assert diff["revision_of_old"] and not diff["identical"]
    assert {(c["change"], c["item"]) for c in diff["scientific"]} >= {
        ("added", "activity"),
        ("added", "state"),
    }
    # A review is a separate document; the capsule is unchanged.
    activity = child_info["summary"]["activities"][-1]["id"].split("#activity-")[1]
    report = reader.replay_activity(activity)
    assert report["verdict"] == "exact"
    review = reader.create_capsule_review(
        child_info["manifest"],
        "Reviewer",
        "The new normalisation replays exactly.",
        "endorsed",
        [report],
    )
    checked = fresh_runtime().inspect_workspace_capsule(
        child, reviews=[json.dumps(review)], reports=[json.dumps(report)]
    )
    assert checked["documents"]["reviews"][0]["status"] == "valid"
    assert checked["documents"]["reports"][0]["status"] == "valid"
    other = fresh_runtime().inspect_workspace_capsule(
        parent, reviews=[json.dumps(review)]
    )
    assert other["documents"]["reviews"][0]["status"] == (
        "The review targets another capsule revision"
    )
    assert other["integrity"]["valid"]


def test_referenced_workspace_variant():
    """A referenced workspace is checked and opened only when the user supplies it."""
    writer = fresh_runtime()
    build_chain(writer)
    exported = writer.export_referenced_capsule(REF, name="chain")
    capsule, workspace = exported["capsule"], exported["workspace"]
    reader = fresh_runtime()
    info = reader.inspect_workspace_capsule(capsule)
    assert info["summary"]["workspace"] == {
        "id": REF,
        "referenced": True,
        "sha256": info["summary"]["workspace"]["sha256"],
        "size": str(len(workspace)),
    }
    assert info["integrity"]["workspace"] == "not_available"
    with pytest.raises(ValueError, match="select the workspace file"):
        reader.open_workspace_capsule("chain.dlcapsule", capsule, replace=True)
    other = writer.save_workspace_to_bytes() + b"\0"
    with pytest.raises(ValueError, match="does not match"):
        reader.open_workspace_capsule(
            "chain.dlcapsule", capsule, replace=True, workspace=other
        )
    supplied = reader.inspect_workspace_capsule(capsule, workspace=workspace)
    assert supplied["integrity"]["workspace"] == "verified"
    reader.open_workspace_capsule(
        "chain.dlcapsule", capsule, replace=True, workspace=workspace
    )
    check_chain(reader, "web")


def test_attachments_are_declared_listed_and_returned_as_data(counted_apply):
    """Light attachments travel with the capsule; nothing is computed or opened."""
    writer = fresh_runtime()
    build_chain(writer)
    note = b"Acquired on bench 2.\n"
    data = writer.export_workspace_capsule(
        name="chain",
        attachments=[
            {
                "name": "protocol.txt",
                "data": note,
                "media_type": "text/plain",
                "description": "Protocol",
            }
        ],
    )
    reader = fresh_runtime()
    before = counted_apply["count"]
    result = reader.inspect_workspace_capsule(data)
    assert counted_apply["count"] == before
    assert result["integrity"]["valid"]
    [listed] = result["summary"]["attachments"]
    assert listed["name"] == "protocol.txt" and listed["size"] == str(len(note))
    assert listed["description"] == "Protocol"
    assert reader.get_capsule_attachment(data, "protocol.txt") == note
    with pytest.raises(Exception, match="No such attachment"):
        reader.get_capsule_attachment(data, "other.txt")
    # Attachments do not change how the workspace opens and replays.
    reader.open_workspace_capsule("chain.dlcapsule", data)
    check_chain(reader, "web")


def test_registry_revision_is_checked_not_trusted():
    """A manifest and reviews from a registry are checked like files."""
    writer, data = _exported()
    info = writer.inspect_workspace_capsule(data)
    manifest = json.dumps(info["manifest"])
    fingerprint = info["summary"]["fingerprint"]
    review = writer.create_capsule_review(
        info["manifest"], reviewer="B", statement="Replayed."
    )
    from datalab_capsule.review import create_review

    other = create_review("sha256:" + "0" * 64, reviewer="C", statement="Elsewhere.")
    reader = fresh_runtime()
    checked = reader.check_registry_revision(
        manifest, fingerprint, [json.dumps(review), json.dumps(other), "{bad"]
    )
    assert checked["summary"]["fingerprint"] == fingerprint
    statuses = [r["status"] for r in checked["reviews"]]
    assert statuses[0] == "valid"
    assert "another capsule revision" in statuses[1]
    assert checked["reviews"][2]["review"] is None
    with pytest.raises(Exception, match="another revision"):
        reader.check_registry_revision(manifest, "sha256:" + "1" * 64)
    tampered = json.loads(manifest)
    next(e for e in tampered["@graph"] if e["@id"] == "./")["name"] = "edited"
    with pytest.raises(Exception, match="fingerprint"):
        reader.check_registry_revision(json.dumps(tampered), fingerprint)
