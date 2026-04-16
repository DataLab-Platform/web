# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for project I/O (save_project / load_project) and CSV import/export."""

from __future__ import annotations

import json

import numpy as np
import pytest


def test_save_load_project_round_trip(fresh_bootstrap):
    bs = fresh_bootstrap
    x = np.linspace(0, 1, 50)
    bs.add_signal_from_arrays("A", x, np.sin(x), xunit="s", yunit="V")
    gid = bs.create_group("signal", "Group2")
    b = bs.add_signal_from_arrays("B", x, np.cos(x))
    bs.move_object(b, gid)

    blob = bs.save_project()
    payload = json.loads(blob)
    assert payload["format"] == "datalab-web"
    assert "signal" in payload["panels"]

    diag = bs.load_project(blob, replace=True)
    assert diag["signals"] == 2
    assert diag["groups"] == 2

    tree = bs.get_panel_tree("signal")
    titles = [o["title"] for g in tree["groups"] for o in g["objects"]]
    assert sorted(titles) == ["A", "B"]


def test_load_project_rejects_non_datalab_file(fresh_bootstrap):
    bs = fresh_bootstrap
    with pytest.raises(ValueError):
        bs.load_project(json.dumps({"format": "other", "version": 1}))


def test_load_project_rejects_future_version(fresh_bootstrap):
    bs = fresh_bootstrap
    blob = json.dumps({"format": "datalab-web", "version": 999, "panels": {}})
    with pytest.raises(ValueError):
        bs.load_project(blob)


def test_export_signal_csv_uses_header_with_units(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays(
        "S",
        [0.0, 1.0, 2.0],
        [10.0, 20.0, 30.0],
        xunit="s",
        yunit="V",
        xlabel="time",
        ylabel="voltage",
    )
    csv = bs.export_signal_csv(oid, separator=",")
    lines = csv.splitlines()
    assert lines[0] == "time (s),voltage (V)"
    assert len(lines) == 4  # header + 3 rows


def test_import_signal_csv_with_header(fresh_bootstrap):
    bs = fresh_bootstrap
    csv = "x,y\n0,10\n1,20\n2,30\n"
    oid = bs.import_signal_csv(csv)
    payload = bs.get_signal_xy(oid)
    np.testing.assert_array_equal(payload["x"], [0.0, 1.0, 2.0])
    np.testing.assert_array_equal(payload["y"], [10.0, 20.0, 30.0])
    assert payload["xlabel"] == "x"


def test_import_signal_csv_without_header(fresh_bootstrap):
    bs = fresh_bootstrap
    csv = "0,1\n2,3\n4,5\n"
    oid = bs.import_signal_csv(csv)
    payload = bs.get_signal_xy(oid)
    np.testing.assert_array_equal(payload["x"], [0.0, 2.0, 4.0])


def test_import_signal_csv_empty_raises(fresh_bootstrap):
    bs = fresh_bootstrap
    with pytest.raises(ValueError):
        bs.import_signal_csv("")
