# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Consultation of the provenance of a result (DataLab-Web).

The Provenance tab shows the recorded production of the selected object, its
inputs (with their current id and title) and their ancestors, the analyses
recorded on it, and lets the user check the data and verify the computation.
Consulting never reads arrays; checking the data reports arrays that are not
resident as unavailable; nothing changes the workspace or the ledger. The
scenario of reference: S0 -> Gaussian filter (sigma = 2) -> S1 -> normalization
-> S2, then S1 recomputed with sigma = 5.
"""

from __future__ import annotations

import asyncio
import os

import numpy as np
import pytest

if os.environ.get("DLW_REQUIRE_PROVENANCE") == "1":
    import datalab_capsule  # noqa: F401  # CI must not skip these tests
else:
    pytest.importorskip("datalab_capsule")

from test_provenance_processing import reopen  # noqa: E402
from test_provenance_workspace import X, Y, fresh_runtime  # noqa: E402


def build_chain(bs) -> dict[str, str]:
    """Build the sigma scenario and return its object ids."""
    s0 = bs.add_signal_from_arrays("S0", X, Y, xunit="s")
    (s1,) = bs.apply_feature("gaussian_filter", [s0], params={"sigma": 2.0})
    (s2,) = bs.apply_feature("normalize", [s1], params={"method": "maximum"})
    bs.reapply_last_processing(s1, {"sigma": 5.0})
    return {"S0": s0, "S1": s1, "S2": s2}


def snapshot(bs) -> tuple:
    """Return what consultation, check and verification must never change."""
    objects = sorted(
        (oid, entry.obj.title, entry.obj.xydata.tobytes())
        for oid, entry in bs._MODEL._objects.items()
    )
    return bs._PROVENANCE.ledger.to_json(), objects


def check_sigma_scenario(bs, ids: dict[str, str]) -> None:
    """S2 describes the sigma = 2 state actually used, whatever S1 became."""
    before = snapshot(bs)
    view = bs.describe_object_provenance(ids["S2"])
    assert view["available"] is True
    assert view["object"]["id"] == ids["S2"]
    assert view["anchor"]["content"] == "unchecked"
    production = view["production"]
    assert production["operation"]["id"] == "sigima.signal.normalize"
    (source,) = production["inputs"]
    assert source["id"] == ids["S1"]
    assert source["title"] == bs._MODEL.get(ids["S1"]).title
    assert source["object_kind"] == "signal"
    assert source["has_ancestors"] and source["data"] == "unchecked"
    ancestor = bs.describe_object_provenance(
        ids["S2"], state_id=source["state_id"], trail=[view["state"]["state_id"]]
    )
    assert ancestor["production"]["parameters"]["sigma"] == 2.0
    assert ancestor["anchor"]["latest"] is False
    current = bs.describe_object_provenance(ids["S1"])
    assert current["production"]["parameters"]["sigma"] == 5.0
    checked = bs.describe_object_provenance(ids["S2"], check_data=True)
    assert checked["anchor"]["content"] == "matches"
    assert checked["production"]["inputs"][0]["data"] == "changed"
    report = bs.replay_activity(production["activity_id"])
    assert report["eligibility"] == "input_changed"
    assert snapshot(bs) == before


def test_sigma_scenario_is_readable():
    """Consultation, check and verification describe sigma = 2, change nothing."""
    bs = fresh_runtime()
    check_sigma_scenario(bs, build_chain(bs))


def test_sigma_scenario_after_reopening_and_deletion():
    """The same explanation after reopening; a deleted input is never replaced."""
    writer = fresh_runtime()
    ids = build_chain(writer)
    reader, oid_of = reopen(writer)
    ids = {name: oid_of(oid) for name, oid in ids.items()}
    check_sigma_scenario(reader, ids)
    reader.delete_object(ids["S1"])
    view = reader.describe_object_provenance(ids["S2"], check_data=True)
    (source,) = view["production"]["inputs"]
    assert source["object_present"] is False
    assert (source["id"], source["title"]) == (None, None)
    assert source["data"] == "missing"
    ancestor = reader.describe_object_provenance(ids["S2"], state_id=source["state_id"])
    assert ancestor["production"]["parameters"]["sigma"] == 2.0


def test_modified_output_is_not_attributed():
    """A changed result is not attributed; a new title is not a change."""
    bs = fresh_runtime()
    ids = build_chain(bs)
    obj = bs._MODEL.get(ids["S2"])
    obj.title = "Renamed"
    view = bs.describe_object_provenance(ids["S2"], check_data=True)
    assert view["anchor"]["content"] == "matches"
    obj.y = obj.y + 1.0
    view = bs.describe_object_provenance(ids["S2"], check_data=True)
    assert view["anchor"]["content"] == "differs"
    assert view["production"]["outputs"][0]["status"] == "altered"


def test_data_on_disk_are_not_read(monkeypatch):
    """Arrays that are not resident are reported, never read."""
    bs = fresh_runtime()
    ids = build_chain(bs)
    for name in ("S1", "S2"):
        monkeypatch.setitem(bs._SPILLED, ids[name], {})
    view = bs.describe_object_provenance(ids["S2"])
    assert view["anchor"]["content"] == "unchecked"
    view = bs.describe_object_provenance(ids["S2"], check_data=True)
    assert view["anchor"]["content"] == "unavailable"
    assert view["production"]["inputs"][0]["data"] == "unavailable"
    assert bs._PROVENANCE.capture_failures == 0


def test_analyses_are_listed_apart():
    """Analyses are not producers; an absence of result is not an error."""
    bs = fresh_runtime()
    signal = bs.add_signal_from_arrays("S", X, Y, xunit="s")
    asyncio.run(bs.run_signal_analysis(signal, "stats"))
    ramp = np.add.outer(np.arange(16.0), np.arange(16.0))
    image = bs.add_image_from_array("ramp", ramp, "", "", "")
    assert asyncio.run(bs.run_image_analysis(image, "peak_detection")) is None
    view = bs.describe_object_provenance(signal, check_data=True)
    assert view["production"] is None
    (stats,) = view["analyses"]
    (output,) = stats["outputs"]
    assert output["recorded"] == "artifact" and output["kind"] == "table"
    assert output["status"] == "available"
    view = bs.describe_object_provenance(image)
    (detection,) = view["analyses"]
    assert detection["no_result"] is True and detection["outputs"] == []
    activity = bs.describe_provenance_activity(detection["activity_id"])
    assert activity["activity"]["no_result"] is True


def test_without_the_library(monkeypatch):
    """Without DataLab-Capsule, the panel says so; processing is unchanged."""
    bs = fresh_runtime()
    s0 = bs.add_signal_from_arrays("S0", X, Y, xunit="s")
    monkeypatch.setattr(bs._PROVENANCE, "ledger", None)
    view = bs.describe_object_provenance(s0)
    assert view["available"] is False
    assert bs.describe_provenance_activity("x")["available"] is False
    (result,) = bs.apply_feature("normalize", [s0], params={"method": "maximum"})
    assert bs._MODEL.has(result)
