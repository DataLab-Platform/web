# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Bridge to the explicitly bundled Pulse characterization wheel."""

from __future__ import annotations

import dataclasses
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timezone
from typing import Any, Protocol
from uuid import uuid4

import guidata.dataset as gds
import sigima
from datalab.recipes import (
    RECIPE_RUN_RECORD_OPTION,
    RecipeRunRecord,
    RecipeRunStatus,
    RecipeValidationError,
)
from datalab_pulse_characterization.adapters.web import (
    DATALAB_WEB_VERSION,
    build_recipe_inputs,
    build_simulated_campaign,
    get_web_manifest,
    run_pulse_campaign_recipe,
)
from datalab_pulse_characterization.workflow import (
    PULSE_CAMPAIGN_RECIPE,
    PulseCampaignRecipeParameters,
)
from sigima.objects import SignalObj
from sigima.objects.scalar import GeometryResult, TableResult


class RecipeModel(Protocol):
    """Object-model operations required for transactional Pulse commits."""

    def has(self, oid: str) -> bool: ...

    def get(self, oid: str) -> Any: ...

    def kind_of(self, oid: str) -> str: ...

    def add_object(self, kind: str, obj: Any, group_id: str | None = None) -> str: ...

    def delete_object(self, oid: str) -> None: ...

    def create_group(self, kind: str, name: str | None = None) -> str: ...

    def delete_group(self, kind: str, gid: str) -> None: ...


class PulseRecipeCommitError(RuntimeError):
    """Raised after a failed Pulse model commit has been rolled back."""


_RECIPE_MODEL: RecipeModel | None = globals().get("_RECIPE_MODEL")
_OBJECT_UUID: Callable[[Any], str | None] | None = globals().get("_OBJECT_UUID")


def install_recipe_host(
    model: RecipeModel,
    object_uuid: Callable[[Any], str | None],
) -> None:
    """Install the DataLab-Web model and persistent-UUID accessor."""
    global _OBJECT_UUID, _RECIPE_MODEL
    required_methods = (
        "has",
        "get",
        "kind_of",
        "add_object",
        "delete_object",
        "create_group",
        "delete_group",
    )
    if any(not callable(getattr(model, name, None)) for name in required_methods):
        raise TypeError("Pulse recipe host must implement the object-model contract")
    if not callable(object_uuid):
        raise TypeError("Pulse recipe UUID accessor must be callable")
    _RECIPE_MODEL = model
    _OBJECT_UUID = object_uuid


def get_bundled_pulse_manifest() -> dict[str, str]:
    """Return the bundled plugin's explicit browser compatibility manifest."""
    return get_web_manifest()


def _utc_now() -> str:
    """Return the current UTC time in ISO 8601 form."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")  # noqa: UP017


def _parameter_values(
    parameter_values: Mapping[str, object] | None,
) -> dict[str, object]:
    """Normalize a JS/Python parameter mapping."""
    if hasattr(parameter_values, "to_py"):
        parameter_values = parameter_values.to_py()
    if parameter_values is None:
        return {}
    if not isinstance(parameter_values, Mapping):
        raise RecipeValidationError("Pulse recipe parameters must be a mapping")
    return dict(parameter_values)


def _parameters_for_record(
    values: Mapping[str, object],
) -> PulseCampaignRecipeParameters:
    """Rebuild the exact DataSet used by the Web adapter for provenance."""
    parameters = PulseCampaignRecipeParameters()
    for name, value in values.items():
        if not isinstance(name, str) or not hasattr(parameters, name):
            raise RecipeValidationError(f"Unknown Pulse recipe parameter: {name!r}")
        setattr(parameters, name, value)
    return parameters


def _result_metadata_key(result: TableResult | GeometryResult) -> str:
    """Return the DataLab-compatible metadata key for one scalar result."""
    func_name = getattr(result, "func_name", None) or "result"
    if isinstance(result, GeometryResult):
        return f"Geometry_{func_name}_dict"
    return f"Table_{func_name}_dict"


def _output_kind(value: object) -> str:
    """Return the DataLab-Web panel kind for one recipe output."""
    if not isinstance(value, SignalObj):
        raise TypeError(f"Unexpected Pulse output type: {type(value).__name__}")
    return "signal"


def create_bundled_pulse_demo() -> dict[str, Any]:
    """Create the deterministic 500-shot campaign in one model transaction."""
    if _RECIPE_MODEL is None:
        raise RuntimeError("Pulse recipe host is not installed")
    signals, parameter_values = build_simulated_campaign()
    added_objects: list[str] = []
    group_id: str | None = None
    try:
        group_id = _RECIPE_MODEL.create_group("signal", "Synthetic pulse campaign")
        for signal in signals:
            added_objects.append(
                _RECIPE_MODEL.add_object("signal", signal, group_id=group_id)
            )
    except Exception as exc:
        for oid in reversed(added_objects):
            _RECIPE_MODEL.delete_object(oid)
        if group_id is not None:
            _RECIPE_MODEL.delete_group("signal", group_id)
        raise PulseRecipeCommitError(str(exc)) from exc
    return {
        "signal_ids": added_objects,
        "signal_count": len(added_objects),
        "parameter_values": parameter_values,
    }


def run_bundled_pulse_recipe(
    signal_ids: Sequence[str],
    parameter_values: Mapping[str, object] | None = None,
) -> dict[str, Any]:
    """Execute and transactionally commit Pulse outputs to the signal panel."""
    if _RECIPE_MODEL is None or _OBJECT_UUID is None:
        raise RuntimeError("Pulse recipe host is not installed")
    if hasattr(signal_ids, "to_py"):
        signal_ids = signal_ids.to_py()
    if isinstance(signal_ids, (str, bytes)) or not isinstance(signal_ids, Sequence):
        raise RecipeValidationError("Pulse recipe signal IDs must be a sequence")
    normalized_ids = tuple(signal_ids)
    if len(normalized_ids) < 2:
        raise RecipeValidationError("Pulse recipe requires at least two signals")
    if any(
        not isinstance(oid, str) or not _RECIPE_MODEL.has(oid) for oid in normalized_ids
    ):
        raise RecipeValidationError("Pulse recipe references an unknown object")
    if any(_RECIPE_MODEL.kind_of(oid) != "signal" for oid in normalized_ids):
        raise RecipeValidationError("Pulse recipe accepts only signal objects")

    signals = tuple(_RECIPE_MODEL.get(oid) for oid in normalized_ids)
    values = _parameter_values(parameter_values)
    parameters = _parameters_for_record(values)
    inputs = build_recipe_inputs(signals)
    started_at = _utc_now()
    outcome = run_pulse_campaign_recipe(signals, values)

    added_objects: list[tuple[str, str]] = []
    added_groups: list[tuple[str, str]] = []
    groups_by_kind: dict[str, str] = {}
    committed_by_output: dict[str, tuple[str, SignalObj]] = {}
    committed_results: list[dict[str, str]] = []
    try:
        for output in outcome.objects:
            kind = _output_kind(output.value)
            if kind not in groups_by_kind:
                gid = _RECIPE_MODEL.create_group(kind, PULSE_CAMPAIGN_RECIPE.title)
                groups_by_kind[kind] = gid
                added_groups.append((kind, gid))
        for output in outcome.objects:
            kind = _output_kind(output.value)
            oid = _RECIPE_MODEL.add_object(
                kind,
                output.value,
                group_id=groups_by_kind[kind],
            )
            added_objects.append((kind, oid))
            committed_by_output[output.id] = (oid, output.value)

        for result_output in outcome.results:
            func_name = f"{PULSE_CAMPAIGN_RECIPE.recipe_id}:{result_output.id}"
            result = dataclasses.replace(
                result_output.value,
                func_name=func_name,
                attrs=dict(result_output.value.attrs),
            )
            anchor_oid, anchor = committed_by_output[result_output.anchor_id]
            metadata_key = _result_metadata_key(result)
            anchor.metadata[metadata_key] = result.to_dict()
            committed_results.append(
                {
                    "output_id": result_output.id,
                    "anchor_output_id": result_output.anchor_id,
                    "anchor_id": anchor_oid,
                    "metadata_key": metadata_key,
                }
            )

        run_id = str(uuid4())
        record = RecipeRunRecord(
            run_id=run_id,
            plugin_id=PULSE_CAMPAIGN_RECIPE.plugin_id,
            plugin_version=PULSE_CAMPAIGN_RECIPE.plugin_version,
            recipe_id=PULSE_CAMPAIGN_RECIPE.recipe_id,
            recipe_version=PULSE_CAMPAIGN_RECIPE.version,
            parameters_json=gds.dataset_to_json(parameters),
            input_uuids={
                slot_id: tuple(_OBJECT_UUID(obj) for obj in objects)
                for slot_id, objects in inputs.items()
            },
            output_uuids={
                output_id: _OBJECT_UUID(value)
                for output_id, (_oid, value) in committed_by_output.items()
            },
            datalab_version=DATALAB_WEB_VERSION,
            sigima_version=sigima.__version__,
            status=RecipeRunStatus.COMPLETED,
            started_at=started_at,
            finished_at=_utc_now(),
        )
        for _oid, output in committed_by_output.values():
            output.set_metadata_option(RECIPE_RUN_RECORD_OPTION, record.to_dict())
    except Exception as exc:
        for _kind, oid in reversed(added_objects):
            _RECIPE_MODEL.delete_object(oid)
        for kind, gid in reversed(added_groups):
            _RECIPE_MODEL.delete_group(kind, gid)
        raise PulseRecipeCommitError(str(exc)) from exc

    return {
        "recipe_id": PULSE_CAMPAIGN_RECIPE.recipe_id,
        "run_id": run_id,
        "objects": [
            {
                "output_id": output.id,
                "id": committed_by_output[output.id][0],
                "kind": _output_kind(output.value),
                "title": output.value.title,
            }
            for output in outcome.objects
        ],
        "results": committed_results,
        "diagnostics": [
            {
                "level": (
                    diagnostic.level.value
                    if hasattr(diagnostic.level, "value")
                    else diagnostic.level
                ),
                "code": diagnostic.code,
                "message": diagnostic.message,
                "details": dict(diagnostic.details),
            }
            for diagnostic in outcome.diagnostics
        ],
    }


__all__ = [
    "PulseRecipeCommitError",
    "create_bundled_pulse_demo",
    "get_bundled_pulse_manifest",
    "install_recipe_host",
    "run_bundled_pulse_recipe",
]
