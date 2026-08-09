# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Contracts for the explicitly bundled Pulse plugin wheel."""

from __future__ import annotations

import importlib
import sys
from collections import Counter
from pathlib import Path

import pytest
from datalab.recipes import RECIPE_RUN_RECORD_OPTION

REPO_ROOT = Path(__file__).resolve().parents[2]
PULSE_WHEEL = (
    REPO_ROOT
    / "src"
    / "runtime"
    / "builtin_wheels"
    / "datalab_pulse_characterization-0.1.0-py3-none-any.whl"
)


@pytest.fixture
def pulse_bridge(monkeypatch):
    """Import the Web bridge with the bundled wheel on ``sys.path``."""
    assert PULSE_WHEEL.is_file()
    monkeypatch.syspath_prepend(str(PULSE_WHEEL))
    for name in tuple(sys.modules):
        if name == "dlw_pulse" or name.startswith("datalab_pulse_characterization"):
            sys.modules.pop(name, None)
    yield importlib.import_module("dlw_pulse")
    for name in tuple(sys.modules):
        if name == "dlw_pulse" or name.startswith("datalab_pulse_characterization"):
            sys.modules.pop(name, None)


def test_bundled_pulse_manifest_matches_verified_runtime_matrix(pulse_bridge) -> None:
    """The wheel declares the exact browser matrix qualified by Playwright."""
    assert pulse_bridge.get_bundled_pulse_manifest() == {
        "plugin_id": "org.datalab.pulse-characterization",
        "plugin_version": "0.1.0",
        "web_status": "verified",
        "datalab_web_version": "0.8.0",
        "pyodide_version": "0.26.4",
        "recipe_id": ("org.datalab.pulse-characterization:single-channel-campaign"),
        "recipe_version": "1.1.0",
    }


def test_bundled_pulse_demo_and_recipe_commit_outputs_and_provenance(
    pulse_bridge, fresh_bootstrap
) -> None:
    """The deterministic campaign commits three curves and its metrics table."""
    bs = fresh_bootstrap
    pulse_bridge.install_recipe_host(bs._MODEL, bs._object_uuid)

    demo = pulse_bridge.create_bundled_pulse_demo()
    committed = pulse_bridge.run_bundled_pulse_recipe(
        demo["signal_ids"], demo["parameter_values"]
    )

    assert demo["signal_count"] == 500
    assert len(bs.list_signals()) == 503
    outputs = {output["output_id"]: output for output in committed["objects"]}
    assert set(outputs) == {"amplitude_vs_shot", "raw_mean", "aligned_mean"}
    assert all(output["kind"] == "signal" for output in outputs.values())

    anchor_id = outputs["amplitude_vs_shot"]["id"]
    anchor = bs._MODEL.get(anchor_id)
    results = bs.list_signal_results(anchor_id)
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
    assert record["recipe_id"] == committed["recipe_id"]
    assert record["run_id"] == committed["run_id"]
    assert record["status"] == "completed"
    assert len(record["input_uuids"]["signals"]) == 500
    assert record["output_uuids"]["amplitude_vs_shot"] == bs._object_uuid(anchor)
    for output in outputs.values():
        output_record = bs._MODEL.get(output["id"]).get_metadata_option(
            RECIPE_RUN_RECORD_OPTION
        )
        assert output_record == record


def test_bundled_pulse_demo_rolls_back_partial_input_commit(
    pulse_bridge, fresh_bootstrap, monkeypatch
) -> None:
    """A failed demo insertion leaves neither signals nor a recipe group."""
    bs = fresh_bootstrap
    before = bs._MODEL.panel_tree("signal")
    original_add_object = bs._MODEL.add_object
    call_count = 0

    def fail_on_second_input(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            raise RuntimeError("simulated Pulse input failure")
        return original_add_object(*args, **kwargs)

    monkeypatch.setattr(bs._MODEL, "add_object", fail_on_second_input)
    pulse_bridge.install_recipe_host(bs._MODEL, bs._object_uuid)

    with pytest.raises(
        pulse_bridge.PulseRecipeCommitError,
        match="simulated Pulse input failure",
    ):
        pulse_bridge.create_bundled_pulse_demo()

    assert bs._MODEL.panel_tree("signal") == before


def test_bundled_pulse_recipe_rolls_back_partial_output_commit(
    pulse_bridge, fresh_bootstrap, monkeypatch
) -> None:
    """A failed output insertion restores the complete 500-input tree."""
    bs = fresh_bootstrap
    pulse_bridge.install_recipe_host(bs._MODEL, bs._object_uuid)
    demo = pulse_bridge.create_bundled_pulse_demo()
    before = bs._MODEL.panel_tree("signal")
    original_add_object = bs._MODEL.add_object
    call_count = 0

    def fail_on_second_output(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            raise RuntimeError("simulated Pulse output failure")
        return original_add_object(*args, **kwargs)

    monkeypatch.setattr(bs._MODEL, "add_object", fail_on_second_output)

    with pytest.raises(
        pulse_bridge.PulseRecipeCommitError,
        match="simulated Pulse output failure",
    ):
        pulse_bridge.run_bundled_pulse_recipe(
            demo["signal_ids"], demo["parameter_values"]
        )

    assert bs._MODEL.panel_tree("signal") == before
