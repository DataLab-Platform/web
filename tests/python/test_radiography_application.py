# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Generic plugin-host contracts for the bundled Radiography plugin wheel."""

from __future__ import annotations

import asyncio
import hashlib
import sys
from pathlib import Path

import dlw_applications
import dlw_plugins
import pytest
from datalab import registries

REPO_ROOT = Path(__file__).resolve().parents[2]
RADIOGRAPHY_WHEEL = (
    REPO_ROOT
    / "src"
    / "runtime"
    / "builtin_wheels"
    / "datalab_radiography-0.1.0-py3-none-any.whl"
)
PLUGIN_ID = "org.datalab.radiography"
PLUGIN_MENU = "Plugins/X-ray Radiography & NDT"


@pytest.fixture
def radiography_application(fresh_bootstrap, monkeypatch):
    """Load the bundled Radiography wheel through the generic plugin host."""
    assert RADIOGRAPHY_WHEEL.is_file()
    for name in tuple(sys.modules):
        if name.startswith("datalab_radiography"):
            sys.modules.pop(name, None)
    bootstrap = fresh_bootstrap
    saved_records = dict(dlw_plugins._RECORDS)
    dlw_plugins._RECORDS.clear()
    data = RADIOGRAPHY_WHEEL.read_bytes()
    # CPython is not Pyodide: provide pydicom, required outside the browser
    available = {**dlw_plugins._host_distributions(), "pydicom": "3.0.0"}
    (record,) = dlw_plugins.load_plugin_wheel(
        str(RADIOGRAPHY_WHEEL),
        filename=RADIOGRAPHY_WHEEL.name,
        source="bundled-wheel",
        sha256=hashlib.sha256(data).hexdigest(),
        trust="verified",
        available_distributions=available,
    )
    assert record["loaded"], record["error"]
    dlw_applications.install_host(
        bootstrap._MODEL,
        bootstrap._object_uuid,
        bootstrap.open_workspace_from_bytes,
        "0.12.0",
        bootstrap.reset_all,
        signal_payload=bootstrap._signal_data_payload,
        image_payload=bootstrap._image_data_payload,
    )
    try:
        yield bootstrap, record
    finally:
        dlw_plugins.unload_plugin(record["record_id"])
        registries.clear_origin(PLUGIN_ID)
        dlw_plugins._RECORDS.clear()
        dlw_plugins._RECORDS.update(saved_records)
        for name in tuple(sys.modules):
            if name.startswith("datalab_radiography"):
                sys.modules.pop(name, None)


def _plugin():
    return dlw_plugins.get_plugin_instance(PLUGIN_ID)


def test_radiography_registry_contract(radiography_application) -> None:
    """The plugin record exposes its recipes, examples, tools and features."""
    bootstrap, record = radiography_application
    assert record["source"] == "bundled-wheel"
    assert record["version"] == "0.1.0"
    assert record["info"]["capabilities"] == [
        "application",
        "processing",
        "visualization",
    ]
    assert [recipe["id"].split(":")[1] for recipe in record["recipes"]] == [
        "offset-gain-correction",
        "step-wedge-calibration",
        "duplex-iqi",
        "wall-thickness",
        "indication-detection",
    ]
    assert [example["id"] for example in record["examples"]][:2] == [
        "simulated-weld",
        "simulated-pipe",
    ]
    assert {"walnut", "circuit-board", "knee-phantom"} <= {
        example["id"] for example in record["examples"]
    }
    tools = {tool["id"]: tool for tool in record["tools"]}
    assert tools["xray-simulator"]["kind"] == "instrument"
    assert tools["magnification-value"]["object_type"] == "image"

    features = {
        feature["id"]: feature
        for feature in bootstrap.list_features()
        if feature["id"].startswith(f"{PLUGIN_ID}:")
    }
    assert features[f"{PLUGIN_ID}:flatten-background"]["menu_path"] == (
        f"{PLUGIN_MENU}/Enhancement/Flatten background"
    )
    assert features[f"{PLUGIN_ID}:robust-average"]["pattern"] == "n_to_1"
    assert f"{PLUGIN_ID}:snr" not in features
    analyses = {
        entry["id"]: entry
        for entry in bootstrap.list_image_analysis()
        if entry["id"].startswith(f"{PLUGIN_ID}:")
    }
    assert set(analyses) == {
        f"{PLUGIN_ID}:measurement-report",
        f"{PLUGIN_ID}:snr",
        f"{PLUGIN_ID}:cnr",
    }
    assert analyses[f"{PLUGIN_ID}:snr"]["menu_path"] == (
        f"{PLUGIN_MENU}/Image quality/Signal-to-noise ratio"
    )
    assert analyses[f"{PLUGIN_ID}:snr"]["has_params"] is True


def test_radiography_example_display_and_processing(radiography_application) -> None:
    """Examples keep the radiographic display; plugin features and analyses run."""
    bootstrap, _record = radiography_application
    opened = dlw_applications.open_plugin_example(PLUGIN_ID, "simulated-weld")
    (weld_id,) = opened["selected_ids"]
    weld = bootstrap._MODEL.get(weld_id)
    payload = bootstrap.get_image_data(weld_id, max_size=64)
    assert payload["colormap"] == "gray"
    assert payload["invert_colormap"] is False
    window = bootstrap.get_lut_range(weld_id)
    assert window == pytest.approx([weld.zscalemin, weld.zscalemax])

    (flat_id,) = bootstrap.apply_feature(
        f"{PLUGIN_ID}:flatten-background",
        [weld_id],
        params={"size": 3.0, "unit": "mm"},
    )
    assert bootstrap._MODEL.get(flat_id).data.shape == weld.data.shape

    bootstrap._MODEL.get(weld_id).roi = None
    result = asyncio.run(
        bootstrap.run_image_analysis(weld_id, f"{PLUGIN_ID}:snr", {"srb_um": 140.0})
    )
    assert result["title"] == "SNR"
    tables = bootstrap.list_image_results(weld_id)
    assert [table["title"] for table in tables] == ["SNR"]


def test_display_options_are_shared_with_desktop(radiography_application) -> None:
    """Display options of Desktop workspaces apply; Web choices are written back."""
    bootstrap, _record = radiography_application
    opened = dlw_applications.open_plugin_example(PLUGIN_ID, "simulated-pipe")
    pipe_id = opened["selected_ids"][0]
    pipe = bootstrap._MODEL.get(pipe_id)
    bootstrap.set_colormap(pipe_id, "viridis", True)
    assert pipe.metadata["__colormap"] == "viridis"
    assert bootstrap.get_image_data(pipe_id, max_size=32)["colormap"] == "viridis"
    bootstrap.set_lut_range(pipe_id, [10.0, 20.0])
    assert (pipe.zscalemin, pipe.zscalemax) == (10.0, 20.0)

    added = asyncio.run(
        dlw_applications.launch_plugin_tool(
            PLUGIN_ID, "radiographic-display", [pipe_id]
        )
    )
    assert added == {"signal": [], "image": []}
    payload = bootstrap.get_image_data(pipe_id, max_size=32)
    assert payload["colormap"] == "gray" and payload["invert_colormap"] is False
    assert bootstrap.get_lut_range(pipe_id) == pytest.approx(
        [pipe.zscalemin, pipe.zscalemax]
    )
    assert bootstrap.get_lut_range(pipe_id) != [10.0, 20.0]
    bootstrap.set_colormap(pipe_id, None)
    assert "__colormap" not in pipe.metadata
    bootstrap.set_lut_range(pipe_id, None)
    assert bootstrap.get_lut_range(pipe_id) is None


def test_magnification_tool_and_recipes(radiography_application, monkeypatch) -> None:
    """Tools edit parameters asynchronously; recipes run on the examples."""
    bootstrap, _record = radiography_application
    opened = dlw_applications.open_plugin_example(PLUGIN_ID, "simulated-weld")
    (weld_id,) = opened["selected_ids"]

    async def accept(param) -> bool:
        param.name, param.factor = "Check", 2.0
        return True

    monkeypatch.setattr(_plugin(), "edit", accept)
    asyncio.run(
        dlw_applications.launch_plugin_tool(PLUGIN_ID, "magnification-value", [weld_id])
    )
    magnifications = bootstrap._MODEL.get(weld_id).metadata[
        "plugin.org.datalab.radiography.magnifications"
    ]
    assert '"Check"' in magnifications

    for recipe_id, anchor_kind in (
        (f"{PLUGIN_ID}:duplex-iqi", "signal"),
        (f"{PLUGIN_ID}:indication-detection", "image"),
    ):
        opened = dlw_applications.open_plugin_example(
            PLUGIN_ID, "simulated-weld", recipe_id=recipe_id
        )
        prepared = dlw_applications.prepare_plugin_recipe(
            PLUGIN_ID,
            recipe_id,
            opened["selected_ids"],
            opened["parameter_values"].get(recipe_id),
        )
        assert prepared["readiness"]["status"] == "ready"
        committed = dlw_applications.run_plugin_recipe(
            PLUGIN_ID,
            recipe_id,
            prepared["bindings"],
            {
                **prepared["parameters"]["values"],
                **opened["parameter_values"].get(recipe_id, {}),
            },
        )
        kinds = {output["kind"] for output in committed["objects"]}
        assert anchor_kind in kinds


def test_real_data_example_opens(radiography_application) -> None:
    """Packaged real-data examples open as workspaces."""
    bootstrap, _record = radiography_application
    opened = dlw_applications.open_plugin_example(PLUGIN_ID, "walnut")
    assert opened["filename"] == "walnut.h5"
    assert opened["images"] == 3
    walnut = bootstrap._MODEL.get(opened["selected_ids"][0])
    assert walnut.metadata["plugin.org.datalab.radiography.frame_role"] == "raw"
    assert (
        bootstrap.get_image_data(opened["selected_ids"][0], max_size=32)["colormap"]
        == "gray"
    )
