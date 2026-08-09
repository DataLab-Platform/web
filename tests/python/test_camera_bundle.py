# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Contracts for the explicitly bundled Camera plugin wheel."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest
from datalab.recipes import RECIPE_RUN_RECORD_OPTION

REPO_ROOT = Path(__file__).resolve().parents[2]
CAMERA_WHEEL = (
    REPO_ROOT
    / "src"
    / "runtime"
    / "builtin_wheels"
    / "datalab_camera_characterization-0.1.0-py3-none-any.whl"
)


@pytest.fixture
def camera_bridge(monkeypatch):
    """Import the Web bridge with the bundled wheel on ``sys.path``."""
    assert CAMERA_WHEEL.is_file()
    monkeypatch.syspath_prepend(str(CAMERA_WHEEL))
    for name in tuple(sys.modules):
        if name == "dlw_camera" or name.startswith("datalab_camera_characterization"):
            sys.modules.pop(name, None)
    yield importlib.import_module("dlw_camera")
    for name in tuple(sys.modules):
        if name == "dlw_camera" or name.startswith("datalab_camera_characterization"):
            sys.modules.pop(name, None)


def test_bundled_camera_manifest_matches_runtime_matrix(camera_bridge) -> None:
    """The wheel exposes the exact unverified browser compatibility target."""
    assert camera_bridge.get_bundled_camera_manifest() == {
        "plugin_id": "org.datalab.camera-characterization",
        "plugin_version": "0.1.0",
        "web_status": "untested",
        "datalab_web_version": "0.8.0",
        "pyodide_version": "0.26.4",
        "recipe_id": (
            "org.datalab.camera-characterization:relative-dn-characterization"
        ),
        "recipe_version": "1.1.0",
        "quickstart_filename": "camera_quickstart.h5",
    }


def test_bundled_camera_quickstart_uses_workspace_byte_loader(camera_bridge) -> None:
    """Browser I/O reuses the existing byte-based HDF5 workspace loader."""
    calls: list[tuple[str, bytes, bool]] = []

    def load_workspace(filename: str, data: bytes, *, replace: bool = True):
        calls.append((filename, data, replace))
        return {"signal_count": 0, "image_count": 20}

    camera_bridge.install_workspace_loader(load_workspace)

    result = camera_bridge.open_bundled_camera_quickstart(replace=False)

    assert result == {"signal_count": 0, "image_count": 20}
    assert calls[0][0] == "camera_quickstart.h5"
    assert calls[0][1].startswith(b"\x89HDF\r\n\x1a\n")
    assert calls[0][2] is False


def test_bundled_camera_recipe_commits_outputs_results_and_provenance(
    camera_bridge, fresh_bootstrap
) -> None:
    """The real quickstart recipe commits both panels and its anchored table."""
    bs = fresh_bootstrap
    camera_bridge.install_workspace_loader(bs.open_workspace_from_bytes)
    camera_bridge.install_recipe_host(bs._MODEL, bs._object_uuid)
    camera_bridge.open_bundled_camera_quickstart()
    image_ids = [image["id"] for image in bs.list_images()]

    committed = camera_bridge.run_bundled_camera_recipe(image_ids)

    outputs = {output["output_id"]: output for output in committed["objects"]}
    assert set(outputs) == {
        "response",
        "mean_dark",
        "mean_flat",
        "dsnu_like_map",
        "prnu_like_map",
        "candidate_pixel_map",
        "prnu_row_profile",
        "prnu_column_profile",
        "dsnu_distribution",
        "prnu_distribution",
    }
    assert outputs["response"]["kind"] == "signal"
    assert outputs["prnu_like_map"]["kind"] == "image"

    response_id = outputs["response"]["id"]
    response = bs._MODEL.get(response_id)
    results = bs.list_signal_results(response_id)
    assert len(results) == 1
    assert results[0]["title"] == "Relative Camera characterization metrics"
    assert committed["results"] == [
        {
            "output_id": "metrics",
            "anchor_output_id": "response",
            "anchor_id": response_id,
            "metadata_key": results[0]["metadata_key"],
        }
    ]

    record = response.get_metadata_option(RECIPE_RUN_RECORD_OPTION)
    assert record["recipe_id"] == committed["recipe_id"]
    assert record["run_id"] == committed["run_id"]
    assert record["status"] == "completed"
    assert record["output_uuids"]["response"] == bs._object_uuid(response)
    assert set(record["input_uuids"]["dark_frames"]) | set(
        record["input_uuids"]["flat_frames"]
    ) == {bs._object_uuid(bs._MODEL.get(image_id)) for image_id in image_ids}
    for output in outputs.values():
        output_record = bs._MODEL.get(output["id"]).get_metadata_option(
            RECIPE_RUN_RECORD_OPTION
        )
        assert output_record == record


def test_bundled_camera_recipe_rolls_back_partial_cross_panel_commit(
    camera_bridge, fresh_bootstrap, monkeypatch
) -> None:
    """A failed output insertion leaves neither objects nor recipe groups."""
    bs = fresh_bootstrap
    camera_bridge.install_workspace_loader(bs.open_workspace_from_bytes)
    camera_bridge.open_bundled_camera_quickstart()
    image_ids = [image["id"] for image in bs.list_images()]
    before = {kind: bs._MODEL.panel_tree(kind) for kind in ("signal", "image")}
    original_add_object = bs._MODEL.add_object
    call_count = 0

    def fail_on_second_output(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            raise RuntimeError("simulated cross-panel commit failure")
        return original_add_object(*args, **kwargs)

    monkeypatch.setattr(bs._MODEL, "add_object", fail_on_second_output)
    camera_bridge.install_recipe_host(bs._MODEL, bs._object_uuid)

    with pytest.raises(
        camera_bridge.CameraRecipeCommitError,
        match="simulated cross-panel commit failure",
    ):
        camera_bridge.run_bundled_camera_recipe(image_ids)

    assert {kind: bs._MODEL.panel_tree(kind) for kind in ("signal", "image")} == before
