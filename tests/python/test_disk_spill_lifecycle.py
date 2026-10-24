# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the spill bookkeeping of the on-disk storage mode.

In on-disk storage mode, ``runtime.ts`` keeps each object's heavy array in the
browser's OPFS and pages it in only for the call that needs it. These tests
check the Python side of that contract: what ``bootstrap.py`` reports to the
disk guard, so that an on-disk copy is never stale (data changed by a call or
replaced by a macro) nor orphaned (object deleted with its group or by a
reset).
"""

from __future__ import annotations

import base64
import io
import pickle
from pathlib import Path

import numpy as np


def _add_signal(bs, title: str = "sig", group_id: str | None = None) -> str:
    x = np.linspace(0.0, 1.0, 200)
    return bs.add_signal_from_arrays(title, x, np.sin(x), group_id=group_id)


def _spill(bs, oid: str) -> bytes:
    """Spill *oid* as the disk guard does and return its on-disk payload."""
    payload = bs.detach_object_array(oid)
    assert payload != b""
    return payload


def _decode(payload: bytes) -> np.ndarray:
    return np.load(io.BytesIO(payload), allow_pickle=False)


def test_settle_releases_data_left_unchanged(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = _add_signal(bs)
    payload = _spill(bs, oid)
    assert bs.attach_object_array(oid, payload)

    assert bs.settle_object_array(oid) == {"state": "released"}
    assert bs.is_object_spilled(oid)
    # The on-disk copy is still current: paging it in restores the data.
    assert bs.attach_object_array(oid, payload)
    assert bs._MODEL.get(oid).xydata.shape == (2, 200)


def test_unpersisted_payload_is_attached_back(fresh_bootstrap):
    """A payload that could not be persisted is attached back as the only copy.

    The runtime attaches back the bytes of a failed OPFS write: the object must
    be resident with its data, not spilled, and never released afterwards
    without being serialized again (its on-disk copy is not current).
    """
    bs = fresh_bootstrap
    oid = _add_signal(bs)
    expected = bs._MODEL.get(oid).xydata.copy()
    payload = _spill(bs, oid)
    assert bs.is_object_spilled(oid)

    assert bs.attach_object_array(oid, payload, on_disk=False)

    assert not bs.is_object_spilled(oid)
    np.testing.assert_array_equal(bs._MODEL.get(oid).xydata, expected)
    settled = bs.settle_object_array(oid)
    assert settled["state"] == "rewritten"
    np.testing.assert_array_equal(_decode(settled["payload"]), expected)


def test_settle_rewrites_data_changed_by_the_call(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = _add_signal(bs)
    assert bs.attach_object_array(oid, _spill(bs, oid))
    new_y = np.full(200, 3.0)
    bs.set_signal_xydata(oid, np.linspace(0.0, 1.0, 200).tolist(), new_y.tolist())

    settled = bs.settle_object_array(oid)

    assert settled["state"] == "rewritten"
    assert bs.is_object_spilled(oid)
    np.testing.assert_array_equal(_decode(settled["payload"])[1], new_y)


def test_settle_rewrites_arrays_replaced_through_the_properties(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_image_from_array("img", np.zeros((16, 8)))
    assert bs.attach_object_array(oid, _spill(bs, oid))
    bs.set_object_property_values(oid, {"data": np.ones((16, 8))})

    settled = bs.settle_object_array(oid)

    assert settled["state"] == "rewritten"
    np.testing.assert_array_equal(_decode(settled["payload"]), np.ones((16, 8)))


def test_settle_reports_an_object_deleted_by_the_call(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = _add_signal(bs)
    assert bs.attach_object_array(oid, _spill(bs, oid))
    bs.delete_object(oid)

    assert bs.settle_object_array(oid) == {"state": "gone"}


def test_delete_group_forgets_its_spilled_objects(fresh_bootstrap):
    bs = fresh_bootstrap
    kept = _add_signal(bs, "kept")
    gid = bs.create_group("signal", "group")
    deleted = _add_signal(bs, "deleted", group_id=gid)
    _spill(bs, kept)
    _spill(bs, deleted)

    bs.delete_group(gid, "signal")

    assert not bs.is_object_spilled(deleted)
    assert bs.disk_sweep_state() == {"spilled": [kept], "resident": []}


def test_reset_all_forgets_every_spilled_object(fresh_bootstrap):
    bs = fresh_bootstrap
    _spill(bs, _add_signal(bs))
    _spill(bs, bs.add_image_from_array("img", np.zeros((8, 8))))

    bs.reset_all()

    assert bs.spilled_object_ids() == []


def test_sweep_state_forgets_objects_that_left_the_model(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = _add_signal(bs)
    _spill(bs, oid)
    # Deleted without the bootstrap helpers (e.g. by plugin code).
    bs._MODEL.delete_object(oid)

    assert bs.disk_sweep_state() == {"spilled": [], "resident": []}
    assert not bs.is_object_spilled(oid)


def test_sweep_state_reports_resident_objects(fresh_bootstrap):
    bs = fresh_bootstrap
    spilled = _add_signal(bs, "spilled")
    resident = bs.add_image_from_array("img", np.zeros((32, 32)))
    _spill(bs, spilled)

    assert bs.disk_sweep_state() == {"spilled": [spilled], "resident": [resident]}


def test_object_replaced_by_a_macro_is_not_reverted(fresh_bootstrap):
    """A macro's ``set_object`` replaces the data of an object on disk.

    The stale on-disk copy must never be paged in again: the replaced object
    is reported as resident so that the disk guard spills its new data.
    """
    bs = fresh_bootstrap
    oid = _add_signal(bs)
    payload = _spill(bs, oid)
    # The macro reads the object (paged in), changes it, and sends it back.
    assert bs.attach_object_array(oid, payload)
    edited = pickle.loads(pickle.dumps(bs._MODEL.get(oid)))
    bs.settle_object_array(oid)
    edited.y = np.full(200, 5.0)

    bs.set_object_pickled(base64.b64encode(pickle.dumps(edited)).decode("ascii"))

    assert not bs.is_object_spilled(oid)
    assert bs.disk_sweep_state() == {"spilled": [], "resident": [oid]}
    assert not bs.attach_object_array(oid, payload)
    np.testing.assert_array_equal(bs._MODEL.get(oid).y, np.full(200, 5.0))


def test_last_processing_input_ids_names_the_source(fresh_bootstrap):
    bs = fresh_bootstrap
    source = _add_signal(bs)
    (result,) = bs.apply_feature("moving_average", [source], params={"n": 5})

    assert bs.last_processing_input_ids(result) == [source]
    assert bs.last_processing_input_ids(source) == []


def test_last_processing_input_ids_without_parameters_or_source(fresh_bootstrap):
    bs = fresh_bootstrap
    source = _add_signal(bs)
    (parameterless,) = bs.apply_feature("absolute", [source])
    (filtered,) = bs.apply_feature("moving_average", [source], params={"n": 5})
    bs.delete_object(source)

    assert bs.last_processing_input_ids(parameterless) == []
    assert bs.last_processing_input_ids(filtered) == []


def test_spill_bookkeeping_survives_a_hot_reload(fresh_bootstrap):
    """Re-executing ``bootstrap.py`` (Vite HMR) keeps the model and its spills."""
    bs = fresh_bootstrap
    spilled = _add_signal(bs, "spilled")
    paged_in = _add_signal(bs, "paged in")
    _spill(bs, spilled)
    assert bs.attach_object_array(paged_in, _spill(bs, paged_in))

    path = Path(bs.__file__)
    exec(compile(path.read_text(encoding="utf-8"), str(path), "exec"), vars(bs))  # noqa: S102

    assert bs.is_object_spilled(spilled)
    assert bs.settle_object_array(paged_in) == {"state": "released"}
