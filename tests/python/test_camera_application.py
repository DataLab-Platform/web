# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Generic Applications contracts for the bundled Camera plugin wheel."""

from __future__ import annotations

import sys
from pathlib import Path

import dlw_applications
import dlw_plugins
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
PLUGIN_ID = "org.datalab.camera-characterization"
RECIPE_ID = f"{PLUGIN_ID}:relative-dn-characterization"


@pytest.fixture
def camera_application(fresh_bootstrap, monkeypatch):
    """Register the bundled Camera Web class in the generic plugin host."""
    assert CAMERA_WHEEL.is_file()
    monkeypatch.syspath_prepend(str(CAMERA_WHEEL))
    for name in tuple(sys.modules):
        if name.startswith("datalab_camera_characterization"):
            sys.modules.pop(name, None)

    from datalab_camera_characterization.adapters.web import (
        CameraDetectorCharacterizationWebPlugin,
    )

    bootstrap = fresh_bootstrap
    plugin = CameraDetectorCharacterizationWebPlugin()
    monkeypatch.setitem(
        dlw_plugins._RECORDS,
        PLUGIN_ID,
        dlw_plugins.PluginRecord(
            name=PLUGIN_ID,
            module_name=plugin.__class__.__module__,
            filename=str(CAMERA_WHEEL),
            instance=plugin,
            classes=[plugin.__class__],
            source="bundled-wheel",
            artifact_filename=CAMERA_WHEEL.name,
            plugin_id=PLUGIN_ID,
            distribution="datalab-camera-characterization",
            version=plugin.info.version,
            trust="verified",
            entry_point=(
                "datalab_camera_characterization.adapters.web:"
                "CameraDetectorCharacterizationWebPlugin"
            ),
        ),
    )
    dlw_applications.install_host(
        bootstrap._MODEL,
        bootstrap._object_uuid,
        bootstrap.open_workspace_from_bytes,
        "0.8.0",
        bootstrap.reset_all,
    )
    yield bootstrap
    for name in tuple(sys.modules):
        if name.startswith("datalab_camera_characterization"):
            sys.modules.pop(name, None)


def _open_and_prepare(bootstrap):
    opened = dlw_applications.open_plugin_example(PLUGIN_ID, "quickstart")
    prepared = dlw_applications.prepare_plugin_recipe(
        PLUGIN_ID,
        RECIPE_ID,
        opened["selected_ids"],
    )
    return opened, prepared


def test_camera_registry_contract_and_quickstart_binding(camera_application) -> None:
    """Registry metadata and the real quickstart drive generic preparation."""
    bootstrap = camera_application
    record = next(
        item for item in dlw_plugins.list_plugins() if item["plugin_id"] == PLUGIN_ID
    )

    assert record["source"] == "bundled-wheel"
    assert record["trust"] == "verified"
    assert record["version"] == "0.1.0"
    assert record["info"]["capabilities"] == ["application", "processing"]
    assert record["recipes"][0]["id"] == RECIPE_ID
    assert record["recipes"][0]["version"] == "1.1.0"
    assert record["examples"][0]["id"] == "quickstart"
    assert record["examples"][0]["recipe_id"] == RECIPE_ID

    opened, prepared = _open_and_prepare(bootstrap)

    assert opened["filename"] == "camera_quickstart.h5"
    assert opened["panel"] == "image"
    assert len(opened["selected_ids"]) == 20
    assert prepared["ambiguous_slots"] == []
    assert prepared["missing_slots"] == []
    assert set(prepared["bindings"]) == {"dark_frames", "flat_frames"}
    assert set(prepared["bindings"]["dark_frames"]).isdisjoint(
        prepared["bindings"]["flat_frames"]
    )
    assert set(prepared["bindings"]["dark_frames"]) | set(
        prepared["bindings"]["flat_frames"]
    ) == set(opened["selected_ids"])


def test_camera_recipe_commits_outputs_results_and_provenance(
    camera_application,
) -> None:
    """The real Camera recipe commits both panels and its anchored table."""
    bootstrap = camera_application
    _opened, prepared = _open_and_prepare(bootstrap)

    committed = dlw_applications.run_plugin_recipe(
        PLUGIN_ID,
        RECIPE_ID,
        prepared["bindings"],
        prepared["parameters"]["values"],
    )

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
    response = bootstrap._MODEL.get(response_id)
    results = bootstrap.list_signal_results(response_id)
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
    assert record["plugin_id"] == PLUGIN_ID
    assert record["recipe_id"] == RECIPE_ID
    assert record["run_id"] == committed["run_id"]
    assert record["status"] == "completed"
    assert record["output_uuids"]["response"] == bootstrap._object_uuid(response)
    for output in outputs.values():
        assert (
            bootstrap._MODEL.get(output["id"]).get_metadata_option(
                RECIPE_RUN_RECORD_OPTION
            )
            == record
        )


def test_camera_recipe_rolls_back_partial_cross_panel_commit(
    camera_application, monkeypatch
) -> None:
    """A failed generic output insertion leaves no recipe output group."""
    bootstrap = camera_application
    _opened, prepared = _open_and_prepare(bootstrap)
    before = {kind: bootstrap._MODEL.panel_tree(kind) for kind in ("signal", "image")}
    original_add_object = bootstrap._MODEL.add_object
    call_count = 0

    def fail_on_second_output(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            raise RuntimeError("simulated cross-panel commit failure")
        return original_add_object(*args, **kwargs)

    monkeypatch.setattr(bootstrap._MODEL, "add_object", fail_on_second_output)

    with pytest.raises(
        dlw_applications.RecipeCommitError,
        match="simulated cross-panel commit failure",
    ):
        dlw_applications.run_plugin_recipe(
            PLUGIN_ID,
            RECIPE_ID,
            prepared["bindings"],
            prepared["parameters"]["values"],
        )

    assert {
        kind: bootstrap._MODEL.panel_tree(kind) for kind in ("signal", "image")
    } == before
