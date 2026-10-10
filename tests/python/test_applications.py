# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Contracts for the generic plugin Applications host."""

from __future__ import annotations

import asyncio
import dataclasses

import dlw_applications
import dlw_plugins
import numpy as np
import pytest
from datalab.plugins import PluginBase, PluginCapability, PluginInfo
from datalab.plugins.examples import PluginExampleData
from datalab.plugins.instruments import (
    InstrumentAcquisition,
    InstrumentFrame,
    PluginInstrument,
)
from datalab.plugins.recipes import (
    RECIPE_RUN_RECORD_OPTION,
    RecipeCardinality,
    RecipeDescriptor,
    RecipeDiagnostic,
    RecipeDiagnosticLevel,
    RecipeInputSlot,
    RecipeMetadataRequirement,
    RecipeObjectOutput,
    RecipeObjectType,
    RecipeOutcome,
    RecipeResultOutput,
    RecipeValidationError,
)
from datalab.plugins.tools import PluginTool
from guidata import dataset as gds
from sigima.objects import create_image, create_signal
from sigima.objects.scalar import TableResult

PLUGIN_ID = "org.example.generic-application"
RECIPE_ID = f"{PLUGIN_ID}:analyze"


class GenericRecipeParameters(gds.DataSet):
    """Parameters used to exercise the generic DataSet bridge."""

    gain = gds.FloatItem("Gain", default=2.0, min=0.0)


def _run_generic_recipe(inputs, parameters, context):
    """Return cross-panel outputs, an anchored result, and a diagnostic."""
    context.report_progress(0.5, "Computing")
    source = inputs["source"][0]
    output = source.copy()
    output.title = "Amplified"
    output.y = output.y * parameters.gain
    image = create_image("Summary map", np.asarray([output.y]))
    return RecipeOutcome(
        objects=(
            RecipeObjectOutput("amplified", output),
            RecipeObjectOutput("summary", image),
        ),
        results=(
            RecipeResultOutput(
                "metrics",
                TableResult.from_rows(
                    "Generic metrics",
                    ["Gain"],
                    [[parameters.gain]],
                ),
                "amplified",
            ),
        ),
        diagnostics=(
            RecipeDiagnostic(
                RecipeDiagnosticLevel.INFO,
                "generic-complete",
                "Generic recipe completed",
                {"gain": parameters.gain},
            ),
        ),
    )


GENERIC_RECIPE = RecipeDescriptor(
    recipe_id=RECIPE_ID,
    plugin_version="1.0.0",
    title="Generic analysis",
    version="1.0.0",
    run=_run_generic_recipe,
    description="Exercise the generic Applications host.",
    inputs=(
        RecipeInputSlot(
            "source",
            RecipeObjectType.SIGNAL,
            RecipeCardinality.ONE,
        ),
    ),
    parameter_class=GenericRecipeParameters,
)


class GenericApplicationPlugin(PluginBase):
    """Minimal managed plugin used by the generic host tests."""

    PLUGIN_INFO = PluginInfo(
        id=PLUGIN_ID,
        name="Generic Application",
        version="1.0.0",
        capabilities=(PluginCapability.APPLICATION,),
    )
    RECIPES = (GENERIC_RECIPE,)

    def create_actions(self) -> None:
        """The generic host owns application actions."""


@pytest.fixture
def applications_env(fresh_bootstrap, monkeypatch):
    """Install a managed application record and the live object-model host."""
    bootstrap = fresh_bootstrap
    instance = GenericApplicationPlugin()
    record = dlw_plugins.PluginRecord(
        name=PLUGIN_ID,
        module_name=__name__,
        filename=__file__,
        instance=instance,
        classes=[GenericApplicationPlugin],
        plugin_id=PLUGIN_ID,
        version="1.0.0",
        enabled=True,
        source="user-wheel",
    )
    monkeypatch.setitem(dlw_plugins._RECORDS, PLUGIN_ID, record)
    dlw_applications.install_host(
        bootstrap._MODEL,
        bootstrap._object_uuid,
        bootstrap.open_workspace_from_bytes,
        "0.8.0",
    )
    return bootstrap, record


def _add_input_signal(bootstrap) -> str:
    return bootstrap.add_signal_from_arrays("Input", [0.0, 1.0], [1.0, 3.0])


def test_add_metadata_suggests_keys_declared_by_applications(
    applications_env, monkeypatch
) -> None:
    bootstrap, record = applications_env
    key = "plugin.org.example.generic-application.gain"
    slot = RecipeInputSlot(
        "source",
        RecipeObjectType.SIGNAL,
        RecipeCardinality.ONE,
        metadata=(RecipeMetadataRequirement(key, "Detector gain"),),
    )
    recipe = dataclasses.replace(GENERIC_RECIPE, inputs=(slot,))
    monkeypatch.setattr(GenericApplicationPlugin, "RECIPES", (recipe,))
    signal = bootstrap._MODEL.get(_add_input_signal(bootstrap))
    signal.metadata["operator"] = "Ada"

    assert bootstrap._metadata_key_suggestions([signal]) == [
        ("operator", "e.g. 'Ada'"),
        (key, "Detector gain"),
    ]
    assert dlw_plugins.declared_metadata_keys("image") == []
    record.enabled = False
    assert dlw_plugins.declared_metadata_keys("signal") == []


def test_prepare_recipe_returns_schema_and_unambiguous_binding(
    applications_env,
) -> None:
    bootstrap, _record = applications_env
    input_id = _add_input_signal(bootstrap)

    prepared = dlw_applications.prepare_plugin_recipe(
        PLUGIN_ID,
        RECIPE_ID,
        [input_id],
    )

    assert prepared["bindings"] == {"source": [input_id]}
    assert prepared["ambiguous_slots"] == []
    assert prepared["missing_slots"] == []
    assert prepared["readiness"]["status"] == "ready"
    assert prepared["parameters"]["values"]["gain"] == 2.0
    assert prepared["slots"] == [
        {
            "id": "source",
            "title": "Source",
            "description": "",
            "object_type": "signal",
            "cardinality": "one",
            "required": True,
            "min_count": 1,
            "metadata": [],
        }
    ]


def _frames_recipe(**kwargs) -> RecipeDescriptor:
    """Return a recipe requiring two labeled frames, with an input check."""

    def check(inputs, parameters):
        if parameters.gain > 5.0:
            return [RecipeDiagnostic("error", "high-gain", "Gain too high")]
        return [RecipeDiagnostic("warning", "few-frames", "Few frames")]

    values = {
        "recipe_id": f"{PLUGIN_ID}:frames",
        "plugin_version": "1.0.0",
        "title": "Frames",
        "version": "1.0.0",
        "run": _run_generic_recipe,
        "inputs": (
            RecipeInputSlot(
                "frames",
                RecipeObjectType.SIGNAL,
                RecipeCardinality.MANY,
                title="Frames",
                description="Labeled frames",
                min_count=2,
                metadata=(RecipeMetadataRequirement("label", "Frame label"),),
            ),
        ),
        "parameter_class": GenericRecipeParameters,
        "check_inputs": check,
    }
    values.update(kwargs)
    return RecipeDescriptor(**values)


def test_recipes_are_assessed_on_the_selection_with_example_values(
    applications_env, monkeypatch
) -> None:
    """Readiness explains missing metadata, counts, and recipe diagnostics."""
    bootstrap, _record = applications_env
    recipe = _frames_recipe()
    monkeypatch.setattr(GenericApplicationPlugin, "RECIPES", (GENERIC_RECIPE, recipe))
    first, second = _add_input_signal(bootstrap), _add_input_signal(bootstrap)
    bootstrap._MODEL.get(first).metadata["label"] = "A"

    assessed = dlw_applications.assess_plugin_recipes(PLUGIN_ID, [first, second])
    assert assessed[RECIPE_ID]["status"] == "needs_assignment"
    frames = assessed[recipe.recipe_id]
    assert frames["status"] == "not_ready"
    assert frames["bindings"] == {"frames": [first, second]}
    assert frames["issues"] == [
        {
            "code": "missing_metadata",
            "slot_id": "frames",
            "details": {"key": "label", "count": 1, "titles": ["Input"]},
        }
    ]

    bootstrap._MODEL.get(second).metadata["label"] = "B"
    assessed = dlw_applications.assess_plugin_recipes(
        PLUGIN_ID, [first, second], {recipe.recipe_id: {"gain": 9.0}}
    )
    assert assessed[recipe.recipe_id]["status"] == "not_ready"
    assert assessed[recipe.recipe_id]["diagnostics"][0]["code"] == "high-gain"
    assessed = dlw_applications.assess_plugin_recipes(PLUGIN_ID, [first, second])
    assert assessed[recipe.recipe_id]["status"] == "warnings"

    prepared = dlw_applications.prepare_plugin_recipe(
        PLUGIN_ID, recipe.recipe_id, [first]
    )
    assert prepared["readiness"]["issues"][0]["code"] == "too_few"
    assert prepared["candidates"][0]["missing_metadata"] == {}

    def broken_suggestion(_candidates):
        raise RuntimeError("broken suggestion")

    monkeypatch.setattr(
        GenericApplicationPlugin,
        "RECIPES",
        (GENERIC_RECIPE, _frames_recipe(suggest_bindings=broken_suggestion)),
    )
    assessed = dlw_applications.assess_plugin_recipes(PLUGIN_ID, [first, second])
    assert assessed[recipe.recipe_id] == {
        "status": "error",
        "error": "broken suggestion",
    }


def test_edited_bindings_are_checked_without_running(
    applications_env, monkeypatch
) -> None:
    """User assignments are assessed, then enforced when the recipe runs."""
    bootstrap, _record = applications_env
    recipe = _frames_recipe()
    monkeypatch.setattr(GenericApplicationPlugin, "RECIPES", (recipe,))
    first, second = _add_input_signal(bootstrap), _add_input_signal(bootstrap)
    bootstrap._MODEL.get(first).metadata["label"] = "A"

    checked = dlw_applications.check_plugin_recipe_bindings(
        PLUGIN_ID, recipe.recipe_id, {"frames": [first, first]}
    )
    assert [issue["code"] for issue in checked["issues"]] == ["duplicate"]

    with pytest.raises(RecipeValidationError, match="at least 2 objects"):
        dlw_applications.run_plugin_recipe(
            PLUGIN_ID, recipe.recipe_id, {"frames": [first]}
        )
    with pytest.raises(RecipeValidationError, match="metadata 'label'"):
        dlw_applications.run_plugin_recipe(
            PLUGIN_ID, recipe.recipe_id, {"frames": [first, second]}
        )
    bootstrap._MODEL.get(second).metadata["label"] = "B"
    with pytest.raises(RecipeValidationError, match="Gain too high"):
        dlw_applications.run_plugin_recipe(
            PLUGIN_ID, recipe.recipe_id, {"frames": [first, second]}, {"gain": 9.0}
        )


def test_prepare_recipe_does_not_duplicate_candidates_across_same_type_slots(
    applications_env, monkeypatch
) -> None:
    bootstrap, _record = applications_env
    input_ids = [_add_input_signal(bootstrap), _add_input_signal(bootstrap)]
    recipe = RecipeDescriptor(
        recipe_id=f"{PLUGIN_ID}:compare",
        plugin_version="1.0.0",
        title="Compare inputs",
        version="1.0.0",
        run=_run_generic_recipe,
        inputs=(
            RecipeInputSlot(
                "left",
                RecipeObjectType.SIGNAL,
                RecipeCardinality.MANY,
            ),
            RecipeInputSlot(
                "right",
                RecipeObjectType.SIGNAL,
                RecipeCardinality.MANY,
            ),
        ),
    )
    monkeypatch.setattr(GenericApplicationPlugin, "RECIPES", (recipe,))

    prepared = dlw_applications.prepare_plugin_recipe(
        PLUGIN_ID,
        recipe.recipe_id,
        input_ids,
    )

    assert prepared["bindings"] == {"left": [], "right": []}
    assert prepared["ambiguous_slots"] == ["left", "right"]
    assert prepared["missing_slots"] == ["left", "right"]


def test_run_recipe_commits_outputs_result_diagnostic_and_provenance(
    applications_env,
) -> None:
    bootstrap, _record = applications_env
    input_id = _add_input_signal(bootstrap)

    committed = dlw_applications.run_plugin_recipe(
        PLUGIN_ID,
        RECIPE_ID,
        {"source": [input_id]},
        {"gain": 3.0},
    )

    outputs = {item["output_id"]: item for item in committed["objects"]}
    assert outputs["amplified"]["kind"] == "signal"
    assert outputs["summary"]["kind"] == "image"
    amplified = bootstrap._MODEL.get(outputs["amplified"]["id"])
    np.testing.assert_allclose(amplified.y, [3.0, 9.0])
    assert (
        bootstrap.list_signal_results(outputs["amplified"]["id"])[0]["title"]
        == "Generic metrics"
    )
    assert committed["diagnostics"] == [
        {
            "level": "info",
            "code": "generic-complete",
            "message": "Generic recipe completed",
            "details": {"gain": 3.0},
        }
    ]

    provenance = amplified.get_metadata_option(RECIPE_RUN_RECORD_OPTION)
    assert provenance["run_id"] == committed["run_id"]
    assert provenance["plugin_id"] == PLUGIN_ID
    assert provenance["recipe_id"] == RECIPE_ID
    assert provenance["datalab_version"] == "0.8.0"
    assert provenance["input_uuids"]["source"] == [
        bootstrap._object_uuid(bootstrap._MODEL.get(input_id))
    ]
    for output in outputs.values():
        obj = bootstrap._MODEL.get(output["id"])
        assert obj.get_metadata_option(RECIPE_RUN_RECORD_OPTION) == provenance


def test_run_recipe_rolls_back_cross_panel_commit(
    applications_env, monkeypatch
) -> None:
    bootstrap, _record = applications_env
    input_id = _add_input_signal(bootstrap)
    before = {kind: bootstrap._MODEL.panel_tree(kind) for kind in ("signal", "image")}
    original_add_object = bootstrap._MODEL.add_object
    call_count = 0

    def fail_on_second_output(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            raise RuntimeError("simulated generic commit failure")
        return original_add_object(*args, **kwargs)

    monkeypatch.setattr(bootstrap._MODEL, "add_object", fail_on_second_output)

    with pytest.raises(
        dlw_applications.RecipeCommitError,
        match="simulated generic commit failure",
    ):
        dlw_applications.run_plugin_recipe(
            PLUGIN_ID,
            RECIPE_ID,
            {"source": [input_id]},
        )

    assert {
        kind: bootstrap._MODEL.panel_tree(kind) for kind in ("signal", "image")
    } == before


def test_recipe_rejects_wrong_object_type(applications_env) -> None:
    bootstrap, _record = applications_env
    image_id = bootstrap._MODEL.add_object(
        "image",
        create_image("Wrong type", np.ones((2, 2))),
    )

    with pytest.raises(RecipeValidationError, match="accepts only signal"):
        dlw_applications.run_plugin_recipe(
            PLUGIN_ID,
            RECIPE_ID,
            {"source": [image_id]},
        )


def test_recipe_rejects_unknown_parameter(applications_env) -> None:
    bootstrap, _record = applications_env
    input_id = _add_input_signal(bootstrap)

    with pytest.raises(RecipeValidationError, match="unknown_gain"):
        dlw_applications.run_plugin_recipe(
            PLUGIN_ID,
            RECIPE_ID,
            {"source": [input_id]},
            {"unknown_gain": 3.0},
        )


def test_recipe_rejects_output_aliasing_live_input(
    applications_env, monkeypatch
) -> None:
    bootstrap, _record = applications_env
    input_id = _add_input_signal(bootstrap)

    def return_input(inputs, _parameters, _context):
        return RecipeOutcome(
            objects=(RecipeObjectOutput("aliased", inputs["source"][0]),)
        )

    recipe = RecipeDescriptor(
        recipe_id=f"{PLUGIN_ID}:alias-input",
        plugin_version="1.0.0",
        title="Alias input",
        version="1.0.0",
        run=return_input,
        inputs=GENERIC_RECIPE.inputs,
    )
    monkeypatch.setattr(GenericApplicationPlugin, "RECIPES", (recipe,))
    before = bootstrap._MODEL.panel_tree("signal")

    with pytest.raises(RecipeValidationError, match="must not reuse"):
        dlw_applications.run_plugin_recipe(
            PLUGIN_ID,
            recipe.recipe_id,
            {"source": [input_id]},
        )

    assert bootstrap._MODEL.panel_tree("signal") == before


def test_disabled_plugin_cannot_prepare_or_run(applications_env) -> None:
    bootstrap, record = applications_env
    input_id = _add_input_signal(bootstrap)
    record.enabled = False
    record.instance = None

    with pytest.raises(RuntimeError, match="disabled"):
        dlw_applications.prepare_plugin_recipe(PLUGIN_ID, RECIPE_ID, [input_id])
    with pytest.raises(RuntimeError, match="disabled"):
        dlw_applications.run_plugin_recipe(
            PLUGIN_ID,
            RECIPE_ID,
            {"source": [input_id]},
        )


def test_open_example_returns_recipe_driven_navigation(
    applications_env, monkeypatch
) -> None:
    bootstrap, _record = applications_env
    calls = []

    class Resource:
        @staticmethod
        def read_bytes() -> bytes:
            return b"example workspace"

    class Example:
        id = "quickstart"
        resource_path = "examples/quickstart.h5"
        recipe_ids = (RECIPE_ID,)

        @staticmethod
        def resolve() -> Resource:
            return Resource()

    def get_example(_cls, example_id):
        assert example_id == "quickstart"
        return Example()

    def load_workspace(filename, data, *, replace=True):
        calls.append((filename, data, replace))
        _add_input_signal(bootstrap)
        return {"signals": 1, "images": 0, "groups": 1}

    monkeypatch.setattr(
        GenericApplicationPlugin,
        "get_example",
        classmethod(get_example),
    )
    monkeypatch.setattr(dlw_applications, "_WORKSPACE_LOADER", load_workspace)

    opened = dlw_applications.open_plugin_example(
        PLUGIN_ID,
        "quickstart",
        replace=False,
    )

    assert calls == [("quickstart.h5", b"example workspace", False)]
    assert opened["panel"] == "signal"
    assert opened["selected_ids"] == [opened["current_id"]]
    assert opened["filename"] == "quickstart.h5"
    assert opened["dirty"] is False
    assert opened["recipe_id"] == RECIPE_ID
    assert opened["recipe_ids"] == [RECIPE_ID]
    assert opened["parameter_values"] == {}
    with pytest.raises(RecipeValidationError, match="not designed for"):
        dlw_applications.open_plugin_example(
            PLUGIN_ID, "quickstart", replace=False, recipe_id=f"{PLUGIN_ID}:other"
        )


def test_open_generated_example_replaces_workspace_and_returns_defaults(
    applications_env, monkeypatch
) -> None:
    bootstrap, _record = applications_env
    _add_input_signal(bootstrap)

    class Example:
        id = "generated"
        title = "Generated campaign"
        resource = None
        recipe_ids = (RECIPE_ID,)

    generated = create_signal(
        "Generated input",
        np.asarray([0.0, 1.0]),
        np.asarray([2.0, 4.0]),
    )

    def get_example(_cls, example_id):
        assert example_id == "generated"
        return Example()

    def materialize(_cls, example_id):
        assert example_id == "generated"
        return PluginExampleData((generated,), {RECIPE_ID: {"gain": 4.0}})

    monkeypatch.setattr(
        GenericApplicationPlugin,
        "get_example",
        classmethod(get_example),
    )
    monkeypatch.setattr(
        GenericApplicationPlugin,
        "materialize_example",
        classmethod(materialize),
    )
    dlw_applications.install_host(
        bootstrap._MODEL,
        bootstrap._object_uuid,
        bootstrap.open_workspace_from_bytes,
        "0.8.0",
        bootstrap.reset_all,
    )

    opened = dlw_applications.open_plugin_example(
        PLUGIN_ID,
        "generated",
    )

    assert opened["signals"] == 1
    assert opened["images"] == 0
    assert opened["panel"] == "signal"
    assert opened["selected_ids"] == [opened["current_id"]]
    assert opened["filename"] is None
    assert opened["dirty"] is True
    assert opened["parameter_values"] == {RECIPE_ID: {"gain": 4.0}}
    assert [item["title"] for item in bootstrap.list_signals()] == ["Generated input"]


_SHUTTER = gds.ValueProp(True)


class GeneratorSettings(gds.DataSet):
    """Settings of the test signal generator."""

    amplitude = gds.FloatItem("Amplitude", default=1.0)
    count = gds.IntItem("Shots", default=3, min=1)
    shutter = gds.BoolItem("Shutter open", default=True).set_prop(
        "display", store=_SHUTTER
    )
    rate = gds.FloatItem("Rate", default=5.0).set_prop("display", active=_SHUTTER)


class SignalGenerator(PluginInstrument):
    """Instrument generating ramps."""

    live_interval_ms = 100

    def __init__(self) -> None:
        super().__init__(GeneratorSettings())

    def preview(self) -> InstrumentFrame:
        x = np.linspace(0.0, 1.0, 5)
        signal = create_signal("Live", x, self.settings.amplitude * x)
        return InstrumentFrame((signal,), "Live frame", (-1.0, 1.0))

    def acquire(self) -> InstrumentAcquisition:
        x = np.linspace(0.0, 1.0, 5)
        return InstrumentAcquisition(
            "Generator acquisition",
            [create_signal(f"Shot {i}", x, x * i) for i in range(self.settings.count)],
        )


TOOLS = (
    PluginTool(
        id="generator",
        title="Signal generator...",
        instrument="create_generator",
        object_type="signal",
    ),
    PluginTool(
        id="double",
        title="Double signals...",
        launcher="double_signals",
        object_type="signal",
        selection="at_least_one",
    ),
)


@pytest.fixture
def tools_env(applications_env, monkeypatch):
    """Give the managed application a launcher tool and an instrument tool."""
    bootstrap, record = applications_env
    monkeypatch.setattr(GenericApplicationPlugin, "TOOLS", TOOLS, raising=False)
    monkeypatch.setattr(
        GenericApplicationPlugin,
        "create_generator",
        lambda self: SignalGenerator(),
        raising=False,
    )

    async def double_signals(self):
        for obj in self.get_selected_objects():
            bootstrap.add_signal_from_arrays(f"2 x {obj.title}", obj.x, 2 * obj.y)

    monkeypatch.setattr(
        GenericApplicationPlugin, "double_signals", double_signals, raising=False
    )
    record.instance.main = object()
    dlw_applications.install_host(
        bootstrap._MODEL,
        bootstrap._object_uuid,
        bootstrap.open_workspace_from_bytes,
        "0.8.0",
        signal_payload=bootstrap._signal_data_payload,
        image_payload=bootstrap._image_data_payload,
    )
    return bootstrap, record


def test_tools_are_listed_in_plugin_records(tools_env) -> None:
    _bootstrap, record = tools_env
    assert dlw_plugins._record_payload(record)["tools"] == [
        {
            "id": "generator",
            "title": "Signal generator...",
            "description": "",
            "kind": "instrument",
            "object_type": "signal",
            "selection": "none",
        },
        {
            "id": "double",
            "title": "Double signals...",
            "description": "",
            "kind": "launcher",
            "object_type": "signal",
            "selection": "at_least_one",
        },
    ]


def test_launcher_tool_runs_on_the_selection(tools_env) -> None:
    bootstrap, record = tools_env
    input_id = _add_input_signal(bootstrap)

    with pytest.raises(ValueError, match="Select at least one signal"):
        asyncio.run(dlw_applications.launch_plugin_tool(PLUGIN_ID, "double"))
    added = asyncio.run(
        dlw_applications.launch_plugin_tool(PLUGIN_ID, "double", [input_id])
    )

    assert added["image"] == []
    (new_id,) = added["signal"]
    assert bootstrap._MODEL.get(new_id).title == "2 x Input"
    assert record.instance.get_selected_objects() == []
    with pytest.raises(ValueError, match="is an instrument"):
        asyncio.run(dlw_applications.launch_plugin_tool(PLUGIN_ID, "generator"))


def test_instrument_previews_acquires_and_resolves_active_settings(
    tools_env,
) -> None:
    bootstrap, record = tools_env

    opened = dlw_applications.open_plugin_instrument(PLUGIN_ID, "generator")
    assert opened["title"] == "Signal generator"
    assert opened["live_interval_ms"] == 100
    assert opened["settings"]["values"]["amplitude"] == 1.0

    frame = dlw_applications.preview_plugin_instrument(
        PLUGIN_ID, "generator", {"amplitude": 0.5}
    )
    assert frame["kind"] == "signals"
    assert frame["summary"] == "Live frame"
    assert frame["value_range"] == [-1.0, 1.0]
    (item,) = frame["items"]
    assert item["encoding"] == "f64"
    instrument = record.instance.get_instrument("generator")
    assert instrument.settings.amplitude == 0.5

    acquired = dlw_applications.acquire_plugin_instrument(
        PLUGIN_ID, "generator", {"count": 2}
    )
    assert acquired["panel"] == "signal"
    assert acquired["group_title"] == "Generator acquisition"
    group = next(
        group
        for group in bootstrap._MODEL.panel_tree("signal")["groups"]
        if group["gid"] == acquired["group_id"]
    )
    assert group["name"] == "Generator acquisition"
    assert [obj["id"] for obj in group["objects"]] == acquired["object_ids"]
    assert len(acquired["object_ids"]) == 2

    active = dlw_applications.resolve_plugin_instrument_active(
        PLUGIN_ID, "generator", {"shutter": False}
    )
    assert active["rate"] is False
    assert dlw_applications.resolve_plugin_instrument_active(
        PLUGIN_ID, "generator", {"shutter": True}
    )["rate"]
