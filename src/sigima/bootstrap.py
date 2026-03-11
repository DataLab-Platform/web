# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""
Sigima bootstrap script for DataLab-Web.

Loaded once into Pyodide at application start-up. Owns the in-memory
:class:`ObjectModel` (mirrors :mod:`datalab.objectmodel`) and exposes thin
helpers callable from JavaScript through the Pyodide bridge.

The model is hierarchical: a :class:`_Panel` (one per object kind, e.g.
``"signal"``) holds an ordered list of :class:`_Group` instances, each
holding an ordered list of objects.  Identifiers are short hex strings.

Feature catalogue & processing dispatch live in :mod:`dlw_processor`,
loaded into Pyodide's filesystem by ``runtime.ts`` before this module is
executed.

The module is re-executable: the Vite Python HMR plugin re-runs this file
when it changes.  We therefore preserve the live :data:`_MODEL` and
:data:`_CATALOG` so user data is not wiped when only helpers change.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Iterable

import numpy as np
import sigima
from sigima.objects import SignalObj
from sigima.objects.signal.creation import (
    SIGNAL_TYPE_PARAM_CLASSES,
    SignalTypes,
    NewSignalParam,
    create_signal_parameters,
)
from sigima.objects.signal.roi import SignalROI, create_signal_roi

import dlw_processor as _proc


# ---------------------------------------------------------------------------
# Object model
# ---------------------------------------------------------------------------


def _new_id(prefix: str = "") -> str:
    """Return a short, unique identifier (optionally prefixed)."""
    return f"{prefix}{uuid.uuid4().hex[:8]}"


@dataclass
class _ObjectEntry:
    """One object stored in the model."""

    oid: str
    kind: str  # "signal" (later: "image", ...)
    obj: Any  # SignalObj for now


@dataclass
class _Group:
    """A group of objects (mirrors DataLab's ``ObjectGroup``)."""

    gid: str
    name: str
    object_ids: list[str] = field(default_factory=list)


@dataclass
class _Panel:
    """A panel groups objects of a given kind into ordered groups."""

    kind: str
    groups: list[_Group] = field(default_factory=list)
    default_group_name: str = "Group"

    def ensure_default_group(self) -> _Group:
        if not self.groups:
            self.groups.append(
                _Group(gid=_new_id("g"), name=f"{self.default_group_name} 1")
            )
        return self.groups[0]

    def find_group(self, gid: str) -> _Group:
        for g in self.groups:
            if g.gid == gid:
                return g
        raise KeyError(f"Unknown group: {gid!r}")

    def find_group_of(self, oid: str) -> _Group:
        for g in self.groups:
            if oid in g.object_ids:
                return g
        raise KeyError(f"Object {oid!r} not in panel {self.kind!r}")


class ObjectModel:
    """Hierarchical object model.

    Mirrors :class:`datalab.objectmodel.ObjectModel` in the desktop app:
    each panel (signal, image, ...) owns ordered groups holding objects.
    """

    def __init__(self) -> None:
        self._panels: dict[str, _Panel] = {}
        self._objects: dict[str, _ObjectEntry] = {}

    # -- Panel access -------------------------------------------------------

    def panel(self, kind: str) -> _Panel:
        if kind not in self._panels:
            self._panels[kind] = _Panel(kind=kind)
        return self._panels[kind]

    # -- Object access ------------------------------------------------------

    def get(self, oid: str) -> Any:
        return self._objects[oid].obj

    def kind_of(self, oid: str) -> str:
        return self._objects[oid].kind

    def has(self, oid: str) -> bool:
        return oid in self._objects

    # -- Object mutation ----------------------------------------------------

    def add_object(
        self, kind: str, obj: Any, group_id: str | None = None
    ) -> str:
        panel = self.panel(kind)
        group = panel.find_group(group_id) if group_id else panel.ensure_default_group()
        oid = _new_id()
        self._objects[oid] = _ObjectEntry(oid=oid, kind=kind, obj=obj)
        group.object_ids.append(oid)
        return oid

    def delete_object(self, oid: str) -> None:
        if oid not in self._objects:
            return
        kind = self._objects[oid].kind
        self._objects.pop(oid)
        panel = self.panel(kind)
        for g in panel.groups:
            if oid in g.object_ids:
                g.object_ids.remove(oid)
                break

    def move_object(self, oid: str, target_group_id: str) -> None:
        kind = self._objects[oid].kind
        panel = self.panel(kind)
        target = panel.find_group(target_group_id)
        src = panel.find_group_of(oid)
        if src is target:
            return
        src.object_ids.remove(oid)
        target.object_ids.append(oid)

    def rename_object(self, oid: str, name: str) -> None:
        obj = self._objects[oid].obj
        obj.title = name

    # -- Group mutation -----------------------------------------------------

    def create_group(self, kind: str, name: str | None = None) -> str:
        panel = self.panel(kind)
        if name is None:
            name = f"{panel.default_group_name} {len(panel.groups) + 1}"
        gid = _new_id("g")
        panel.groups.append(_Group(gid=gid, name=name))
        return gid

    def rename_group(self, kind: str, gid: str, name: str) -> None:
        self.panel(kind).find_group(gid).name = name

    def delete_group(self, kind: str, gid: str) -> None:
        panel = self.panel(kind)
        group = panel.find_group(gid)
        for oid in list(group.object_ids):
            self.delete_object(oid)
        panel.groups.remove(group)
        # Always keep at least one group available for fresh additions.
        panel.ensure_default_group()

    # -- Serialisation ------------------------------------------------------

    def panel_tree(self, kind: str) -> dict[str, Any]:
        panel = self.panel(kind)
        panel.ensure_default_group()
        return {
            "kind": kind,
            "groups": [
                {
                    "gid": g.gid,
                    "name": g.name,
                    "objects": [
                        {"id": oid, **_object_meta(self._objects[oid])}
                        for oid in g.object_ids
                        if oid in self._objects
                    ],
                }
                for g in panel.groups
            ],
        }

    def iter_all(self, kind: str) -> Iterable[tuple[str, Any]]:
        for entry in self._objects.values():
            if entry.kind == kind:
                yield entry.oid, entry.obj


def _object_meta(entry: _ObjectEntry) -> dict[str, Any]:
    """Return JSON-friendly metadata for *entry*."""
    obj = entry.obj
    if entry.kind == "signal":
        return {
            "kind": "signal",
            "uuid": getattr(obj, "uuid", None),
            "title": obj.title,
            "size": int(obj.x.size),
            "xlabel": obj.xlabel or "",
            "ylabel": obj.ylabel or "",
            "xunit": obj.xunit or "",
            "yunit": obj.yunit or "",
        }
    if entry.kind == "image":
        h, w = obj.data.shape[:2]
        return {
            "kind": "image",
            "uuid": getattr(obj, "uuid", None),
            "title": obj.title,
            "size": int(w * h),
            "width": int(w),
            "height": int(h),
            "xlabel": obj.xlabel or "",
            "ylabel": obj.ylabel or "",
            "xunit": obj.xunit or "",
            "yunit": obj.yunit or "",
        }
    return {"kind": entry.kind, "title": getattr(obj, "title", "")}


# Preserve the live model & catalogue across HMR re-executions of this file.
_MODEL: ObjectModel = globals().get("_MODEL", ObjectModel())  # type: ignore[assignment]
_CATALOG: dict[str, _proc.FeatureSpec] = globals().get(
    "_CATALOG", _proc.build_signal_catalog()
)
_PROCESSOR: _proc.BaseProcessor = globals().get(
    "_PROCESSOR", _proc.BaseProcessor("signal")
)


# ---------------------------------------------------------------------------
# Signal creation helpers
# ---------------------------------------------------------------------------


def create_signal(
    kind: str,
    title: str,
    size: int,
    xmin: float,
    xmax: float,
    a: float = 1.0,
    freq: float = 1.0,
    phase: float = 0.0,
    mu: float = 0.0,
    sigma: float = 1.0,
    group_id: str | None = None,
) -> str:
    """Create a synthetic signal and store it.

    Args:
        kind: One of ``"sine"``, ``"cosine"``, ``"gauss"``, ``"noise"``.
        title: Display name.
        size: Number of samples.
        xmin: X-axis lower bound.
        xmax: X-axis upper bound.
        a: Amplitude (sine/cosine/gauss).
        freq: Frequency in Hz (sine/cosine).
        phase: Phase in radians (sine/cosine).
        mu: Mean (gauss).
        sigma: Standard deviation (gauss).
        group_id: Optional target group id; uses the default group if absent.

    Returns:
        The newly assigned object id.
    """
    x = np.linspace(xmin, xmax, int(size))
    if kind == "sine":
        y = a * np.sin(2 * np.pi * freq * x + phase)
    elif kind == "cosine":
        y = a * np.cos(2 * np.pi * freq * x + phase)
    elif kind == "gauss":
        y = a * np.exp(-0.5 * ((x - mu) / sigma) ** 2)
    elif kind == "noise":
        rng = np.random.default_rng()
        y = a * rng.standard_normal(int(size))
    else:
        raise ValueError(f"Unknown signal kind: {kind!r}")
    obj: SignalObj = sigima.create_signal(title=title, x=x, y=y)
    return _MODEL.add_object("signal", obj, group_id=group_id)


def get_signal_xy(oid: str) -> dict[str, Any]:
    """Return the X / Y arrays of *oid* in JSON-friendly form."""
    obj = _MODEL.get(oid)
    return {
        "id": oid,
        "x": obj.x.tolist(),
        "y": obj.y.tolist(),
        **_object_meta(_ObjectEntry(oid=oid, kind="signal", obj=obj)),
    }


# ---------------------------------------------------------------------------
# Typed signal creation (mirrors DataLab desktop's "Create" menu)
# ---------------------------------------------------------------------------


# Curated icon hints per signal type — purely a UI suggestion (Plotly /
# inline SVG name).  The desktop uses Qt PNGs which we don't ship here.
_SIGNAL_TYPE_ICONS: dict[str, str] = {
    "zero": "wave-zero",
    "sine": "wave-sine",
    "cosine": "wave-cosine",
    "sawtooth": "wave-sawtooth",
    "triangle": "wave-triangle",
    "square": "wave-square",
    "sinc": "wave-sinc",
    "linearchirp": "wave-chirp",
    "step": "wave-step",
    "exponential": "wave-exp",
    "logistic": "wave-logistic",
    "pulse": "wave-pulse",
    "step_pulse": "wave-step-pulse",
    "square_pulse": "wave-square-pulse",
    "polynomial": "wave-poly",
    "custom": "wave-custom",
    "gauss": "peak-gauss",
    "lorentz": "peak-lorentz",
    "voigt": "peak-voigt",
    "planck": "peak-planck",
    "normal_distribution": "noise-normal",
    "poisson_distribution": "noise-poisson",
    "uniform_distribution": "noise-uniform",
}


# Per-object cached creation parameter instance.  Keyed by oid; populated
# when a signal is created via :func:`create_signal_typed` and consumed
# by :func:`get_creation_param_schema` / :func:`update_signal_creation_params`.
_CREATION_PARAMS: dict[str, NewSignalParam] = globals().get(
    "_CREATION_PARAMS", {}
)


def _signal_type_label(stype: SignalTypes) -> str:
    """Return the human-readable label for *stype* (translated)."""
    # ``LabeledEnum`` keeps the label as second tuple item; fall back to
    # the python attr name if anything weird shows up.
    try:
        return stype.value if isinstance(stype.value, str) else str(stype)
    except Exception:  # pylint: disable=broad-except
        return str(stype)


def list_signal_creation_types() -> list[dict[str, Any]]:
    """Return the curated list of supported signal generation types.

    Each entry: ``{"value": str, "label": str, "icon": str, "category": str}``.

    Categories mirror the DataLab desktop "Create" submenus:
    *Waveform*, *Peak*, *Noise*.
    """
    waveforms = {
        "zero", "sine", "cosine", "sawtooth", "triangle", "square",
        "sinc", "linearchirp", "step", "exponential", "logistic",
        "pulse", "step_pulse", "square_pulse", "polynomial", "custom",
    }
    peaks = {"gauss", "lorentz", "voigt", "planck"}
    noise = {
        "normal_distribution", "poisson_distribution", "uniform_distribution"
    }
    out: list[dict[str, Any]] = []
    for stype in SignalTypes:
        if stype not in SIGNAL_TYPE_PARAM_CLASSES:
            continue
        value = stype.value
        # ``LabeledEnum``: second tuple item is the translated label.
        try:
            label = stype.label  # type: ignore[attr-defined]
        except AttributeError:
            label = value
        if value in waveforms:
            category = "Waveform"
        elif value in peaks:
            category = "Peak"
        elif value in noise:
            category = "Noise"
        else:
            category = "Other"
        out.append(
            {
                "value": value,
                "label": label,
                "icon": _SIGNAL_TYPE_ICONS.get(value, "wave-generic"),
                "category": category,
            }
        )
    return out


def _stype_from_value(value: str) -> SignalTypes:
    for stype in SignalTypes:
        if stype.value == value:
            return stype
    raise ValueError(f"Unknown signal type: {value!r}")


def create_signal_typed(stype: str, group_id: str | None = None) -> str:
    """Create a signal of *stype* with default parameters and store it.

    Returns the new object id.  The originating :class:`NewSignalParam`
    instance is cached in :data:`_CREATION_PARAMS` so the UI can later
    display & edit those parameters live.
    """
    typ = _stype_from_value(stype)
    param = create_signal_parameters(typ)
    obj = sigima.create_signal_from_param(param)
    oid = _MODEL.add_object("signal", obj, group_id=group_id)
    _CREATION_PARAMS[oid] = param
    obj.metadata["_dlw_creation_stype_"] = stype
    return oid


def get_creation_param_schema(oid: str) -> dict[str, Any] | None:
    """Return the JSON Schema + values for the creation parameters of *oid*.

    Returns ``None`` when the signal was not created through the typed
    creation path (e.g. legacy ``create_signal`` or CSV import).
    """
    from guidata.dataset import dataset_to_schema_with_values

    param = _CREATION_PARAMS.get(oid)
    if param is None:
        return None
    payload = dataset_to_schema_with_values(param)
    payload["stype"] = _MODEL.get(oid).metadata.get("_dlw_creation_stype_")
    return payload


def update_signal_creation_params(
    oid: str, values: dict[str, Any]
) -> dict[str, Any]:
    """Apply *values* to the cached creation parameters and rebuild *oid*.

    The signal's ``x`` / ``y`` arrays are regenerated in place.  When the
    parameter class implements ``generate_title()``, the object title is
    refreshed too (mirrors desktop behaviour).
    """
    from guidata.dataset import update_dataset

    if hasattr(values, "to_py"):
        values = values.to_py()
    param = _CREATION_PARAMS.get(oid)
    if param is None:
        raise ValueError(
            f"Object {oid!r} has no cached creation parameters; "
            "use create_signal_typed first."
        )
    update_dataset(param, values)
    obj = _MODEL.get(oid)
    x, y = param.generate_1d_data()
    obj.set_xydata(x, y)
    # Mirror ``create_signal_from_param``: if the user kept the default
    # title, regenerate it from ``param.generate_title()``.
    from sigima.objects.signal.creation import DEFAULT_TITLE

    use_generated = not param.title or param.title == DEFAULT_TITLE
    if use_generated:
        gen = getattr(param, "generate_title", lambda: "")()
        obj.title = gen or param.title
    else:
        obj.title = param.title
    obj.xlabel = param.xlabel
    obj.ylabel = param.ylabel
    obj.xunit = param.xunit
    obj.yunit = param.yunit
    return {"size": int(obj.x.size), "title": obj.title}


# ---------------------------------------------------------------------------
# Object property panel (full SignalObj DataSet edition)
# ---------------------------------------------------------------------------


def get_object_property_schema(oid: str) -> dict[str, Any]:
    """Return the JSON Schema + values for *oid* itself.

    The underlying :class:`SignalObj` inherits from
    :class:`guidata.dataset.DataSet`, so its full layout (tabs, groups,
    units, etc.) is reused to render the "Properties" side panel.
    """
    from guidata.dataset import dataset_to_schema_with_values

    return dataset_to_schema_with_values(_MODEL.get(oid))


def set_object_property_values(oid: str, values: dict[str, Any]) -> None:
    """Apply *values* to the underlying :class:`SignalObj` instance."""
    from guidata.dataset import update_dataset

    if hasattr(values, "to_py"):
        values = values.to_py()
    obj = _MODEL.get(oid)
    update_dataset(obj, values)


# ---------------------------------------------------------------------------
# Object model helpers (panel-agnostic)
# ---------------------------------------------------------------------------


def get_panel_tree(kind: str = "signal") -> dict[str, Any]:
    """Return the full hierarchical tree for *kind* panel."""
    return _MODEL.panel_tree(kind)


def create_group(kind: str = "signal", name: str | None = None) -> str:
    """Create a new group in *kind* panel; returns the new group id."""
    return _MODEL.create_group(kind, name)


def rename_group(gid: str, name: str, kind: str = "signal") -> None:
    """Rename group *gid* in *kind* panel."""
    _MODEL.rename_group(kind, gid, name)


def delete_group(gid: str, kind: str = "signal") -> None:
    """Delete group *gid* (and all its objects) in *kind* panel."""
    _MODEL.delete_group(kind, gid)


def rename_object(oid: str, name: str) -> None:
    """Rename object *oid*."""
    _MODEL.rename_object(oid, name)


def move_object(oid: str, target_group_id: str) -> None:
    """Move object *oid* to *target_group_id*."""
    _MODEL.move_object(oid, target_group_id)


def delete_object(oid: str) -> None:
    """Delete object *oid* from its panel."""
    _MODEL.delete_object(oid)


# Backwards-compatible flat list (used by debug helpers / DevTools console).


def list_signals() -> list[dict[str, Any]]:
    """Return metadata for every stored signal (flat)."""
    return [
        {"id": oid, **_object_meta(_ObjectEntry(oid=oid, kind="signal", obj=obj))}
        for oid, obj in _MODEL.iter_all("signal")
    ]


def delete_signal(oid: str) -> None:
    """Backwards-compatible alias for :func:`delete_object`."""
    _MODEL.delete_object(oid)


# ---------------------------------------------------------------------------
# Image panel (Phase 7 spike — minimal read-only support)
# ---------------------------------------------------------------------------


def create_image(
    kind: str,
    title: str,
    width: int,
    height: int,
    a: float = 1.0,
    sigma: float = 50.0,
    group_id: str | None = None,
) -> str:
    """Create a synthetic image and store it in the ``"image"`` panel.

    Validates that the generic ObjectModel/Panel layer (Phase 1) is
    type-agnostic.  Supported kinds:

    * ``"gauss"``   — centred 2D Gaussian
    * ``"ramp"``    — horizontal ramp 0 → *a*
    * ``"random"``  — uniform random noise scaled by *a*
    """
    yy, xx = np.mgrid[0:height, 0:width]
    if kind == "gauss":
        cx, cy = width / 2.0, height / 2.0
        data = a * np.exp(
            -(((xx - cx) ** 2 + (yy - cy) ** 2) / (2.0 * sigma * sigma))
        )
    elif kind == "ramp":
        data = a * (xx / max(width - 1, 1))
    elif kind == "random":
        rng = np.random.default_rng()
        data = a * rng.random(size=(height, width))
    else:
        raise ValueError(f"Unknown image kind: {kind!r}")
    obj = sigima.create_image(title=title, data=data.astype(np.float64))
    return _MODEL.add_object("image", obj, group_id=group_id)


def get_image_data(oid: str) -> dict[str, Any]:
    """Return *oid* image data as nested lists (read-only viewer)."""
    obj = _MODEL.get(oid)
    return {
        "id": oid,
        "title": obj.title,
        "width": int(obj.data.shape[1]),
        "height": int(obj.data.shape[0]),
        "data": obj.data.tolist(),
        "xlabel": obj.xlabel or "",
        "ylabel": obj.ylabel or "",
        "xunit": obj.xunit or "",
        "yunit": obj.yunit or "",
    }


# ---------------------------------------------------------------------------
# Metadata & annotations (Phase 4)
# ---------------------------------------------------------------------------


_PLOTLY_ANNOTATIONS_KEY = "_dlw_plotly_annotations"


def get_object_meta(oid: str) -> dict[str, Any]:
    """Return the editable metadata fields for *oid*.

    Currently exposes title, axis labels and units — i.e. the fields
    DataLab desktop's metadata dialog edits for signal objects.
    """
    obj = _MODEL.get(oid)
    return {
        "title": obj.title or "",
        "xlabel": obj.xlabel or "",
        "ylabel": obj.ylabel or "",
        "xunit": obj.xunit or "",
        "yunit": obj.yunit or "",
    }


def set_object_meta(oid: str, fields: dict[str, Any]) -> None:
    """Update the editable metadata fields of *oid*.

    Unknown keys are ignored; missing keys are left unchanged.
    """
    if hasattr(fields, "to_py"):
        fields = fields.to_py()
    obj = _MODEL.get(oid)
    if "title" in fields:
        obj.title = str(fields["title"])
    if "xlabel" in fields:
        obj.xlabel = str(fields["xlabel"])
    if "ylabel" in fields:
        obj.ylabel = str(fields["ylabel"])
    if "xunit" in fields:
        obj.xunit = str(fields["xunit"])
    if "yunit" in fields:
        obj.yunit = str(fields["yunit"])


def get_plotly_annotations(oid: str) -> dict[str, Any]:
    """Return the persisted Plotly annotations payload for *oid*.

    The payload mirrors what Plotly's ``relayout`` event delivers
    (``shapes`` and ``annotations`` arrays).
    """
    obj = _MODEL.get(oid)
    payload = obj.metadata.get(_PLOTLY_ANNOTATIONS_KEY)
    if not isinstance(payload, dict):
        return {"shapes": [], "annotations": []}
    return {
        "shapes": list(payload.get("shapes", [])),
        "annotations": list(payload.get("annotations", [])),
    }


def set_plotly_annotations(oid: str, payload: dict[str, Any]) -> None:
    """Persist Plotly annotations (``shapes``, ``annotations``) for *oid*."""
    if hasattr(payload, "to_py"):
        payload = payload.to_py()
    obj = _MODEL.get(oid)
    obj.metadata[_PLOTLY_ANNOTATIONS_KEY] = {
        "shapes": list(payload.get("shapes", [])),
        "annotations": list(payload.get("annotations", [])),
    }


# ---------------------------------------------------------------------------
# Signal ROI (Phase 5)
# ---------------------------------------------------------------------------


def get_signal_roi(oid: str) -> list[dict[str, Any]]:
    """Return the list of ROI segments attached to signal *oid*.

    Each entry is ``{"xmin": float, "xmax": float, "title": str}``.
    Returns an empty list when no ROI is defined.
    """
    obj = _MODEL.get(oid)
    roi = obj.roi
    if roi is None or not roi.single_rois:
        return []
    out: list[dict[str, Any]] = []
    for single in roi.single_rois:
        # SegmentROI stores (xmin, xmax) directly in coords (indices=False).
        xmin, xmax = (float(single.coords[0]), float(single.coords[1]))
        out.append({"xmin": xmin, "xmax": xmax, "title": single.title or ""})
    return out


def set_signal_roi(oid: str, segments: list[dict[str, Any]] | None) -> None:
    """Replace the ROI of signal *oid* with *segments*.

    Args:
        oid: Signal object id.
        segments: List of ``{"xmin": float, "xmax": float, "title": str?}``.
            Empty/None clears the ROI.
    """
    if hasattr(segments, "to_py"):
        segments = segments.to_py()
    obj = _MODEL.get(oid)
    if not segments:
        obj.roi = None
        return
    coords: list[list[float]] = []
    titles: list[str] = []
    for seg in segments:
        xmin = float(seg["xmin"])
        xmax = float(seg["xmax"])
        if xmax <= xmin:
            raise ValueError(
                f"ROI segment xmin ({xmin}) must be < xmax ({xmax})"
            )
        coords.append([xmin, xmax])
        titles.append(str(seg.get("title", "")))
    roi = SignalROI()
    from sigima.objects.signal.roi import SegmentROI

    for (xmin, xmax), title in zip(coords, titles):
        roi.add_roi(
            SegmentROI(np.array([xmin, xmax], float), indices=False, title=title)
        )
    obj.roi = roi


# ---------------------------------------------------------------------------
# Project save / load + CSV I/O (Phase 6)
# ---------------------------------------------------------------------------


_PROJECT_FORMAT_VERSION = 1


def save_project() -> str:
    """Serialise the full object model to a JSON string (``.dlw`` format).

    The format is intentionally simple — a versioned dict with groups,
    objects (X/Y as plain Python lists), metadata, axis labels/units and
    persisted ROI/annotations.  No external dependency, no binary blob,
    so it round-trips through any text storage (OPFS, download, copy).
    """
    import json

    panels: dict[str, Any] = {}
    for kind, panel in _MODEL._panels.items():  # noqa: SLF001  (intentional)
        if kind != "signal":
            # Phase 7 spike: only signals are persistable for now.
            print(f"[bootstrap] save_project: skip non-signal panel {kind!r}")
            continue
        panel_groups: list[dict[str, Any]] = []
        for group in panel.groups:
            panel_groups.append(
                {
                    "gid": group.gid,
                    "name": group.name,
                    "objects": [
                        _serialise_object(oid, _MODEL._objects[oid].obj, kind)
                        for oid in group.object_ids
                        if oid in _MODEL._objects
                    ],
                }
            )
        panels[kind] = panel_groups
    payload = {
        "format": "datalab-web",
        "version": _PROJECT_FORMAT_VERSION,
        "panels": panels,
    }
    return json.dumps(payload)


def _serialise_object(oid: str, obj: Any, kind: str) -> dict[str, Any]:
    if kind != "signal":
        raise NotImplementedError(f"Cannot serialise object of kind {kind!r}")
    y = obj.y
    if np.iscomplexobj(y):
        y_payload: Any = {"real": y.real.tolist(), "imag": y.imag.tolist()}
    else:
        y_payload = y.tolist()
    return {
        "id": oid,
        "title": obj.title or "",
        "xlabel": obj.xlabel or "",
        "ylabel": obj.ylabel or "",
        "xunit": obj.xunit or "",
        "yunit": obj.yunit or "",
        "x": obj.x.tolist(),
        "y": y_payload,
        "metadata": _serialise_metadata(obj.metadata),
    }


def _serialise_metadata(meta: dict[str, Any]) -> dict[str, Any]:
    """Return JSON-friendly copy of *meta* (non-serialisable items dropped).

    Numpy arrays are converted to nested Python lists; non-coercible
    values are silently dropped (with a console note for visibility).
    """
    import json

    def _coerce(value: Any) -> Any:
        if isinstance(value, np.ndarray):
            return value.tolist()
        if isinstance(value, dict):
            return {k: _coerce(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [_coerce(v) for v in value]
        if isinstance(value, (np.integer,)):
            return int(value)
        if isinstance(value, (np.floating,)):
            return float(value)
        return value

    out: dict[str, Any] = {}
    for k, v in meta.items():
        coerced = _coerce(v)
        try:
            json.dumps(coerced)
        except (TypeError, ValueError) as exc:
            print(f"[bootstrap] drop non-serialisable metadata {k!r}: {exc}")
            continue
        out[k] = coerced
    return out


def load_project(content: str, *, replace: bool = True) -> dict[str, Any]:
    """Load *content* (output of :func:`save_project`) into the model.

    When *replace* is True (default), the current model is wiped first.
    Returns ``{"signals": int, "groups": int}`` for diagnostics.
    """
    import json

    payload = json.loads(content)
    if not isinstance(payload, dict) or payload.get("format") != "datalab-web":
        raise ValueError("Not a DataLab-Web project file")
    version = int(payload.get("version", 0))
    if version > _PROJECT_FORMAT_VERSION:
        raise ValueError(
            f"Project version {version} newer than supported "
            f"({_PROJECT_FORMAT_VERSION})"
        )
    if replace:
        _MODEL._panels.clear()  # noqa: SLF001
        _MODEL._objects.clear()  # noqa: SLF001
    panels = payload.get("panels", {})
    n_signals = 0
    n_groups = 0
    for kind, groups in panels.items():
        if kind != "signal":
            print(f"[bootstrap] skip unsupported panel kind: {kind!r}")
            continue
        panel = _MODEL.panel(kind)
        # Wipe the auto-created default group so we don't leave an extra one.
        if replace:
            panel.groups.clear()
        for gdef in groups:
            gid = _MODEL.create_group(kind, name=gdef.get("name") or "Group")
            n_groups += 1
            for odef in gdef.get("objects", []):
                y_def = odef["y"]
                if isinstance(y_def, dict) and "real" in y_def and "imag" in y_def:
                    y_arr = np.asarray(y_def["real"], dtype=float) + 1j * np.asarray(
                        y_def["imag"], dtype=float
                    )
                else:
                    y_arr = np.asarray(y_def, dtype=float)
                obj = sigima.create_signal(
                    title=odef.get("title", "Signal"),
                    x=np.asarray(odef["x"], dtype=float),
                    y=y_arr,
                )
                obj.xlabel = odef.get("xlabel") or ""
                obj.ylabel = odef.get("ylabel") or ""
                obj.xunit = odef.get("xunit") or ""
                obj.yunit = odef.get("yunit") or ""
                meta = odef.get("metadata") or {}
                for k, v in meta.items():
                    obj.metadata[k] = v
                _MODEL.add_object(kind, obj, group_id=gid)
                n_signals += 1
    return {"signals": n_signals, "groups": n_groups}


def export_signal_csv(oid: str, *, separator: str = ",") -> str:
    """Return *oid* as a 2-column CSV string (``x``, ``y`` header)."""
    obj = _MODEL.get(oid)
    xlabel = obj.xlabel or "x"
    ylabel = obj.ylabel or "y"
    if obj.xunit:
        xlabel = f"{xlabel} ({obj.xunit})"
    if obj.yunit:
        ylabel = f"{ylabel} ({obj.yunit})"
    lines = [f"{xlabel}{separator}{ylabel}"]
    for xv, yv in zip(obj.x.tolist(), obj.y.tolist()):
        lines.append(f"{xv}{separator}{yv}")
    return "\n".join(lines)


def import_signal_csv(
    content: str,
    *,
    title: str | None = None,
    separator: str = ",",
    group_id: str | None = None,
) -> str:
    """Parse a CSV blob into a new signal object; return its id.

    The first non-empty line is treated as a header if at least one
    field is non-numeric.  Only the first two numeric columns (X, Y)
    are kept — extra columns are ignored.  Lines whose first cell
    cannot be parsed as a float are skipped (allows comment lines).
    """
    raw_lines = [ln.strip() for ln in content.splitlines() if ln.strip()]
    if not raw_lines:
        raise ValueError("Empty CSV content")
    # Try to detect a header.
    first_fields = raw_lines[0].split(separator)
    header = None
    try:
        [float(c.strip()) for c in first_fields[:2]]
        data_start = 0
    except ValueError:
        header = first_fields
        data_start = 1
    xs: list[float] = []
    ys: list[float] = []
    for ln in raw_lines[data_start:]:
        cells = [c.strip() for c in ln.split(separator)]
        if len(cells) < 2:
            continue
        try:
            xs.append(float(cells[0]))
            ys.append(float(cells[1]))
        except ValueError:
            continue
    if not xs:
        raise ValueError("No numeric data found in CSV")
    obj = sigima.create_signal(
        title=title or "CSV import",
        x=np.asarray(xs, dtype=float),
        y=np.asarray(ys, dtype=float),
    )
    if header and len(header) >= 2:
        obj.xlabel = header[0]
        obj.ylabel = header[1]
    return _MODEL.add_object("signal", obj, group_id=group_id)


# ---------------------------------------------------------------------------
# Feature catalogue & processing
# ---------------------------------------------------------------------------


def list_features() -> list[dict[str, Any]]:
    """Return the full feature catalogue (signals only for now)."""
    return _proc.serialize_catalog(_CATALOG)


def get_feature_schema(feature_id: str) -> dict[str, Any] | None:
    """Return ``{schema, values}`` for *feature_id* or ``None`` if it is
    parameterless."""
    return _proc.get_schema(_CATALOG, feature_id)


def resolve_feature_choices(
    feature_id: str, item_name: str, values: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """Resolve a dynamic ChoiceItem for *feature_id*."""
    return _proc.resolve_choices(_CATALOG, feature_id, item_name, values)


def apply_feature(
    feature_id: str,
    source_ids: list[str],
    operand_id: str | None = None,
    params: dict[str, Any] | None = None,
) -> list[str]:
    """Apply *feature_id* to *source_ids* and return the new object ids.

    Result placement:
        * ``1_to_1`` / ``2_to_1``: each result goes into the same group as its
          source object.
        * ``n_to_1``: the single result goes into the group of the first source.
    """
    spec = _CATALOG.get(feature_id)
    if spec is None:
        raise ValueError(f"Unknown feature: {feature_id!r}")
    if not source_ids:
        raise ValueError("apply_feature requires at least one source")
    sources = [_MODEL.get(oid) for oid in source_ids]
    operand = _MODEL.get(operand_id) if operand_id else None
    panel = _MODEL.panel(spec.object_kind)
    ctx = _proc.ApplyContext(
        feature=spec, sources=sources, operand=operand, params=params
    )
    result = _PROCESSOR.apply(ctx, source_ids)
    new_ids: list[str] = []
    for source_oid, dst in result.items:
        anchor = source_oid or source_ids[0]
        group = panel.find_group_of(anchor)
        new_ids.append(_MODEL.add_object(spec.object_kind, dst, group_id=group.gid))
    return new_ids


# ---------------------------------------------------------------------------
# Backwards-compatible aliases (single-source legacy API)
# ---------------------------------------------------------------------------


def list_processings() -> list[dict[str, Any]]:
    """Legacy alias: return only ``1_to_1`` features as flat list."""
    return [
        {"id": s.feature_id, "label": s.label, "has_params": s.paramclass is not None}
        for s in _CATALOG.values()
        if s.pattern == "1_to_1"
    ]


def get_processing_schema(processing_id: str) -> dict[str, Any] | None:
    return get_feature_schema(processing_id)


def resolve_processing_choices(
    processing_id: str, item_name: str, values: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    return resolve_feature_choices(processing_id, item_name, values)


def apply_processing(
    oid: str, processing_id: str, params: dict[str, Any] | None = None
) -> str:
    """Legacy single-source helper."""
    return apply_feature(processing_id, [oid], params=params)[0]


__all__ = [
    "ObjectModel",
    "create_signal",
    "create_signal_typed",
    "list_signal_creation_types",
    "get_creation_param_schema",
    "update_signal_creation_params",
    "get_object_property_schema",
    "set_object_property_values",
    "list_signals",
    "get_signal_xy",
    "delete_signal",
    "create_image",
    "get_image_data",
    "get_panel_tree",
    "create_group",
    "rename_group",
    "delete_group",
    "rename_object",
    "move_object",
    "delete_object",
    "get_object_meta",
    "set_object_meta",
    "get_plotly_annotations",
    "set_plotly_annotations",
    "get_signal_roi",
    "set_signal_roi",
    "save_project",
    "load_project",
    "export_signal_csv",
    "import_signal_csv",
    "list_features",
    "get_feature_schema",
    "resolve_feature_choices",
    "apply_feature",
    "list_processings",
    "get_processing_schema",
    "resolve_processing_choices",
    "apply_processing",
]
