# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Bridge to the explicitly bundled Camera characterization wheel."""

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
from datalab_camera_characterization.adapters.web import (
    DATALAB_WEB_VERSION,
    build_recipe_inputs,
    get_web_manifest,
    read_quickstart_bytes,
    run_relative_dn_recipe,
)
from datalab_camera_characterization.workflow import (
    RELATIVE_DN_RECIPE,
    CameraRecipeParameters,
)
from sigima.objects import ImageObj, SignalObj
from sigima.objects.scalar import GeometryResult, TableResult


class WorkspaceLoader(Protocol):
    """Byte-based workspace loader supplied by DataLab-Web bootstrap."""

    def __call__(
        self,
        filename: str,
        data: bytes,
        *,
        replace: bool = True,
    ) -> dict[str, Any]: ...


class RecipeModel(Protocol):
    """Object-model operations required for a transactional recipe commit."""

    def has(self, oid: str) -> bool: ...

    def get(self, oid: str) -> Any: ...

    def kind_of(self, oid: str) -> str: ...

    def add_object(self, kind: str, obj: Any, group_id: str | None = None) -> str: ...

    def delete_object(self, oid: str) -> None: ...

    def create_group(self, kind: str, name: str | None = None) -> str: ...

    def delete_group(self, kind: str, gid: str) -> None: ...


class CameraRecipeCommitError(RuntimeError):
    """Raised after a failed Camera output commit has been rolled back."""


_WORKSPACE_LOADER: WorkspaceLoader | None = globals().get("_WORKSPACE_LOADER")
_RECIPE_MODEL: RecipeModel | None = globals().get("_RECIPE_MODEL")
_OBJECT_UUID: Callable[[Any], str | None] | None = globals().get("_OBJECT_UUID")


def install_workspace_loader(loader: WorkspaceLoader) -> None:
    """Install DataLab-Web's existing byte-based HDF5 workspace loader."""
    global _WORKSPACE_LOADER
    if not callable(loader):
        raise TypeError("Camera workspace loader must be callable")
    _WORKSPACE_LOADER = loader


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
        raise TypeError("Camera recipe host must implement the object-model contract")
    if not callable(object_uuid):
        raise TypeError("Camera recipe UUID accessor must be callable")
    _RECIPE_MODEL = model
    _OBJECT_UUID = object_uuid


def get_bundled_camera_manifest() -> dict[str, str]:
    """Return the bundled plugin's explicit browser compatibility manifest."""
    return get_web_manifest()


def open_bundled_camera_quickstart(replace: bool = True) -> dict[str, Any]:
    """Load the packaged Camera workspace through the browser byte I/O path."""
    if _WORKSPACE_LOADER is None:
        raise RuntimeError("Camera workspace loader is not installed")
    manifest = get_web_manifest()
    return _WORKSPACE_LOADER(
        manifest["quickstart_filename"],
        read_quickstart_bytes(),
        replace=replace,
    )


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
        raise RecipeValidationError("Camera recipe parameters must be a mapping")
    return dict(parameter_values)


def _parameters_for_record(values: Mapping[str, object]) -> CameraRecipeParameters:
    """Rebuild the exact DataSet used by the Web adapter for provenance."""
    parameters = CameraRecipeParameters()
    for name, value in values.items():
        if not isinstance(name, str) or not hasattr(parameters, name):
            raise RecipeValidationError(f"Unknown Camera recipe parameter: {name!r}")
        setattr(parameters, name, value)
    return parameters


def _result_metadata_key(result: TableResult | GeometryResult) -> str:
    """Return the DataLab-compatible metadata key for one scalar result."""
    func_name = getattr(result, "func_name", None) or "result"
    if isinstance(result, GeometryResult):
        return f"Geometry_{func_name}_dict"
    return f"Table_{func_name}_dict"


def _output_kind(value: SignalObj | ImageObj) -> str:
    """Return the DataLab-Web panel kind for one recipe output."""
    return "signal" if isinstance(value, SignalObj) else "image"


def run_bundled_camera_recipe(
    image_ids: Sequence[str],
    parameter_values: Mapping[str, object] | None = None,
) -> dict[str, Any]:
    """Execute and transactionally commit Camera outputs to both panels."""
    if _RECIPE_MODEL is None or _OBJECT_UUID is None:
        raise RuntimeError("Camera recipe host is not installed")
    if hasattr(image_ids, "to_py"):
        image_ids = image_ids.to_py()
    if isinstance(image_ids, (str, bytes)) or not isinstance(image_ids, Sequence):
        raise RecipeValidationError("Camera recipe image IDs must be a sequence")
    normalized_ids = tuple(image_ids)
    if not normalized_ids:
        raise RecipeValidationError("Camera recipe requires selected images")
    if any(
        not isinstance(oid, str) or not _RECIPE_MODEL.has(oid) for oid in normalized_ids
    ):
        raise RecipeValidationError("Camera recipe references an unknown object")
    if any(_RECIPE_MODEL.kind_of(oid) != "image" for oid in normalized_ids):
        raise RecipeValidationError("Camera recipe accepts only image objects")

    images = tuple(_RECIPE_MODEL.get(oid) for oid in normalized_ids)
    values = _parameter_values(parameter_values)
    parameters = _parameters_for_record(values)
    inputs = build_recipe_inputs(images)
    started_at = _utc_now()
    outcome = run_relative_dn_recipe(images, values)

    added_objects: list[tuple[str, str]] = []
    added_groups: list[tuple[str, str]] = []
    groups_by_kind: dict[str, str] = {}
    committed_by_output: dict[str, tuple[str, SignalObj | ImageObj]] = {}
    committed_results: list[dict[str, str]] = []
    try:
        for output in outcome.objects:
            kind = _output_kind(output.value)
            if kind not in groups_by_kind:
                gid = _RECIPE_MODEL.create_group(kind, RELATIVE_DN_RECIPE.title)
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
            func_name = f"{RELATIVE_DN_RECIPE.recipe_id}:{result_output.id}"
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
            plugin_id=RELATIVE_DN_RECIPE.plugin_id,
            plugin_version=RELATIVE_DN_RECIPE.plugin_version,
            recipe_id=RELATIVE_DN_RECIPE.recipe_id,
            recipe_version=RELATIVE_DN_RECIPE.version,
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
        raise CameraRecipeCommitError(str(exc)) from exc

    return {
        "recipe_id": RELATIVE_DN_RECIPE.recipe_id,
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
    "CameraRecipeCommitError",
    "get_bundled_camera_manifest",
    "install_recipe_host",
    "install_workspace_loader",
    "open_bundled_camera_quickstart",
    "run_bundled_camera_recipe",
]
