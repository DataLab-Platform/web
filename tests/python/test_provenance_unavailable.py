# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Provenance without DataLab-Capsule: processing works, nothing is recorded."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

MODULE_PATH = (
    Path(__file__).resolve().parents[2] / "src" / "runtime" / "dlw_provenance.py"
)


@pytest.fixture
def provenance_without_capsule(monkeypatch):
    """Load a fresh ``dlw_provenance`` while DataLab-Capsule cannot be imported."""
    for name in list(sys.modules):
        if name == "datalab_capsule" or name.startswith("datalab_capsule."):
            monkeypatch.delitem(sys.modules, name)
    monkeypatch.setitem(sys.modules, "datalab_capsule", None)
    spec = importlib.util.spec_from_file_location(
        "dlw_provenance_without_capsule", MODULE_PATH
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _recorder(module):
    return module.WebProvenance(
        find_by_uuid=lambda _uuid: None,
        uuid_of=lambda _obj: None,
        is_spilled=lambda _obj: False,
        iter_objects=lambda: [],
        is_known_operation=lambda _kind, _name, _origin: False,
    )


def test_reports_provenance_as_unavailable(provenance_without_capsule):
    module = provenance_without_capsule
    recorder = _recorder(module)

    assert module.UNAVAILABLE_REASON.startswith("DataLab-Capsule is not installed")
    assert not recorder.available
    recorder.reset()
    recorder.save(None)
    assert recorder.read(None) is None
    recorder.load(None, replaced=True)
    assert recorder.begin(print, None, None) is None
    assert recorder.complete(None, None) is None
    assert recorder.producing_call("uuid") is None


def test_refuses_recorder_operations(provenance_without_capsule):
    module = provenance_without_capsule
    recorder = _recorder(module)

    with pytest.raises(RuntimeError, match="DataLab-Capsule is not installed"):
        recorder.verify("activity", lambda _prepared: None)
    # The stand-in base refuses any operation reached despite ``available``.
    with pytest.raises(RuntimeError, match="DataLab-Capsule is not installed"):
        module.Recorder.reset(recorder)
