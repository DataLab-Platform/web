# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Generic DataLab-Web host for plugin recipes and packaged examples."""

from __future__ import annotations

import dataclasses
import json
import os
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import uuid4

import dlw_plugins
import guidata.dataset as gds
import sigima
from datalab.plugin_examples import PluginExampleData
from datalab.recipes import (
    RECIPE_RUN_RECORD_OPTION,
    RecipeCardinality,
    RecipeDescriptor,
    RecipeExecutionContext,
    RecipeRunRecord,
    RecipeRunStatus,
    RecipeValidationError,
)
from sigima.objects import ImageObj, SignalObj
from sigima.objects.scalar import GeometryResult, TableResult


class ApplicationModel(Protocol):
    """Object-model operations required by recipe execution."""

    def has(self, oid: str) -> bool: ...

    def get(self, oid: str) -> Any: ...

    def kind_of(self, oid: str) -> str: ...

    def add_object(self, kind: str, obj: Any, group_id: str | None = None) -> str: ...

    def delete_object(self, oid: str) -> None: ...

    def create_group(self, kind: str, name: str | None = None) -> str: ...

    def delete_group(self, kind: str, gid: str) -> None: ...

    def panel_tree(self, kind: str) -> dict[str, Any]: ...


class WorkspaceLoader(Protocol):
    """Byte-based HDF5 workspace loader supplied by bootstrap."""

    def __call__(
        self,
        filename: str,
        data: bytes,
        *,
        replace: bool = True,
    ) -> dict[str, Any]: ...


class RecipeCommitError(RuntimeError):
    """Raised after a generic recipe commit has been rolled back."""


_MODEL: ApplicationModel | None = globals().get("_MODEL")
_OBJECT_UUID: Callable[[Any], str | None] | None = globals().get("_OBJECT_UUID")
_WORKSPACE_LOADER: WorkspaceLoader | None = globals().get("_WORKSPACE_LOADER")
_RESET_WORKSPACE: Callable[[], None] | None = globals().get("_RESET_WORKSPACE")
_DATALAB_WEB_VERSION: str = globals().get("_DATALAB_WEB_VERSION", "0.0.0")


def install_host(
    model: ApplicationModel,
    object_uuid: Callable[[Any], str | None],
    workspace_loader: WorkspaceLoader,
    datalab_web_version: str,
    reset_workspace: Callable[[], None] | None = None,
) -> None:
    """Install the live model, UUID accessor, workspace loader, and version."""
    global _DATALAB_WEB_VERSION, _MODEL, _OBJECT_UUID, _RESET_WORKSPACE
    global _WORKSPACE_LOADER
    required_methods = (
        "has",
        "get",
        "kind_of",
        "add_object",
        "delete_object",
        "create_group",
        "delete_group",
        "panel_tree",
    )
    if any(not callable(getattr(model, name, None)) for name in required_methods):
        raise TypeError("Application host must implement the object-model contract")
    if not callable(object_uuid) or not callable(workspace_loader):
        raise TypeError("Application host accessors must be callable")
    if not isinstance(datalab_web_version, str) or not datalab_web_version:
        raise ValueError("DataLab-Web version must be non-empty")
    _MODEL = model
    _OBJECT_UUID = object_uuid
    _WORKSPACE_LOADER = workspace_loader
    _RESET_WORKSPACE = reset_workspace
    _DATALAB_WEB_VERSION = datalab_web_version


def _require_host() -> tuple[ApplicationModel, Callable[[Any], str | None]]:
    if _MODEL is None or _OBJECT_UUID is None:
        raise RuntimeError("Plugin application host is not installed")
    return _MODEL, _OBJECT_UUID


def _plugin_class(plugin_id: str) -> type:
    return dlw_plugins.get_plugin_class(plugin_id, require_enabled=True)


def _recipe(plugin_id: str, recipe_id: str) -> RecipeDescriptor:
    plugin_cls = _plugin_class(plugin_id)
    for descriptor in plugin_cls.get_recipes():
        if descriptor.recipe_id == recipe_id:
            return descriptor
    raise KeyError(f"Unknown recipe {recipe_id!r} for plugin {plugin_id!r}")


def _normalize_sequence(value: Any, field_name: str) -> tuple[Any, ...]:
    if hasattr(value, "to_py"):
        value = value.to_py()
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise RecipeValidationError(f"{field_name} must be a sequence")
    return tuple(value)


def _normalize_mapping(value: Any, field_name: str) -> dict[str, Any]:
    if hasattr(value, "to_py"):
        value = value.to_py()
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise RecipeValidationError(f"{field_name} must be a mapping")
    if not all(isinstance(key, str) for key in value):
        raise RecipeValidationError(f"{field_name} keys must be strings")
    return dict(value)


def _candidate_payload(oid: str, kind: str, title: str, slots: list[str]) -> dict:
    return {"id": oid, "kind": kind, "title": title, "compatible_slots": slots}


def prepare_plugin_recipe(
    plugin_id: str,
    recipe_id: str,
    candidate_ids: Sequence[str],
) -> dict[str, Any]:
    """Resolve compatible candidates and conservative initial slot bindings."""
    model, _object_uuid = _require_host()
    descriptor = _recipe(plugin_id, recipe_id)
    normalized_ids = _normalize_sequence(candidate_ids, "Recipe candidate IDs")
    if any(not isinstance(oid, str) or not model.has(oid) for oid in normalized_ids):
        raise RecipeValidationError("Recipe candidates reference an unknown object")

    candidates: list[tuple[str, Any]] = []
    payloads: list[dict[str, Any]] = []
    for oid in dict.fromkeys(normalized_ids):
        kind = model.kind_of(oid)
        compatible_slots = [
            slot.id for slot in descriptor.inputs if slot.object_type.value == kind
        ]
        if compatible_slots:
            obj = model.get(oid)
            candidates.append((oid, obj))
            payloads.append(_candidate_payload(oid, kind, obj.title, compatible_slots))

    suggested: dict[str, list[str]] = {}
    hook = getattr(_plugin_class(plugin_id), "suggest_recipe_bindings", None)
    if callable(hook):
        objects_to_ids = {id(obj): oid for oid, obj in candidates}
        raw_suggested = hook(descriptor, tuple(obj for _oid, obj in candidates))
        for slot_id, objects in _normalize_mapping(
            raw_suggested, "Suggested recipe bindings"
        ).items():
            suggested[slot_id] = []
            for obj in _normalize_sequence(objects, f"Binding {slot_id!r}"):
                oid = objects_to_ids.get(id(obj))
                if oid is None:
                    raise RecipeValidationError(
                        f"Binding suggestion {slot_id!r} references an object "
                        "outside the candidates"
                    )
                suggested[slot_id].append(oid)

    known_slots = {slot.id for slot in descriptor.inputs}
    unknown_suggestions = set(suggested).difference(known_slots)
    if unknown_suggestions:
        raise RecipeValidationError(
            "Binding suggestions reference unknown slots: "
            + ", ".join(sorted(unknown_suggestions))
        )

    bindings: dict[str, list[str]] = {}
    ambiguous: list[str] = []
    missing: list[str] = []
    for slot in descriptor.inputs:
        compatible = [
            candidate["id"]
            for candidate in payloads
            if slot.id in candidate["compatible_slots"]
        ]
        proposed = suggested.get(slot.id)
        if proposed is not None:
            bindings[slot.id] = proposed
        elif sum(
            candidate.object_type is slot.object_type for candidate in descriptor.inputs
        ) == 1 and (slot.cardinality is RecipeCardinality.MANY or len(compatible) == 1):
            bindings[slot.id] = compatible
        elif compatible:
            bindings[slot.id] = []
            ambiguous.append(slot.id)
        else:
            bindings[slot.id] = []
        if slot.required and not bindings[slot.id]:
            missing.append(slot.id)

    validated = _validate_bindings(descriptor, bindings, allow_missing=True)
    return {
        "plugin_id": plugin_id,
        "recipe_id": descriptor.recipe_id,
        "title": descriptor.title,
        "description": descriptor.description,
        "slots": [
            {
                "id": slot.id,
                "object_type": slot.object_type.value,
                "cardinality": slot.cardinality.value,
                "required": slot.required,
            }
            for slot in descriptor.inputs
        ],
        "candidates": payloads,
        "bindings": {
            slot_id: [oid for oid, _obj in objects]
            for slot_id, objects in validated.items()
        },
        "ambiguous_slots": ambiguous,
        "missing_slots": missing,
        "parameters": get_plugin_recipe_schema(plugin_id, recipe_id),
    }


def get_plugin_recipe_schema(plugin_id: str, recipe_id: str) -> dict[str, Any] | None:
    """Return the recipe parameter DataSet schema and defaults, if any."""
    descriptor = _recipe(plugin_id, recipe_id)
    if descriptor.parameter_class is None:
        return None
    from guidata.dataset import dataset_to_schema_with_values

    payload = dataset_to_schema_with_values(descriptor.parameter_class())
    payload["title"] = descriptor.title
    return payload


def resolve_plugin_recipe_active(
    plugin_id: str,
    recipe_id: str,
    values: Mapping[str, object] | None = None,
) -> dict[str, bool]:
    """Evaluate guidata display-active rules for recipe parameters."""
    descriptor = _recipe(plugin_id, recipe_id)
    if descriptor.parameter_class is None:
        return {}
    from guidata.dataset import resolve_dataset_active, update_dataset

    parameters = descriptor.parameter_class()
    normalized = _normalize_mapping(values, "Recipe parameters")
    if normalized:
        update_dataset(parameters, normalized)
    return resolve_dataset_active(parameters)


def resolve_plugin_recipe_choices(
    plugin_id: str,
    recipe_id: str,
    item_name: str,
    values: Mapping[str, object] | None = None,
) -> list[dict[str, Any]]:
    """Resolve a dynamic ChoiceItem for recipe parameters."""
    descriptor = _recipe(plugin_id, recipe_id)
    if descriptor.parameter_class is None:
        raise ValueError(f"Recipe {recipe_id!r} has no parameters")
    from guidata.dataset import resolve_dynamic_choices, update_dataset

    parameters = descriptor.parameter_class()
    normalized = _normalize_mapping(values, "Recipe parameters")
    if normalized:
        update_dataset(parameters, normalized)
    return resolve_dynamic_choices(parameters, item_name)


def resolve_plugin_recipe_callbacks(
    plugin_id: str,
    recipe_id: str,
    item_name: str,
    values: Mapping[str, object] | None = None,
) -> dict[str, Any]:
    """Run a recipe parameter display callback and return updated values."""
    descriptor = _recipe(plugin_id, recipe_id)
    if descriptor.parameter_class is None:
        raise ValueError(f"Recipe {recipe_id!r} has no parameters")
    from guidata.dataset import resolve_dataset_callbacks, update_dataset

    parameters = descriptor.parameter_class()
    normalized = _normalize_mapping(values, "Recipe parameters")
    if normalized:
        update_dataset(parameters, normalized)
    return resolve_dataset_callbacks(parameters, item_name)


def _validate_bindings(
    descriptor: RecipeDescriptor,
    bindings: Mapping[str, Sequence[str]],
    *,
    allow_missing: bool = False,
) -> dict[str, tuple[tuple[str, Any], ...]]:
    model, _object_uuid = _require_host()
    normalized = _normalize_mapping(bindings, "Recipe bindings")
    known_slots = {slot.id for slot in descriptor.inputs}
    unknown_slots = set(normalized).difference(known_slots)
    if unknown_slots:
        raise RecipeValidationError(
            "Unknown recipe input slots: " + ", ".join(sorted(unknown_slots))
        )
    resolved: dict[str, tuple[tuple[str, Any], ...]] = {}
    for slot in descriptor.inputs:
        oids = _normalize_sequence(
            normalized.get(slot.id, ()), f"Recipe binding {slot.id!r}"
        )
        if len(oids) != len(set(oids)):
            raise RecipeValidationError(
                f"Recipe binding {slot.id!r} contains duplicate objects"
            )
        if slot.cardinality is RecipeCardinality.ONE and len(oids) > 1:
            raise RecipeValidationError(
                f"Recipe input {slot.id!r} accepts exactly one object"
            )
        if slot.required and not oids and not allow_missing:
            raise RecipeValidationError(f"Recipe input {slot.id!r} is required")
        values: list[tuple[str, Any]] = []
        for oid in oids:
            if not isinstance(oid, str) or not model.has(oid):
                raise RecipeValidationError(
                    f"Recipe input {slot.id!r} references an unknown object"
                )
            kind = model.kind_of(oid)
            if kind != slot.object_type.value:
                raise RecipeValidationError(
                    f"Recipe input {slot.id!r} accepts only "
                    f"{slot.object_type.value} objects"
                )
            values.append((oid, model.get(oid)))
        resolved[slot.id] = tuple(values)
    return resolved


def _parameters(
    descriptor: RecipeDescriptor,
    parameter_values: Mapping[str, object] | None,
) -> gds.DataSet | None:
    values = _normalize_mapping(parameter_values, "Recipe parameters")
    if descriptor.parameter_class is None:
        if values:
            raise RecipeValidationError("This recipe does not accept parameters")
        return None
    from guidata.dataset import update_dataset

    parameters = descriptor.parameter_class()
    unknown_values = set(values).difference(
        item.get_name() for item in parameters.get_items()
    )
    if unknown_values:
        raise RecipeValidationError(
            "Unknown recipe parameters: " + ", ".join(sorted(unknown_values))
        )
    if values:
        update_dataset(parameters, values)
    return parameters


def _utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _output_kind(value: SignalObj | ImageObj) -> str:
    return "signal" if isinstance(value, SignalObj) else "image"


def _result_metadata_key(result: TableResult | GeometryResult) -> str:
    func_name = getattr(result, "func_name", None) or "result"
    if isinstance(result, GeometryResult):
        return f"Geometry_{func_name}_dict"
    return f"Table_{func_name}_dict"


def run_plugin_recipe(
    plugin_id: str,
    recipe_id: str,
    bindings: Mapping[str, Sequence[str]],
    parameter_values: Mapping[str, object] | None = None,
) -> dict[str, Any]:
    """Execute one descriptor and transactionally commit its complete outcome."""
    model, object_uuid = _require_host()
    descriptor = _recipe(plugin_id, recipe_id)
    resolved = _validate_bindings(descriptor, bindings)
    inputs = {
        slot_id: tuple(obj for _oid, obj in values)
        for slot_id, values in resolved.items()
    }
    input_uuids: dict[str, tuple[str, ...]] = {}
    for slot_id, values in resolved.items():
        uuids = tuple(object_uuid(obj) for _oid, obj in values)
        if any(value is None for value in uuids):
            raise RecipeValidationError("Recipe inputs require persistent UUIDs")
        input_uuids[slot_id] = tuple(value for value in uuids if value is not None)
    parameters = _parameters(descriptor, parameter_values)
    started_at = _utc_now()
    outcome = descriptor.run(inputs, parameters, RecipeExecutionContext())
    input_object_ids = {id(obj) for values in inputs.values() for obj in values}
    if any(id(output.value) in input_object_ids for output in outcome.objects):
        raise RecipeValidationError(
            "Recipe object outputs must not reuse live input objects"
        )

    added_objects: list[tuple[str, str]] = []
    added_groups: list[tuple[str, str]] = []
    groups_by_kind: dict[str, str] = {}
    committed_by_output: dict[str, tuple[str, SignalObj | ImageObj]] = {}
    committed_results: list[dict[str, str]] = []
    try:
        for output in outcome.objects:
            kind = _output_kind(output.value)
            if kind not in groups_by_kind:
                group_id = model.create_group(kind, descriptor.title)
                groups_by_kind[kind] = group_id
                added_groups.append((kind, group_id))
        for output in outcome.objects:
            kind = _output_kind(output.value)
            oid = model.add_object(
                kind,
                output.value,
                group_id=groups_by_kind[kind],
            )
            added_objects.append((kind, oid))
            committed_by_output[output.id] = (oid, output.value)

        for result_output in outcome.results:
            result = dataclasses.replace(
                result_output.value,
                func_name=f"{descriptor.recipe_id}:{result_output.id}",
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

        output_uuids = {
            output_id: object_uuid(value)
            for output_id, (_oid, value) in committed_by_output.items()
        }
        if any(value is None for value in output_uuids.values()):
            raise RecipeValidationError("Recipe outputs require persistent UUIDs")
        run_id = str(uuid4())
        run_record = RecipeRunRecord(
            run_id=run_id,
            plugin_id=descriptor.plugin_id,
            plugin_version=descriptor.plugin_version,
            recipe_id=descriptor.recipe_id,
            recipe_version=descriptor.version,
            parameters_json=(
                gds.dataset_to_json(parameters)
                if parameters is not None
                else json.dumps({})
            ),
            input_uuids=input_uuids,
            output_uuids={
                key: value for key, value in output_uuids.items() if value is not None
            },
            datalab_version=_DATALAB_WEB_VERSION,
            sigima_version=sigima.__version__,
            status=RecipeRunStatus.COMPLETED,
            started_at=started_at,
            finished_at=_utc_now(),
        )
        for _oid, output in committed_by_output.values():
            output.set_metadata_option(RECIPE_RUN_RECORD_OPTION, run_record.to_dict())
    except Exception as exc:
        for _kind, oid in reversed(added_objects):
            model.delete_object(oid)
        for kind, group_id in reversed(added_groups):
            model.delete_group(kind, group_id)
        raise RecipeCommitError(str(exc)) from exc

    return {
        "plugin_id": plugin_id,
        "recipe_id": descriptor.recipe_id,
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
                "level": diagnostic.level.value,
                "code": diagnostic.code,
                "message": diagnostic.message,
                "details": dict(diagnostic.details),
            }
            for diagnostic in outcome.diagnostics
        ],
    }


def open_plugin_example(
    plugin_id: str,
    example_id: str,
    replace: bool = True,
) -> dict[str, Any]:
    """Open one packaged or generated example through the generic host."""
    model, _object_uuid = _require_host()
    plugin_cls = _plugin_class(plugin_id)
    example = plugin_cls.get_example(example_id)
    before_ids = {
        kind: [
            obj["id"]
            for group in model.panel_tree(kind)["groups"]
            for obj in group["objects"]
        ]
        for kind in ("signal", "image")
    }
    materialized = plugin_cls.materialize_example(example_id)
    parameter_values: dict[str, object] = {}
    filename: str | None = None
    dirty = False
    if materialized is not None:
        if not isinstance(materialized, PluginExampleData):
            raise TypeError(
                "Plugin example materializer must return PluginExampleData or None"
            )
        if len({id(obj) for obj in materialized.objects}) != len(materialized.objects):
            raise ValueError("Generated plugin example objects must be distinct")
        if replace:
            if _RESET_WORKSPACE is None:
                raise RuntimeError("Plugin application reset hook is not installed")
            _RESET_WORKSPACE()
        added_objects: list[tuple[str, str]] = []
        added_groups: list[tuple[str, str]] = []
        groups_by_kind: dict[str, str] = {}
        try:
            for obj in materialized.objects:
                kind = _output_kind(obj)
                if kind not in groups_by_kind:
                    group_id = model.create_group(kind, example.title)
                    groups_by_kind[kind] = group_id
                    added_groups.append((kind, group_id))
                oid = model.add_object(kind, obj, groups_by_kind[kind])
                added_objects.append((kind, oid))
        except Exception as exc:
            for _kind, oid in reversed(added_objects):
                model.delete_object(oid)
            for kind, group_id in reversed(added_groups):
                model.delete_group(kind, group_id)
            raise RecipeCommitError(str(exc)) from exc
        result = {
            "signals": sum(kind == "signal" for kind, _oid in added_objects),
            "images": sum(kind == "image" for kind, _oid in added_objects),
            "groups": len(added_groups),
        }
        selected_by_kind = {
            kind: [oid for object_kind, oid in added_objects if object_kind == kind]
            for kind in ("signal", "image")
        }
        parameter_values = dict(materialized.parameter_values)
        dirty = True
    else:
        if _WORKSPACE_LOADER is None:
            raise RuntimeError("Plugin application workspace loader is not installed")
        resource = example.resolve()
        data = resource.read_bytes()
        filename = os.path.basename(example.resource_path)
        result = _WORKSPACE_LOADER(filename, data, replace=replace)
        after_ids = {
            kind: [
                obj["id"]
                for group in model.panel_tree(kind)["groups"]
                for obj in group["objects"]
            ]
            for kind in ("signal", "image")
        }
        selected_by_kind = {
            kind: (
                ids if replace else [oid for oid in ids if oid not in before_ids[kind]]
            )
            for kind, ids in after_ids.items()
        }
    panel = next((kind for kind, ids in selected_by_kind.items() if ids), None)
    if example.recipe_id is not None:
        descriptor = _recipe(plugin_id, example.recipe_id)
        panel = next(
            (
                slot.object_type.value
                for slot in descriptor.inputs
                if selected_by_kind[slot.object_type.value]
            ),
            panel,
        )
    selected_ids = selected_by_kind[panel] if panel is not None else []
    return {
        **result,
        "plugin_id": plugin_id,
        "example_id": example.id,
        "recipe_id": example.recipe_id,
        "filename": filename,
        "panel": panel,
        "selected_ids": selected_ids,
        "current_id": selected_ids[-1] if selected_ids else None,
        "dirty": dirty,
        "parameter_values": parameter_values,
    }


__all__ = [
    "RecipeCommitError",
    "get_plugin_recipe_schema",
    "install_host",
    "open_plugin_example",
    "prepare_plugin_recipe",
    "resolve_plugin_recipe_active",
    "resolve_plugin_recipe_callbacks",
    "resolve_plugin_recipe_choices",
    "run_plugin_recipe",
]
