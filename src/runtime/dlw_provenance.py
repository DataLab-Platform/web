# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

"""
Workspace provenance for DataLab-Web.

Records every signal 1-to-1 processing in a workspace-level ledger, prepares
recorded activities for replay and verifies them against their stored result.
The ledger model, fingerprints, preparation and reports come from DataLab-Capsule;
operation contracts come from Sigima.

DataLab-Capsule is optional in the browser: without it, processing is unchanged
and provenance reports itself as unavailable. Capture never breaks processing: a
failure keeps the result, records nothing and is logged and counted. Spilled
(on-disk) objects are never fingerprinted.
"""

from __future__ import annotations

import dataclasses
import logging
import uuid
from collections.abc import Callable
from importlib import metadata
from typing import Any

try:
    from datalab_capsule.calls import make_call
    from datalab_capsule.compare import (
        build_report,
        compare_environments,
        compare_exact,
    )
    from datalab_capsule.environment import collect_environment, environment_id
    from datalab_capsule.hdf5 import load_ledger, save_ledger
    from datalab_capsule.integrity import signal_state_facts
    from datalab_capsule.ledger import Ledger, utc_timestamp
    from datalab_capsule.replay import IneligibleError, Plan, prepare_activity

    UNAVAILABLE_REASON: str | None = None
except ImportError as _exc:  # pragma: no cover - depends on the boot install
    UNAVAILABLE_REASON = f"DataLab-Capsule is not installed ({_exc})"

try:
    from sigima.proc import contracts as _contracts
except ImportError:  # pragma: no cover - released Sigima without contracts
    _contracts = None

from sigima.objects import SignalObj

_logger = logging.getLogger(__name__)

EDITION = "web"


class ProvenanceResidencyError(RuntimeError):
    """Raised when an object's arrays are spilled to disk (not resident)."""


@dataclasses.dataclass
class PendingActivity:
    """An execution whose input state was recorded, awaiting its output."""

    call: dict[str, Any]
    implementation: dict[str, Any]
    limits: list[str]
    command_id: str | None
    origin: str
    started_at: str


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
        """Return the state facts of a resident signal.

        Raises:
            ProvenanceResidencyError: If the object is spilled to disk.
        """
        if self._is_spilled(obj):
            raise ProvenanceResidencyError("Object arrays are not resident")
        return signal_state_facts(obj)

    def observe(self, obj: SignalObj) -> str:
        """Return the state of *obj*, reusing its latest state if unchanged."""
        return self.ledger.observe(self._uuid_of(obj), self.facts(obj))

    @staticmethod
    def _build_call(
        func: Callable, param: Any, state_id: str, obj: SignalObj
    ) -> tuple[dict[str, Any], list[str]]:
        contract = (
            None if _contracts is None else _contracts.contract_for_function(func)
        )
        if (
            contract is not None
            and contract.qualified
            and contract.check_preconditions([obj]) is None
        ):
            values = _contracts.parameters_to_values(param)
            return (
                make_call(
                    contract.operation_id,
                    contract.contract_version,
                    values,
                    [("source", state_id)],
                ),
                [],
            )
        if param is None:
            return make_call(None, None, {}, [("source", state_id)]), []
        if _contracts is None:
            return make_call(None, None, None, [("source", state_id)]), [
                "parameters_not_encoded"
            ]
        try:
            values = _contracts.parameters_to_values(param)
        except _contracts.ParameterEncodingError:
            return make_call(None, None, None, [("source", state_id)]), [
                "parameters_not_encoded"
            ]
        return make_call(None, None, values, [("source", state_id)]), []

    def begin(
        self,
        func: Callable,
        param: Any,
        source: Any,
        command_id: str | None = None,
        origin: str = "ordinary",
    ) -> PendingActivity | None:
        """Record the input state of a signal 1-to-1 execution, before it runs."""
        if not self.available or not isinstance(source, SignalObj):
            return None
        try:
            state_id = self.observe(source)
            call, limits = self._build_call(func, param, state_id, source)
            return PendingActivity(
                call=call,
                implementation=implementation_of(func),
                limits=limits,
                command_id=command_id,
                origin=origin,
                started_at=utc_timestamp(),
            )
        except Exception as exc:  # pylint: disable=broad-exception-caught
            self._capture_failed(exc)
            return None

    def complete(
        self, pending: PendingActivity | None, output: Any
    ) -> dict[str, Any] | None:
        """Record a completed execution once its output was inserted."""
        if pending is None or not isinstance(output, SignalObj):
            return None
        try:
            output_uuid = self._uuid_of(output)
            if output_uuid is None or self._find_by_uuid(output_uuid) is not output:
                return None
            return self.ledger.record_activity(
                call=pending.call,
                outputs=[("result", output_uuid, self.facts(output))],
                environment=self.environment,
                edition=EDITION,
                origin=pending.origin,
                implementation=pending.implementation,
                command_id=pending.command_id,
                limits=pending.limits,
                started_at=pending.started_at,
            )
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
        execute_candidate: Callable[[Callable, Any, Any], Any],
    ) -> dict[str, Any]:
        """Recompute a recorded activity as a separate candidate and compare it.

        The workspace and the ledger never change; the verification run only
        appears in the returned report.
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
            )
        inputs = [
            {"role": role, "state_id": state_id, "status": "available"}
            for role, state_id, _obj in prepared.inputs
        ]
        candidate = execute_candidate(
            prepared.contract.function, prepared.inputs[0][2], prepared.parameters
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
        )
