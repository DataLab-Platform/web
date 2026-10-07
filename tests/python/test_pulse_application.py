# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Generic Applications contracts for the bundled Pulse plugin wheel."""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

import dlw_applications
import dlw_plugins
import pytest
from datalab.recipes import RECIPE_RUN_RECORD_OPTION

REPO_ROOT = Path(__file__).resolve().parents[2]
PULSE_WHEEL = (
    REPO_ROOT
    / "src"
    / "runtime"
    / "builtin_wheels"
    / "datalab_pulse_characterization-0.2.0-py3-none-any.whl"
)
PLUGIN_ID = "org.datalab.pulse-characterization"
RECIPE_ID = f"{PLUGIN_ID}:single-channel-campaign"


@pytest.fixture
def pulse_application(fresh_bootstrap, monkeypatch):
    """Register the bundled Pulse Web class in the generic plugin host."""
    assert PULSE_WHEEL.is_file()
    monkeypatch.syspath_prepend(str(PULSE_WHEEL))
    for name in tuple(sys.modules):
        if name.startswith("datalab_pulse_characterization"):
            sys.modules.pop(name, None)

    from datalab_pulse_characterization.adapters.web import (
        PulseTransientCharacterizationWebPlugin,
    )

    bootstrap = fresh_bootstrap
    plugin = PulseTransientCharacterizationWebPlugin()
    monkeypatch.setitem(
        dlw_plugins._RECORDS,
        PLUGIN_ID,
        dlw_plugins.PluginRecord(
            name=PLUGIN_ID,
            module_name=plugin.__class__.__module__,
            filename=str(PULSE_WHEEL),
            instance=plugin,
            classes=[plugin.__class__],
            source="bundled-wheel",
            artifact_filename=PULSE_WHEEL.name,
            plugin_id=PLUGIN_ID,
            distribution="datalab-pulse-characterization",
            version=plugin.info.version,
            trust="verified",
            entry_point=(
                "datalab_pulse_characterization.adapters.web:"
                "PulseTransientCharacterizationWebPlugin"
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
        if name.startswith("datalab_pulse_characterization"):
            sys.modules.pop(name, None)


def _open_and_prepare(bootstrap):
    opened = dlw_applications.open_plugin_example(PLUGIN_ID, "demo")
    prepared = dlw_applications.prepare_plugin_recipe(
        PLUGIN_ID,
        RECIPE_ID,
        opened["selected_ids"],
    )
    return opened, prepared


def test_pulse_registry_contract_and_generated_campaign(pulse_application) -> None:
    """Registry metadata and the generated demo drive generic preparation."""
    bootstrap = pulse_application
    record = next(
        item for item in dlw_plugins.list_plugins() if item["plugin_id"] == PLUGIN_ID
    )

    assert record["source"] == "bundled-wheel"
    assert record["trust"] == "verified"
    assert record["version"] == "0.2.0"
    assert record["info"]["capabilities"] == ["application", "processing"]
    assert [recipe["id"].split(":")[1] for recipe in record["recipes"]] == [
        "single-channel-campaign",
        "shot-stability",
        "step-response",
        "two-channel-delay",
        "pulse-height-spectrum",
    ]
    assert [example["id"] for example in record["examples"]] == [
        "demo",
        "stability-demo",
        "step-response-demo",
        "two-channel-demo",
        "spectrum-demo",
    ]
    assert record["recipes"][0]["id"] == RECIPE_ID
    assert record["recipes"][0]["version"] == "1.1.0"
    assert record["examples"][0]["id"] == "demo"
    assert record["examples"][0]["recipe_ids"] == [RECIPE_ID]
    assert record["examples"][1]["recipe_ids"] == [
        f"{PLUGIN_ID}:shot-stability",
        RECIPE_ID,
    ]

    opened, prepared = _open_and_prepare(bootstrap)

    assert opened["signals"] == 500
    assert opened["images"] == 0
    assert opened["panel"] == "signal"
    assert opened["filename"] is None
    assert opened["dirty"] is True
    assert len(opened["selected_ids"]) == 500
    assert prepared["bindings"] == {"signals": opened["selected_ids"]}
    assert prepared["ambiguous_slots"] == []
    assert prepared["missing_slots"] == []
    assert prepared["parameters"] is not None
    assert opened["parameter_values"][RECIPE_ID]


def test_pulse_recipe_commits_outputs_results_and_provenance(
    pulse_application,
) -> None:
    """The deterministic campaign commits three curves and its metrics table."""
    bootstrap = pulse_application
    opened, prepared = _open_and_prepare(bootstrap)

    committed = dlw_applications.run_plugin_recipe(
        PLUGIN_ID,
        RECIPE_ID,
        prepared["bindings"],
        opened["parameter_values"][RECIPE_ID],
    )

    assert len(bootstrap.list_signals()) == 503
    outputs = {output["output_id"]: output for output in committed["objects"]}
    assert set(outputs) == {"amplitude_vs_shot", "raw_mean", "aligned_mean"}
    assert all(output["kind"] == "signal" for output in outputs.values())

    anchor_id = outputs["amplitude_vs_shot"]["id"]
    anchor = bootstrap._MODEL.get(anchor_id)
    results = bootstrap.list_signal_results(anchor_id)
    assert len(results) == 1
    table = results[0]
    assert table["title"] == "Pulse campaign shot metrics"
    assert len(table["headers"]) == 23
    assert len(table["data"]) == 500
    status_index = table["headers"].index("Status")
    aligned_index = table["headers"].index("Aligned")
    assert Counter(row[status_index] for row in table["data"]) == {
        "VALID": 489,
        "NO_PULSE": 2,
        "LOW_SNR": 2,
        "SATURATED": 2,
        "MULTIPLE_PULSES": 2,
        "OUTLIER": 3,
    }
    assert sum(bool(row[aligned_index]) for row in table["data"]) == 489

    record = anchor.get_metadata_option(RECIPE_RUN_RECORD_OPTION)
    assert record["plugin_id"] == PLUGIN_ID
    assert record["recipe_id"] == RECIPE_ID
    assert record["run_id"] == committed["run_id"]
    assert record["status"] == "completed"
    assert len(record["input_uuids"]["signals"]) == 500
    assert record["output_uuids"]["amplitude_vs_shot"] == bootstrap._object_uuid(anchor)
    for output in outputs.values():
        assert (
            bootstrap._MODEL.get(output["id"]).get_metadata_option(
                RECIPE_RUN_RECORD_OPTION
            )
            == record
        )


def test_pulse_generated_example_rolls_back_partial_commit(
    pulse_application, monkeypatch
) -> None:
    """A failed generic example insertion leaves no partial campaign."""
    bootstrap = pulse_application
    original_add_object = bootstrap._MODEL.add_object
    call_count = 0

    def fail_on_second_input(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            raise RuntimeError("simulated Pulse input failure")
        return original_add_object(*args, **kwargs)

    monkeypatch.setattr(bootstrap._MODEL, "add_object", fail_on_second_input)

    with pytest.raises(
        dlw_applications.RecipeCommitError,
        match="simulated Pulse input failure",
    ):
        dlw_applications.open_plugin_example(PLUGIN_ID, "demo")

    tree = bootstrap._MODEL.panel_tree("signal")
    assert all(not group["objects"] for group in tree["groups"])
    assert all(group["name"] != "Synthetic pulse campaign" for group in tree["groups"])


@pytest.mark.parametrize(
    ("example_id", "local_recipe_id", "signal_count", "slots", "anchor", "tables"),
    [
        (
            "stability-demo",
            "shot-stability",
            600,
            {"signals"},
            "arrival_time_vs_shot",
            ["Pulse stability metrics"],
        ),
        (
            "stability-demo",
            "single-channel-campaign",
            600,
            {"signals"},
            "amplitude_vs_shot",
            ["Pulse campaign shot metrics"],
        ),
        (
            "step-response-demo",
            "step-response",
            64,
            {"signals"},
            "mean_step",
            ["Step-response metrics"],
        ),
        (
            "two-channel-demo",
            "two-channel-delay",
            597,
            {"reference", "measured"},
            "delay_vs_shot",
            ["Two-channel delay summary", "Two-channel pair metrics"],
        ),
        (
            "spectrum-demo",
            "pulse-height-spectrum",
            2_500,
            {"signals"},
            "raw_spectrum",
            ["Pulse-height spectrum summary", "Calibration photopeaks"],
        ),
    ],
)
def test_pulse_generated_examples_bind_and_run(
    pulse_application,
    example_id: str,
    local_recipe_id: str,
    signal_count: int,
    slots: set[str],
    anchor: str,
    tables: list[str],
) -> None:
    """Each generated example binds unambiguously and runs each of its recipes."""
    bootstrap = pulse_application
    recipe_id = f"{PLUGIN_ID}:{local_recipe_id}"
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
    assert len(opened["selected_ids"]) == signal_count
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
    assert [result["title"] for result in results] == tables


def test_pulse_recipe_rolls_back_partial_output_commit(
    pulse_application, monkeypatch
) -> None:
    """A failed generic output insertion restores the complete input tree."""
    bootstrap = pulse_application
    opened, prepared = _open_and_prepare(bootstrap)
    before = bootstrap._MODEL.panel_tree("signal")
    original_add_object = bootstrap._MODEL.add_object
    call_count = 0

    def fail_on_second_output(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            raise RuntimeError("simulated Pulse output failure")
        return original_add_object(*args, **kwargs)

    monkeypatch.setattr(bootstrap._MODEL, "add_object", fail_on_second_output)

    with pytest.raises(
        dlw_applications.RecipeCommitError,
        match="simulated Pulse output failure",
    ):
        dlw_applications.run_plugin_recipe(
            PLUGIN_ID,
            RECIPE_ID,
            prepared["bindings"],
            opened["parameter_values"][RECIPE_ID],
        )

    assert bootstrap._MODEL.panel_tree("signal") == before
