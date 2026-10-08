# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Generic Applications contracts for the bundled Camera plugin wheel."""

from __future__ import annotations

import sys
from pathlib import Path

import dlw_applications
import dlw_plugins
import pytest
from datalab.plugins.recipes import RECIPE_RUN_RECORD_OPTION

REPO_ROOT = Path(__file__).resolve().parents[2]
CAMERA_WHEEL = (
    REPO_ROOT
    / "src"
    / "runtime"
    / "builtin_wheels"
    / "datalab_camera_characterization-0.2.0-py3-none-any.whl"
)
PLUGIN_ID = "org.datalab.camera-characterization"
RECIPE_ID = f"{PLUGIN_ID}:relative-dn-characterization"
PTC_RECIPE_ID = f"{PLUGIN_ID}:photon-transfer"
DARK_RECIPE_ID = f"{PLUGIN_ID}:dark-current"


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
        "0.9.0",
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
    assert record["version"] == "0.2.0"
    assert record["info"]["capabilities"] == ["application", "processing"]
    assert [recipe["id"] for recipe in record["recipes"]] == [
        RECIPE_ID,
        PTC_RECIPE_ID,
        DARK_RECIPE_ID,
    ]
    assert [example["id"] for example in record["examples"]] == [
        "quickstart",
        "photon-transfer",
        "dark-ramp",
    ]
    assert record["recipes"][0]["id"] == RECIPE_ID
    assert record["recipes"][0]["version"] == "1.1.0"
    assert record["examples"][0]["id"] == "quickstart"
    assert record["examples"][0]["recipe_ids"] == [RECIPE_ID]
    assert record["examples"][1]["recipe_ids"] == [PTC_RECIPE_ID, RECIPE_ID]
    flat_slot = record["recipes"][0]["inputs"][1]
    assert flat_slot["title"] == "Flat frames"
    assert flat_slot["min_count"] == 4
    assert [item["required"] for item in flat_slot["metadata"]] == [True, False]

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


@pytest.mark.parametrize(
    ("example_id", "recipe_id", "image_count", "slots", "anchor", "table_title"),
    [
        (
            "photon-transfer",
            PTC_RECIPE_ID,
            36,
            {"dark_frames", "flat_frames"},
            "ptc",
            "Photon transfer metrics",
        ),
        (
            "photon-transfer",
            RECIPE_ID,
            36,
            {"dark_frames", "flat_frames"},
            "response",
            "Relative Camera characterization metrics",
        ),
        (
            "dark-ramp",
            DARK_RECIPE_ID,
            20,
            {"dark_frames"},
            "dark_ramp",
            "Dark-current metrics",
        ),
    ],
)
def test_camera_generated_examples_bind_and_run(
    camera_application,
    example_id: str,
    recipe_id: str,
    image_count: int,
    slots: set[str],
    anchor: str,
    table_title: str,
) -> None:
    """Each generated example binds unambiguously and runs each of its recipes."""
    bootstrap = camera_application
    opened = dlw_applications.open_plugin_example(
        PLUGIN_ID, example_id, recipe_id=recipe_id
    )
    prepared = dlw_applications.prepare_plugin_recipe(
        PLUGIN_ID,
        recipe_id,
        opened["selected_ids"],
        opened["parameter_values"].get(recipe_id),
    )

    assert opened["recipe_id"] == recipe_id
    assert opened["panel"] == "image"
    assert len(opened["selected_ids"]) == image_count
    assert prepared["readiness"]["status"] == "ready"
    assert set(prepared["bindings"]) == slots

    committed = dlw_applications.run_plugin_recipe(
        PLUGIN_ID,
        recipe_id,
        prepared["bindings"],
        {
            **prepared["parameters"]["values"],
            **opened["parameter_values"].get(recipe_id, {}),
        },
    )

    outputs = {output["output_id"]: output for output in committed["objects"]}
    results = bootstrap.list_signal_results(outputs[anchor]["id"])
    assert [result["title"] for result in results] == [table_title]


def test_camera_simulator_acquires_frames_ready_for_the_methods(
    camera_application,
) -> None:
    """The simulator tool shows live frames and acquires a usable campaign."""
    bootstrap = camera_application
    dlw_applications.install_host(
        bootstrap._MODEL,
        bootstrap._object_uuid,
        bootstrap.open_workspace_from_bytes,
        "0.9.0",
        bootstrap.reset_all,
        signal_payload=bootstrap._signal_data_payload,
        image_payload=bootstrap._image_data_payload,
    )
    record = next(
        item for item in dlw_plugins.list_plugins() if item["plugin_id"] == PLUGIN_ID
    )
    assert record["tools"] == [
        {
            "id": "camera-simulator",
            "title": "Scientific camera simulator...",
            "description": (
                "Acquire dark and flat frames from a simulated camera with live view"
            ),
            "kind": "instrument",
            "object_type": "image",
            "selection": "none",
        }
    ]

    opened = dlw_applications.open_plugin_instrument(PLUGIN_ID, "camera-simulator")
    assert opened["title"] == "Scientific camera simulator"
    frame = dlw_applications.preview_plugin_instrument(PLUGIN_ID, "camera-simulator")
    assert frame["kind"] == "image"
    assert frame["value_range"] == [0.0, 4095.0]
    assert frame["items"][0]["width"] == 128

    acquired = dlw_applications.acquire_plugin_instrument(
        PLUGIN_ID, "camera-simulator", {"mode": "sequence"}
    )
    assert acquired["panel"] == "image"
    assert len(acquired["object_ids"]) == 4 + 2 * 12
    assessments = dlw_applications.assess_plugin_recipes(
        PLUGIN_ID, acquired["object_ids"]
    )
    assert assessments[RECIPE_ID]["status"] == "ready"
    assert assessments[PTC_RECIPE_ID]["status"] == "ready"
