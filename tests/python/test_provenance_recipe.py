# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Provenance of the results of application methods (plugin recipes).

A recipe output has no production in the provenance ledger: the Provenance
panel shows the recipe run recorded in its metadata instead (web#131).
"""

from __future__ import annotations

import types

import dlw_applications
import pytest
from datalab.plugins.recipes import RECIPE_RUN_RECORD_OPTION
from test_camera_application import (  # noqa: F401  # pylint: disable=unused-import
    DARK_RECIPE_ID,
    PLUGIN_ID,
    camera_application,
)

RECORD_KEY = f"__{RECIPE_RUN_RECORD_OPTION}"


def _run_dark_recipe() -> dict[str, dict]:
    """Run the dark-current method on its example; return outputs by ID."""
    opened = dlw_applications.open_plugin_example(
        PLUGIN_ID, "dark-ramp", recipe_id=DARK_RECIPE_ID
    )
    prepared = dlw_applications.prepare_plugin_recipe(
        PLUGIN_ID,
        DARK_RECIPE_ID,
        opened["selected_ids"],
        opened["parameter_values"].get(DARK_RECIPE_ID),
    )
    committed = dlw_applications.run_plugin_recipe(
        PLUGIN_ID,
        DARK_RECIPE_ID,
        prepared["bindings"],
        {
            **prepared["parameters"]["values"],
            **opened["parameter_values"].get(DARK_RECIPE_ID, {}),
        },
    )
    return {output["output_id"]: output for output in committed["objects"]}


@pytest.mark.usefixtures("camera_application")
def test_recipe_output_shows_its_run(fresh_bootstrap) -> None:
    """The description of a recipe output names its run, inputs and results."""
    bootstrap = fresh_bootstrap
    outputs = _run_dark_recipe()
    anchor = outputs["dark_ramp"]["id"]

    description = bootstrap.describe_object_provenance(anchor)

    assert description["production"] is None
    run = description["recipe_run"]
    assert run["status"] == "ok"
    assert run["recipe_id"] == DARK_RECIPE_ID
    assert run["plugin_id"] == PLUGIN_ID
    assert run["title"]
    assert run["role"] == "dark_ramp"
    assert run["inputs"]
    for entry in run["inputs"]:
        assert entry["id"] is not None and entry["title"]
        assert entry["object_kind"] == "image"
        assert entry["recipe_run"] is None
    assert {entry["id"] for entry in run["outputs"]} == {
        output["id"] for output in outputs.values()
    }
    assert [entry["is_self"] for entry in run["outputs"]].count(True) == 1
    assert all(item["label"] for item in run["parameters"])
    # Consulting never writes into the metadata of the objects.
    for entry in run["inputs"]:
        assert RECORD_KEY not in bootstrap._MODEL.get(entry["id"]).metadata


@pytest.mark.usefixtures("camera_application")
def test_processing_of_a_recipe_output_leads_back_to_its_run(fresh_bootstrap) -> None:
    """The input of a later processing holds the run of the method."""
    bootstrap = fresh_bootstrap
    anchor = _run_dark_recipe()["dark_ramp"]["id"]
    (filtered,) = bootstrap.apply_feature(
        "gaussian_filter", [anchor], params={"sigma": 2.0}
    )

    description = bootstrap.describe_object_provenance(filtered)

    assert description["recipe_run"] is None
    (entry,) = description["production"]["inputs"]
    assert entry["id"] == anchor
    assert entry["recipe_run"]["recipe_id"] == DARK_RECIPE_ID
    assert entry["recipe_run"]["inputs"][0]["id"] is not None


@pytest.mark.usefixtures("camera_application")
def test_copy_and_reopened_workspace(fresh_bootstrap) -> None:
    """A copy is not attributed to the method; the run survives reopening."""
    bootstrap = fresh_bootstrap
    anchor = _run_dark_recipe()["dark_ramp"]["id"]
    copy = bootstrap.duplicate_object(anchor)
    uuid = bootstrap._object_uuid(bootstrap._MODEL.get(anchor))

    assert bootstrap.describe_object_provenance(copy)["recipe_run"] is None

    data = bootstrap.save_workspace_to_bytes()
    bootstrap.open_workspace_from_bytes("workspace.h5", data, replace=True)
    reopened = next(
        oid
        for oid, entry in bootstrap._MODEL._objects.items()
        if bootstrap._object_uuid(entry.obj) == uuid
    )
    run = bootstrap.describe_object_provenance(reopened)["recipe_run"]
    assert run["recipe_id"] == DARK_RECIPE_ID
    assert all(entry["id"] is not None for entry in run["inputs"])


@pytest.mark.usefixtures("camera_application")
def test_recipe_run_without_capsule(fresh_bootstrap, monkeypatch) -> None:
    """The run is shown even when the provenance is not available."""
    bootstrap = fresh_bootstrap
    anchor = _run_dark_recipe()["dark_ramp"]["id"]
    monkeypatch.setattr(
        bootstrap, "_PROVENANCE", types.SimpleNamespace(available=False)
    )

    description = bootstrap.describe_object_provenance(anchor)

    assert description["available"] is False
    assert description["recipe_run"]["recipe_id"] == DARK_RECIPE_ID


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
