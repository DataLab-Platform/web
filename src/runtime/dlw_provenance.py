# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

"""
Workspace provenance for DataLab-Web.

Records the signal and image processing (1-to-1, 2-to-1, n-to-1 and analyses) in
a workspace-level ledger, prepares
recorded activities for replay and verifies them against their stored result.
The ledger model, fingerprints, preparation and reports come from DataLab-Capsule;
operation contracts come from Sigima. Only qualified operations can be replayed.

DataLab-Capsule is optional in the browser: without it, processing is unchanged
and provenance reports itself as unavailable. Capture never breaks processing: a
failure keeps the result, records nothing and is logged and counted. Spilled
(on-disk) objects are never fingerprinted.
"""

from __future__ import annotations

import dataclasses
import logging
import uuid
from collections.abc import Callable, Sequence
from importlib import metadata
from typing import Any

try:
    from datalab_capsule.archive import SizePolicy, create_from_hdf5, read_capsule
    from datalab_capsule.calls import make_call
    from datalab_capsule.compare import (
        build_report,
        compare_environments,
        compare_exact,
    )
    from datalab_capsule.environment import collect_environment, environment_id
    from datalab_capsule.hdf5 import load_ledger, save_ledger
    from datalab_capsule.integrity import state_facts
    from datalab_capsule.ledger import Ledger, utc_timestamp
    from datalab_capsule.replay import IneligibleError, Plan, prepare_activity

    UNAVAILABLE_REASON: str | None = None
except ImportError as _exc:  # pragma: no cover - depends on the boot install
    UNAVAILABLE_REASON = f"DataLab-Capsule is not installed ({_exc})"

try:
    from sigima.proc import contracts as _contracts
except ImportError:  # pragma: no cover - released Sigima without contracts
    _contracts = None

from sigima.objects import ImageObj, SignalObj

_logger = logging.getLogger(__name__)

EDITION = "web"
#: Default roles of unqualified calls, by number of inputs.
OPAQUE_ROLES = {1: ("source",), 2: ("source", "operand")}

#: Largest capsule (archive and workspace, bytes) opened in the browser. Opening
#: one grows the WebAssembly heap by about 3.5 times its size (Pyodide 0.26.4 in
#: Chromium: +841 MiB for a 240 MiB capsule, heap then 1.1 GiB), and this 32-bit
#: heap cannot exceed 4 GiB. The TypeScript runtime checks the file size before
#: reading it.
CAPSULE_MAX_BYTES = 256 * 1024 * 1024
#: Largest manifest opened in the browser (bytes).
CAPSULE_MAX_MANIFEST_BYTES = 16 * 1024 * 1024


class ProvenanceResidencyError(RuntimeError):
    """Raised when an object's arrays are spilled to disk (not resident)."""


@dataclasses.dataclass
class PendingActivity:
    """An execution whose input states were recorded, awaiting its output."""

    call: dict[str, Any]
    implementation: dict[str, Any]
    limits: list[str]
    command_id: str | None
    origin: str
    started_at: str
    #: X-alignment record applied to the inputs, or None.
    x_alignment: dict[str, Any] | None = None


def implementation_of(func: Callable) -> dict[str, Any]:
    """Return the informative implementation descriptor of *func*.

    It is never resolved into a contract nor imported back.
    """
    module = getattr(func, "__module__", None) or ""
    package = module.split(".", 1)[0] or None
    try:
        version = metadata.version(package) if package else None
    except metadata.PackageNotFoundError:
        version = None
    qualname = getattr(func, "__qualname__", getattr(func, "__name__", repr(func)))
    return {
        "package": package,
        "version": version,
        "python_name": f"{module}.{qualname}" if module else qualname,
    }


def signal_rows(obj: SignalObj) -> dict[str, Any]:
    """Return the rows compared by the ``exact`` rule."""
    rows = {"x": obj.x, "y": obj.y}
    if obj.dx is not None:
        rows["dx"] = obj.dx
    if obj.dy is not None:
        rows["dy"] = obj.dy
    return rows


class WebProvenance:
    """Workspace provenance ledger of DataLab-Web.

    Args:
        find_by_uuid: Object lookup by persistent UUID (None when absent).
        uuid_of: Persistent UUID of an object.
        is_spilled: True when an object's arrays live on disk.
    """

    def __init__(
        self,
        find_by_uuid: Callable[[str], Any],
        uuid_of: Callable[[Any], str | None],
        is_spilled: Callable[[Any], bool],
    ) -> None:
        self._find_by_uuid = find_by_uuid
        self._uuid_of = uuid_of
        self._is_spilled = is_spilled
        self.edition_version = "dev"
        self._environment: dict[str, Any] | None = None
        self.capture_failures = 0
        self.ledger = None if UNAVAILABLE_REASON else Ledger()
        self.state_status: dict[str, str] = {}
        self.notices: list[str] = []
        #: ``"loaded"`` or ``"absent"`` after opening a workspace file, else None.
        self.file_status: str | None = None

    @property
    def available(self) -> bool:
        """True when DataLab-Capsule is installed."""
        return self.ledger is not None

    # -- Workspace lifecycle ------------------------------------------------

    def reset(self) -> None:
        """Start an empty ledger for a new workspace."""
        if self.available:
            self.ledger = Ledger()
        self.state_status = {}
        self.notices = []
        self.file_status = None

    def save(self, h5file: Any) -> None:
        """Write the ledger block into a workspace file, after its panels."""
        if self.available:
            save_ledger(h5file, self.ledger)

    def read(self, h5file: Any) -> tuple[Any, dict[str, str]] | None:
        """Read and validate the block of a workspace file before anything changes.

        Returns:
            ``(ledger, state_status)``, or None without block or without
            DataLab-Capsule.

        Raises:
            ProvenanceFormatError: If the block is invalid.
        """
        return load_ledger(h5file) if self.available else None

    def load(self, block: tuple[Any, dict[str, str]] | None, replaced: bool) -> None:
        """Adopt the ledger read from a workspace file, after its objects.

        Args:
            block: Result of :meth:`read`.
            replaced: False when the file was appended to the current workspace:
             ledgers are not merged and the file's block is ignored.
        """
        if not self.available:
            return
        if not replaced:
            if block is not None:
                message = (
                    "Provenance import into an existing workspace is not supported yet"
                )
                _logger.warning(message)
                self.notices.append(message)
            return
        self.reset()
        if block is None:
            self.file_status = "absent"
            return
        self.ledger, self.state_status = block
        self.file_status = "loaded"

    def export_capsule(self, workspace: bytes, name: str | None = None) -> bytes:
        """Return the capsule of a saved workspace (``.dlcapsule`` bytes)."""
        if not self.available:
            raise RuntimeError(UNAVAILABLE_REASON)
        return create_from_hdf5(workspace, name=name)

    def open_capsule(self, data: bytes) -> bytes:
        """Validate a capsule and return its workspace bytes."""
        if not self.available:
            raise RuntimeError(UNAVAILABLE_REASON)
        policy = SizePolicy(
            max_archive_bytes=CAPSULE_MAX_BYTES,
            max_manifest_bytes=CAPSULE_MAX_MANIFEST_BYTES,
            max_workspace_bytes=CAPSULE_MAX_BYTES,
        )
        return read_capsule(data, policy).workspace

    @property
    def capsule_max_bytes(self) -> int | None:
        """Largest capsule opened (bytes), or None without DataLab-Capsule."""
        return CAPSULE_MAX_BYTES if self.available else None

    def replayable_function(self, activity: dict[str, Any]) -> Callable | None:
        """Return the local function of a replayable activity, or None."""
        operation = activity["call"]["operation"]
        if operation is None:
            return None
        try:
            contract = self._resolve_contract(
                operation["id"], operation["contract_version"]
            )
        except IneligibleError:
            return None
        return contract.function

    def set_edition_version(self, version: str) -> None:
        """Set the application version recorded in environments."""
        self.edition_version = str(version)
        self._environment = None

    @property
    def environment(self) -> dict[str, Any]:
        """Environment record of this runtime."""
        if self._environment is None:
            self._environment = collect_environment(EDITION, self.edition_version)
        return self._environment

    def info(self) -> dict[str, Any]:
        """Return a JSON-compatible snapshot for the TypeScript runtime."""
        return {
            "available": self.available,
            "reason": UNAVAILABLE_REASON,
            "ledger": self.ledger.to_dict() if self.available else None,
            "state_status": dict(self.state_status),
            "capture_failures": self.capture_failures,
            "notices": list(self.notices),
            "file_status": self.file_status,
        }

    # -- Capture ------------------------------------------------------------

    def _capture_failed(self, exc: Exception) -> None:
        self.capture_failures += 1
        _logger.warning("Provenance capture failed: %s", exc, exc_info=True)

    def facts(self, obj: Any) -> dict[str, Any]:
        """Return the state facts of a resident signal or image.

        Raises:
            ProvenanceResidencyError: If the object is spilled to disk.
        """
        if self._is_spilled(obj):
            raise ProvenanceResidencyError("Object arrays are not resident")
        return state_facts(obj)

    def observe(self, obj: SignalObj | ImageObj) -> str:
        """Return the state of *obj*, reusing its latest state if unchanged."""
        return self.ledger.observe(self._uuid_of(obj), self.facts(obj))

    @staticmethod
    def _build_call(
        func: Callable,
        param: Any,
        state_ids: list[str],
        objs: list[Any],
        roles: Sequence[str],
    ) -> tuple[dict[str, Any], list[str]]:
        contract = (
            None if _contracts is None else _contracts.contract_for_function(func)
        )
        if (
            contract is not None
            and contract.qualified
            and len(contract.inputs) == len(objs)
            and contract.check_preconditions(objs) is None
        ):
            values = _contracts.parameters_to_values(param)
            roles = [role.name for role in contract.inputs]
            return (
                make_call(
                    contract.operation_id,
                    contract.contract_version,
                    values,
                    list(zip(roles, state_ids)),
                ),
                [],
            )
        bindings = list(zip(roles, state_ids))
        if param is None:
            return make_call(None, None, {}, bindings), []
        if _contracts is None:
            return make_call(None, None, None, bindings), ["parameters_not_encoded"]
        try:
            values = _contracts.parameters_to_values(param)
        except _contracts.ParameterEncodingError:
            return make_call(None, None, None, bindings), ["parameters_not_encoded"]
        return make_call(None, None, values, bindings), []

    def begin(
        self,
        func: Callable,
        param: Any,
        source: Any,
        command_id: str | None = None,
        origin: str = "ordinary",
        x_alignment: dict[str, Any] | None = None,
        roles: Sequence[str] | None = None,
        limits: Sequence[str] = (),
    ) -> PendingActivity | None:
        """Record the input states of an execution, before it runs.

        Args:
            func: Computation function.
            param: Effective parameters, or None.
            source: Source signal or image, or the original input objects of a
             multi-input execution (before any alignment or interpolation).
            command_id: Identifier shared by the executions of one command.
            origin: Activity origin.
            x_alignment: X-alignment record applied to the inputs, or None.
            roles: Input roles of an unqualified call; by default ``source``, or
             ``source`` and ``operand`` for two inputs.
            limits: Extra reasons why the activity is not replayable.
        """
        objs = list(source) if isinstance(source, Sequence) else [source]
        if roles is None:
            roles = OPAQUE_ROLES.get(len(objs))
        if (
            not self.available
            or not objs
            or roles is None
            or len(roles) != len(objs)
            or not all(isinstance(obj, (SignalObj, ImageObj)) for obj in objs)
        ):
            return None
        try:
            state_ids = [self.observe(obj) for obj in objs]
            call, call_limits = self._build_call(func, param, state_ids, objs, roles)
            return PendingActivity(
                call=call,
                implementation=implementation_of(func),
                limits=call_limits + list(limits),
                command_id=command_id,
                origin=origin,
                started_at=utc_timestamp(),
                x_alignment=x_alignment,
            )
        except Exception as exc:  # pylint: disable=broad-exception-caught
            self._capture_failed(exc)
            return None

    def _record(
        self,
        pending: PendingActivity,
        outputs: list[tuple[str, str, dict[str, Any]]],
        artifacts: Sequence[tuple[str, str, str, str]] = (),
    ) -> dict[str, Any]:
        return self.ledger.record_activity(
            call=pending.call,
            outputs=outputs,
            artifacts=artifacts,
            environment=self.environment,
            edition=EDITION,
            origin=pending.origin,
            implementation=pending.implementation,
            command_id=pending.command_id,
            limits=pending.limits,
            context={"roi": None, "mask": None, "x_alignment": pending.x_alignment},
            started_at=pending.started_at,
        )

    def complete(
        self, pending: PendingActivity | None, output: Any
    ) -> dict[str, Any] | None:
        """Record a completed execution once its output was inserted."""
        if pending is None or not isinstance(output, (SignalObj, ImageObj)):
            return None
        try:
            output_uuid = self._uuid_of(output)
            if output_uuid is None or self._find_by_uuid(output_uuid) is not output:
                return None
            return self._record(pending, [("result", output_uuid, self.facts(output))])
        except Exception as exc:  # pylint: disable=broad-exception-caught
            self._capture_failed(exc)
            return None

    def complete_analysis(
        self, pending: PendingActivity | None, obj: Any, kind: str, key: str
    ) -> dict[str, Any] | None:
        """Record an analysis whose result was stored in *obj*'s metadata.

        Args:
            pending: Pending activity of the analysis.
            obj: Analysed object, which holds the result.
            kind: Result kind (``geometry`` or ``table``).
            key: Metadata key of the result.
        """
        if pending is None:
            return None
        try:
            artifact = ("result", kind, self._uuid_of(obj), key)
            return self._record(pending, [], artifacts=[artifact])
        except Exception as exc:  # pylint: disable=broad-exception-caught
            self._capture_failed(exc)
            return None

    # -- Verification -------------------------------------------------------

    @staticmethod
    def _resolve_contract(operation_id: str, version: int) -> Any:
        if _contracts is None:
            raise IneligibleError("unsupported_operation", "No operation contracts")
        try:
            contract = _contracts.get_operation_contract(operation_id, version)
        except _contracts.UnknownOperationError as exc:
            raise IneligibleError("unsupported_operation", str(exc)) from exc
        except _contracts.IncompatibleContractError as exc:
            raise IneligibleError("unsupported_contract", str(exc)) from exc
        if not contract.qualified:
            raise IneligibleError("unsupported_operation", "Contract not qualified")
        return contract

    @staticmethod
    def _decode(contract: Any, values: Any) -> Any:
        try:
            return _contracts.parameters_from_values(contract, values)
        except _contracts.InvalidParametersError as exc:
            raise IneligibleError("invalid_parameters", str(exc)) from exc

    @staticmethod
    def _apply_context(contract: Any, objs: list[Any], context: dict) -> list[Any]:
        try:
            return contract.prepare_inputs(objs, context)[0]
        except _contracts.XAlignmentError as exc:
            raise IneligibleError("unsupported_context", str(exc)) from exc

    def prepare(self, activity_id: str) -> Any:
        """Prepare a recorded activity for replay."""
        return prepare_activity(
            self.ledger,
            activity_id,
            resolve_contract=self._resolve_contract,
            find_object=self._find_by_uuid,
            observe_object=self.facts,
            check_preconditions=lambda contract, objs: contract.check_preconditions(
                objs
            ),
            decode_parameters=self._decode,
            state_status=self.state_status,
            apply_context=self._apply_context,
        )

    def _reference(self, activity: dict[str, Any]) -> tuple[dict | None, Any]:
        output = next(
            (
                o
                for o in activity["outputs"]
                if "state_id" in o and o["role"] == "result"
            ),
            None,
        )
        if output is None:
            return None, None
        state = self.ledger.states[output["state_id"]]
        obj = self._find_by_uuid(state["object_uuid"])
        status = "available"
        if obj is None or self.state_status.get(state["state_id"]) == "unavailable":
            status, obj = "missing", None
        elif self.state_status.get(state["state_id"]) == "altered" or (
            self.facts(obj)["fingerprint"] != state["fingerprint"]
        ):
            status = "altered"
        return {"state_id": state["state_id"], "status": status}, obj

    def verify(
        self,
        activity_id: str,
        execute_candidate: Callable[[Callable, list[Any], Any, dict], Any],
    ) -> dict[str, Any]:
        """Recompute a recorded activity as a separate candidate and compare it.

        The workspace and the ledger never change; the verification run only
        appears in the returned report.

        Args:
            activity_id: Activity to verify.
            execute_candidate: ``(function, inputs, parameters, context) ->
             result``; *inputs* are the live objects in role order and
             *context* the recorded execution context, which the candidate
             computation applies again (e.g. X alignment).
        """
        if not self.available:
            raise RuntimeError(UNAVAILABLE_REASON)
        activity = self.ledger.activity(activity_id)
        env_id = activity["environment_id"]
        environment = compare_environments(
            env_id,
            self.ledger.environments.get(env_id),
            environment_id(self.environment),
            self.environment,
        )
        reference, ref_obj = self._reference(activity)
        prepared = self.prepare(activity_id)
        if not isinstance(prepared, Plan):
            return build_report(
                activity_id=activity_id,
                restoration=prepared.restoration,
                eligibility=prepared.eligibility,
                inputs=list(prepared.input_statuses),
                reference=reference,
                environment=environment,
                reason=prepared.reason,
                context=activity["context"],
            )
        inputs = [
            {"role": role, "state_id": state_id, "status": "available"}
            for role, state_id, _obj in prepared.inputs
        ]
        candidate = execute_candidate(
            prepared.contract.function,
            [obj for _role, _state_id, obj in prepared.inputs],
            prepared.parameters,
            activity["context"],
        )
        if candidate is None:
            return build_report(
                activity_id=activity_id,
                restoration="replayable",
                eligibility="ready",
                inputs=inputs,
                reference=reference,
                environment=environment,
                reason="The candidate computation failed",
                context=activity["context"],
            )
        comparison = None
        if ref_obj is not None:
            comparison = compare_exact(signal_rows(candidate), signal_rows(ref_obj))
            if (candidate.xunit, candidate.yunit) != (ref_obj.xunit, ref_obj.yunit):
                comparison["verdict"] = "different"
        return build_report(
            activity_id=activity_id,
            restoration="replayable",
            eligibility="ready",
            inputs=inputs,
            reference=reference,
            environment=environment,
            comparison=comparison,
            candidate_state_ids=[("result", str(uuid.uuid4()))],
            context=activity["context"],
        )
