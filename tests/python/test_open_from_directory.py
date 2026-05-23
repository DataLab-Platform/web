# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the per-folder bulk-open helper ``open_from_directory_chunk``."""

from __future__ import annotations

CSV_A = b"x,y\n0,1\n1,2\n2,3\n"
CSV_B = b"x,y\n0,10\n1,20\n2,30\n"
GARBAGE = b"\x00\x01not-a-supported-format\x02\x03"


def test_open_from_directory_chunk_mixed(fresh_bootstrap):
    """Two readable CSVs + one bogus file → one group, 2 oids, 1 error."""
    bs = fresh_bootstrap
    files = [
        {"name": "a.csv", "data": CSV_A},
        {"name": "b.csv", "data": CSV_B},
        {"name": "junk.xyz", "data": GARBAGE},
    ]
    result = bs.open_from_directory_chunk("signal", "subfolder/A", files)
    assert result["gid"] is not None
    assert len(result["oids"]) == 2
    assert result["errors"] == 1
    tree = bs.get_panel_tree("signal")
    groups = {g["name"]: g for g in tree["groups"]}
    assert "subfolder/A" in groups
    assert len(groups["subfolder/A"]["objects"]) == 2


def test_open_from_directory_chunk_all_invalid_skips_group(fresh_bootstrap):
    """If nothing is readable, no group is created — parity with Qt."""
    bs = fresh_bootstrap
    before = len(bs.get_panel_tree("signal")["groups"])
    result = bs.open_from_directory_chunk(
        "signal", "junk-only", [{"name": "x.xyz", "data": GARBAGE}]
    )
    assert result["gid"] is None
    assert result["oids"] == []
    assert result["errors"] == 1
    after = len(bs.get_panel_tree("signal")["groups"])
    assert after == before


def test_open_from_directory_chunk_empty_input(fresh_bootstrap):
    """Empty file list → no-op (no group, no error)."""
    bs = fresh_bootstrap
    result = bs.open_from_directory_chunk("signal", "anything", [])
    assert result == {"gid": None, "oids": [], "errors": 0}
