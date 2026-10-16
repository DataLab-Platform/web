# Copyright (c) DataLab Platform Developers, BSD 3-Clause license, see LICENSE file.

"""
Workspace provenance for DataLab-Web.

Records the signal and image processing (1-to-1, 2-to-1, n-to-1 and analyses) in
a workspace-level ledger, prepares recorded activities for replay and verifies
them against their stored result. :class:`WebProvenance` is the provenance
recorder of DataLab-Capsule (:class:`datalab_capsule.recorder.Recorder`), shared
with DataLab Desktop, given the accesses of DataLab-Web, plus the capsule
exchange functions of the browser. The ledger model, fingerprints, preparation,
comparison and reports come from DataLab-Capsule; operation contracts and the
scientific execution path come from Sigima. Only qualified operations can be
replayed.

DataLab-Capsule is optional in the browser: without it, processing is unchanged
and provenance reports itself as unavailable. Capture never breaks processing: a
failure keeps the result, records nothing and is logged and counted. Spilled
(on-disk) objects are never fingerprinted.
"""

from __future__ import annotations

import collections
import logging
from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any

from sigima.objects import ImageObj, SignalObj

try:
    from datalab_capsule.archive import (
        CapsuleError,
        SizePolicy,
        create_from_hdf5,
        read_capsule,
    )
    from datalab_capsule.diff import diff_manifests
    from datalab_capsule.hdf5 import has_block as _has_block
    from datalab_capsule.integrity import ProvenanceError, load_json, state_facts
    from datalab_capsule.legacy import legacy_summary
    from datalab_capsule.manifest import (
        inspect_manifest,
        manifest_fingerprint,
        validate_manifest,
    )
    from datalab_capsule.recorder import (
        CandidateError,
        PendingActivity,
        Recorder,
        RecorderHost,
        StateUnavailableError,
        computation_from_sigima,
    )
    from datalab_capsule.review import create_review, validate_review
    from datalab_capsule.verify import verify_capsule

    UNAVAILABLE_REASON: str | None = None
except ImportError as _exc:  # pragma: no cover - depends on the boot install
    UNAVAILABLE_REASON = f"DataLab-Capsule is not installed ({_exc})"

    class StateUnavailableError(RuntimeError):  # type: ignore[no-redef]
        """Stand-in when DataLab-Capsule is not installed."""

    class CandidateError(RuntimeError):  # type: ignore[no-redef]
        """Stand-in when DataLab-Capsule is not installed."""

    class Recorder:  # type: ignore[no-redef]
        """Stand-in when DataLab-Capsule is not installed: records nothing."""

        def __init__(self, host: Any, computation: Any) -> None:
            self.host = host
            self.computation = computation
            self.ledger = None
            self.state_status: dict[str, str] = {}
            self.notices: list[str] = []
            self.capture_failures = 0
            self.file_status: str | None = None

    RecorderHost = None  # type: ignore[assignment,misc]
    PendingActivity = None  # type: ignore[assignment,misc]

try:
    from sigima.proc import contracts as _contracts
except ImportError:  # pragma: no cover - released Sigima without contracts
    _contracts = None

_logger = logging.getLogger(__name__)

EDITION = "web"

#: Largest capsule (archive and workspace, bytes) opened in the browser. Opening
#: one grows the WebAssembly heap by about 3.5 times its size (Pyodide 0.26.4 in
#: Chromium: +841 MiB for a 240 MiB capsule, heap then 1.1 GiB), and this 32-bit
#: heap cannot exceed 4 GiB. The TypeScript runtime checks the file size before
#: reading it.
CAPSULE_MAX_BYTES = 256 * 1024 * 1024
#: Largest manifest opened in the browser (bytes).
CAPSULE_MAX_MANIFEST_BYTES = 16 * 1024 * 1024


class ProvenanceResidencyError(StateUnavailableError):
    """Raised when an object's arrays are spilled to disk (not resident)."""


def has_provenance_block(h5file: Any) -> bool:
    """Return True if an open workspace file holds a provenance block.

    Always False without DataLab-Capsule: the block could not be read anyway.
    """
    return UNAVAILABLE_REASON is None and _has_block(h5file)


def object_kind(obj: Any) -> str | None:
    """Return ``"signal"``, ``"image"`` or None for anything else."""
    if isinstance(obj, SignalObj):
        return "signal"
    if isinstance(obj, ImageObj):
        return "image"
    return None


class WebProvenance(Recorder):
    """Workspace provenance ledger of DataLab-Web.

    Args:
        find_by_uuid: Object lookup by persistent UUID (None when absent).
        uuid_of: Persistent UUID of an object.
        is_spilled: True when an object's arrays live on disk.
        iter_objects: Signals and images of the workspace, in model order.
        is_known_operation: ``(kind, name, plugin origin) -> bool``: whether an
         operation named in old metadata is in the catalogue.
    """

    def __init__(
        self,
        find_by_uuid: Callable[[str], Any],
        uuid_of: Callable[[Any], str | None],
        is_spilled: Callable[[Any], bool],
        iter_objects: Callable[[], Iterable[Any]],
        is_known_operation: Callable[[str, str, Any], bool],
    ) -> None:
        self._is_spilled = is_spilled
        self.edition_version = "dev"
        host = computation = None
        if UNAVAILABLE_REASON is None and _contracts is not None:
            host = RecorderHost(
                edition=EDITION,
                edition_version=lambda: self.edition_version,
                object_uuid=uuid_of,
                find_object=find_by_uuid,
                iter_objects=iter_objects,
                object_kind=object_kind,
                is_known_operation=is_known_operation,
                state_facts=self._resident_facts,
            )
            computation = computation_from_sigima(_contracts)
        super().__init__(host, computation)
        if host is None:
            self.ledger = None
        #: ``{"fingerprint", "name", "attachments"}`` of the capsule the
        #: workspace was opened from (the parent of a revision exported later).
        self.capsule_origin: dict[str, Any] | None = None

    @property
    def available(self) -> bool:
        """True when DataLab-Capsule is installed."""
        return self.ledger is not None

    def _resident_facts(self, obj: Any) -> dict[str, Any]:
        if self._is_spilled(obj):
            raise ProvenanceResidencyError("Object arrays are not resident")
        return state_facts(obj)

    # -- Workspace lifecycle ------------------------------------------------

    def reset(self) -> None:
        """Start an empty ledger for a new workspace."""
        if self.available:
            super().reset()
        else:
            self.state_status = {}
            self.notices = []
            self.file_status = None
        self.capsule_origin = None

    def save(self, h5file: Any) -> None:
        """Write the ledger block into a workspace file, after its panels."""
        if self.available:
            super().save(h5file)

    def read(self, h5file: Any) -> tuple[Any, dict[str, str]] | None:
        """Read and validate the block of a workspace file before anything changes.

        Returns:
            ``(ledger, state_status)``, or None without block or without
            DataLab-Capsule.

        Raises:
            ProvenanceFormatError: If the block is invalid.
        """
        return super().read(h5file) if self.available else None

    def load(
        self,
        block: tuple[Any, dict[str, str]] | None,
        replaced: bool,
        saved_version: str | None = None,
        current_version: str | None = None,
        appended: Any = (),
    ) -> None:
        """Adopt the ledger read from a workspace file, after its objects.

        Processing records of objects unknown to the ledger (workspaces saved
        without provenance, by DataLab Desktop) are then imported as
        ``legacy_metadata`` activities.

        Args:
            block: Result of :meth:`read`.
            replaced: False when the file was appended to the current workspace:
             ledgers are not merged and the file's block is ignored.
            saved_version: ``DataLab_Version`` of the file, as stored. It is
             never compared: Desktop stores its own version there, DataLab-Web
             the Sigima version.
            current_version: Ignored (see *saved_version*).
            appended: Objects added by an appended file: those holding an
             identifier already known to the ledger never inherit its records.
        """
        if not self.available:
            return
        super().load(block, replaced, saved_version, None, appended=appended)

    def _require(self) -> None:
        if not self.available:
            raise RuntimeError(UNAVAILABLE_REASON)

    @staticmethod
    def _policy() -> Any:
        return SizePolicy(
            max_archive_bytes=CAPSULE_MAX_BYTES,
            max_manifest_bytes=CAPSULE_MAX_MANIFEST_BYTES,
            max_workspace_bytes=CAPSULE_MAX_BYTES,
        )

    @staticmethod
    def _resolver(workspace: bytes | None) -> Callable[[str], bytes] | None:
        """Resolver of a referenced workspace: the file the user selected."""
        return None if workspace is None else (lambda _iri: workspace)

    def export_capsule(
        self,
        workspace: bytes,
        name: str | None = None,
        *,
        description: str | None = None,
        revision_of: str | None = None,
        workspace_ref: str | None = None,
        attachments: Sequence[Mapping[str, Any]] = (),
    ) -> bytes:
        """Return the capsule of a saved workspace (``.dlcapsule`` bytes).

        Args:
            workspace: Saved workspace (HDF5 bytes).
            name: Capsule name.
            description: Capsule description.
            revision_of: Manifest fingerprint of the parent revision.
            workspace_ref: Absolute IRI where the workspace will be published;
             the capsule then references it instead of including it.
            attachments: Light files selected by the user, as
             ``{name, data, media_type, description}``; declared in the
             manifest and never executed.
        """
        self._require()
        return create_from_hdf5(
            workspace,
            name=name,
            description=description,
            revision_of=revision_of,
            workspace_ref=workspace_ref,
            attachments=attachments,
        )

    def capsule_attachment(self, data: bytes, name: str) -> bytes:
        """Return the checked bytes of one attachment, for an explicit download.

        The capsule is read like any other (archive, manifest, SHA-256 and size
        of every attachment); the attachment is returned as data, never opened.

        Raises:
            CapsuleError: If the capsule is invalid or has no such attachment.
        """
        self._require()
        capsule = read_capsule(data, self._policy())
        if name not in capsule.attachments:
            raise CapsuleError(f"No such attachment: {name}")
        return capsule.attachments[name]

    def open_capsule(
        self, data: bytes, workspace: bytes | None = None
    ) -> tuple[bytes, dict[str, Any]]:
        """Validate a capsule and return its workspace bytes and its origin.

        Args:
            data: Capsule bytes.
            workspace: File selected by the user for a referenced workspace;
             it must match the SHA-256 and size of the manifest.

        Returns:
            ``(workspace, origin)``; *origin* is ``{"fingerprint", "name",
            "attachments"}`` of the capsule, to adopt with
            :meth:`set_capsule_origin` once the workspace is open.

        Raises:
            CapsuleError: If the capsule is invalid, or references a workspace
             that was not supplied or does not match.
        """
        self._require()
        capsule = read_capsule(data, self._policy(), self._resolver(workspace))
        if capsule.workspace is None:
            raise CapsuleError(
                "This capsule references its workspace: select the workspace file"
            )
        summary = inspect_manifest(capsule.manifest)
        origin = {
            "fingerprint": manifest_fingerprint(capsule.manifest),
            "name": summary["name"],
            "attachments": [a["name"] for a in summary["attachments"]],
        }
        return capsule.workspace, origin

    def set_capsule_origin(self, origin: dict[str, Any]) -> None:
        """Remember the capsule the current workspace was opened from."""
        self.capsule_origin = dict(origin)

    def check_registry_revision(
        self, manifest: str, fingerprint: str, reviews: Sequence[str] = ()
    ) -> dict[str, Any]:
        """Check a revision retrieved from a registry; trust nothing it says.

        Args:
            manifest: Manifest JSON text returned by the registry.
            fingerprint: Fingerprint that was requested.
            reviews: Review JSON texts returned by the registry.

        Returns:
            ``{"summary", "manifest", "reviews"}``; each review is
            ``{"review", "status"}``, ``status`` being ``"valid"`` or the
            reason it is not.

        Raises:
            ProvenanceError: If the manifest is invalid or is another revision.
        """
        self._require()
        parsed = load_json(manifest)
        validate_manifest(parsed)
        actual = manifest_fingerprint(parsed)
        if actual != fingerprint:
            raise CapsuleError(
                f"The registry returned another revision: {actual}, not {fingerprint}"
            )
        checked = []
        for text in reviews:
            try:
                review = load_json(text)
                validate_review(review, parsed)
                status = "valid"
            except (ValueError, ProvenanceError) as exc:
                review, status = None, str(exc)
            checked.append({"review": review, "status": status})
        return {
            "summary": inspect_manifest(parsed),
            "manifest": parsed,
            "reviews": checked,
        }

    def inspect_capsule(
        self,
        data: bytes,
        *,
        workspace: bytes | None = None,
        reports: Sequence[str] = (),
        reviews: Sequence[str] = (),
    ) -> dict[str, Any]:
        """Inspect a capsule without opening it; compute nothing.

        Two results are kept apart, and neither is a replay:

        - ``integrity``: the archive, the manifest, the workspace (when
          included or supplied) and every stored state, checked by
          :func:`datalab_capsule.verify.verify_capsule`;
        - ``documents``: the verification reports and reviews supplied by the
          user (JSON texts), checked against the capsule. Their verdicts are
          what their authors claim; nothing is recomputed here.

        Returns:
            ``{"summary", "manifest", "integrity", "documents"}``; ``summary``
            and ``manifest`` are None when the capsule cannot be read.
        """
        self._require()
        parsed: dict[str, list[Any]] = {"reports": [], "reviews": []}
        unreadable: list[dict[str, Any]] = []
        for kind, texts in (("reports", reports), ("reviews", reviews)):
            for index, text in enumerate(texts):
                try:
                    parsed[kind].append(load_json(text))
                except ValueError as exc:
                    unreadable.append(
                        {"kind": kind[:-1], "index": index, "status": str(exc)}
                    )
        resolver = self._resolver(workspace)
        try:
            capsule = read_capsule(data, self._policy(), resolver)
        except (OSError, ProvenanceError) as exc:
            return {
                "summary": None,
                "manifest": None,
                "integrity": {
                    "valid": False,
                    "fingerprint": None,
                    "workspace": None,
                    "states_located": None,
                    "states_altered": [],
                    "problems": [f"Invalid capsule: {exc}"],
                },
                "documents": None,
            }
        manifest = capsule.manifest
        # Free the workspace copy before verify_capsule reads the archive again.
        del capsule
        result = verify_capsule(
            data,
            resolve_workspace=resolver,
            reports=parsed["reports"],
            reviews=parsed["reviews"],
            policy=self._policy(),
        )
        rejected = collections.Counter(
            e["status"]
            for e in result["reports"] + result["reviews"]
            if e["status"] != "valid"
        )
        integrity_problems = []
        for problem in result["problems"]:
            if rejected[problem]:
                rejected[problem] -= 1
            else:
                integrity_problems.append(problem)
        return {
            "summary": inspect_manifest(manifest),
            "manifest": manifest,
            "integrity": {
                "valid": not integrity_problems,
                "fingerprint": result["fingerprint"],
                "workspace": result["workspace"],
                "states_located": result["states_located"],
                "states_altered": result["states_altered"],
                "problems": integrity_problems,
            },
            "documents": {
                "reports": result["reports"],
                "reviews": result["reviews"],
                "unreadable": unreadable,
            },
        }

    def diff_manifests(self, old: Any, new: Any) -> dict[str, Any]:
        """Compare two capsule manifests (e.g. kept in the revision list)."""
        self._require()
        for manifest in (old, new):
            validate_manifest(manifest)
        return diff_manifests(old, new)

    def create_review(
        self,
        manifest: Any,
        *,
        reviewer: str,
        statement: str,
        verdict: str | None = None,
        reports: Sequence[Any] = (),
    ) -> dict[str, Any]:
        """Write a review of one capsule revision (a separate JSON document)."""
        self._require()
        validate_manifest(manifest)
        return create_review(
            manifest,
            reviewer=reviewer,
            statement=statement,
            verdict=verdict,
            reports=reports,
        )

    @property
    def capsule_max_bytes(self) -> int | None:
        """Largest capsule opened (bytes), or None without DataLab-Capsule."""
        return CAPSULE_MAX_BYTES if self.available else None

    def producing_call(self, object_uuid: str) -> dict[str, Any] | None:
        """Return the call that produced the latest recorded state of an object.

        The operation is resolved when it is known locally, whether or not its
        verification is qualified (see
        :meth:`datalab_capsule.recorder.Recorder.producing_call`). None without
        DataLab-Capsule.
        """
        if not self.available:
            return None
        return super().producing_call(object_uuid)

    def set_edition_version(self, version: str) -> None:
        """Set the application version recorded in environments."""
        self.edition_version = str(version)
        if self.available:
            self.invalidate_environment()

    def info(self) -> dict[str, Any]:
        """Return a JSON-compatible snapshot for the TypeScript runtime.

        ``artifact_status`` maps each activity that recorded analysis results
        to their statuses (see :meth:`artifact_statuses`); ``legacy`` summarises
        the activities imported from old processing records.
        """
        artifacts: dict[str, list[dict[str, str]]] = {}
        if self.available:
            for activity in self.ledger.activities:
                if any("artifact" in output for output in activity["outputs"]):
                    artifacts[activity["activity_id"]] = self.artifact_statuses(
                        activity["activity_id"]
                    )
        return {
            "available": self.available,
            "reason": UNAVAILABLE_REASON,
            "ledger": self.ledger.to_dict() if self.available else None,
            "state_status": dict(self.state_status),
            "artifact_status": artifacts,
            "legacy": legacy_summary(self.ledger) if self.available else None,
            "capture_failures": self.capture_failures,
            "notices": list(self.notices),
            "file_status": self.file_status,
            "capsule_origin": self.capsule_origin,
        }

    # -- Capture and verification -----------------------------------------

    def facts(self, obj: Any) -> dict[str, Any]:
        """Return the state facts of a resident signal or image.

        Raises:
            ProvenanceResidencyError: If the object is spilled to disk.
        """
        return self._resident_facts(obj)

    def begin(self, func: Callable, param: Any, source: Any, *args, **kwargs) -> Any:
        """Record the input states of an execution, before it runs.

        See :meth:`datalab_capsule.recorder.Recorder.begin`.
        """
        if not self.available:
            return None
        return super().begin(func, param, source, *args, **kwargs)

    def complete(self, pending: Any, output: Any) -> dict[str, Any] | None:
        """Record a completed execution once its output was inserted."""
        if not self.available:
            return None
        return super().complete(pending, output)

    def complete_analysis(
        self, pending: Any, obj: Any, kind: str, key: str
    ) -> dict[str, Any] | None:
        """Record an analysis whose result was stored in *obj*'s metadata."""
        if not self.available:
            return None
        return super().complete_analysis(pending, obj, kind, key)

    def complete_without_result(self, pending: Any) -> dict[str, Any] | None:
        """Record a completed execution that produced no result (not an error)."""
        if not self.available:
            return None
        return super().complete_without_result(pending)

    def verify(
        self, activity_id: str, execute_candidate: Callable[[Any], Any]
    ) -> dict[str, Any]:
        """Recompute a recorded activity as a separate candidate and compare it.

        The workspace and the ledger never change; the verification run only
        appears in the returned report.

        Args:
            activity_id: Activity to verify.
            execute_candidate: ``(prepared execution) -> result``; runs the
             computation prepared by Sigima (recorded parameters and context
             applied to copies of the live inputs) without inserting the
             result, returns what the function returned (None for no result)
             and raises :class:`CandidateError` on error.
        """
        self._require()
        return super().verify(activity_id, execute_candidate)
