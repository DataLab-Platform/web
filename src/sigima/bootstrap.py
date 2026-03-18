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


def _build_full_catalog() -> dict[str, _proc.FeatureSpec]:
    """Merge signal and image curated catalogs into a single dict.

    Image features are namespaced under ``"image:"`` to avoid id
    collisions with same-named signal features.
    """
    catalog: dict[str, _proc.FeatureSpec] = {}
    for fid, spec in _proc.build_signal_catalog().items():
        catalog[fid] = spec
    for fid, spec in _proc.build_image_catalog().items():
        new_id = f"image:{fid}"
        # Reflect the prefix so the front-end uses it consistently.
        catalog[new_id] = _proc.FeatureSpec(
            feature_id=new_id,
            label=spec.label,
            menu_path=spec.menu_path,
            pattern=spec.pattern,
            icon=spec.icon,
            operand_label=spec.operand_label,
            paramclass=spec.paramclass,
            func=spec.func,
            object_kind=spec.object_kind,
            skip_xarray_compat=spec.skip_xarray_compat,
        )
    return catalog


# Preserve the live model & catalogue across HMR re-executions of this file.
_MODEL: ObjectModel = globals().get("_MODEL", ObjectModel())  # type: ignore[assignment]
_CATALOG: dict[str, _proc.FeatureSpec] = globals().get(
    "_CATALOG", _build_full_catalog()
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


# Curated icon hints per signal type — matches DataLab desktop's
# ``datalab/data/icons/create/*.svg`` filenames so the React UI can
# resolve them via Vite's ``import.meta.glob``.
_SIGNAL_TYPE_ICONS: dict[str, str] = {
    "zero": "1d-zero.svg",
    "normal_distribution": "1d-normal.svg",
    "poisson_distribution": "1d-poisson.svg",
    "uniform_distribution": "1d-uniform.svg",
    "gauss": "gaussian.svg",
    "lorentz": "lorentzian.svg",
    "voigt": "voigt.svg",
    "planck": "planck.svg",
    "sine": "sine.svg",
    "cosine": "cosine.svg",
    "sawtooth": "sawtooth.svg",
    "triangle": "triangle.svg",
    "square": "square.svg",
    "sinc": "sinc.svg",
    "linearchirp": "linear_chirp.svg",
    "step": "step.svg",
    "exponential": "exponential.svg",
    "logistic": "logistic.svg",
    "pulse": "pulse.svg",
    "step_pulse": "step_pulse.svg",
    "square_pulse": "square_pulse.svg",
    "polynomial": "polynomial.svg",
    "custom": "",  # no icon in DataLab desktop either
}


# Flat ordering matching DataLab desktop's "Create" menu (``actionhandler.py``
# ``SignalActionHandler.create_first_actions``).  ``True`` in the ``separator``
# column means a separator is drawn *before* the entry.
_SIGNAL_TYPE_ORDER: list[tuple[str, bool]] = [
    ("zero", False),
    ("normal_distribution", False),
    ("poisson_distribution", False),
    ("uniform_distribution", False),
    ("gauss", True),
    ("lorentz", False),
    ("voigt", False),
    ("planck", False),
    ("sine", True),
    ("cosine", False),
    ("sawtooth", False),
    ("triangle", False),
    ("square", False),
    ("sinc", False),
    ("linearchirp", False),
    ("step", True),
    ("exponential", False),
    ("logistic", False),
    ("pulse", False),
    ("step_pulse", False),
    ("square_pulse", False),
    ("polynomial", True),
    ("custom", False),
]


# Per-object cached creation parameter instance.  Keyed by oid; populated
# when a signal is created via :func:`create_signal_typed` and consumed
# by :func:`get_creation_param_schema` / :func:`update_signal_creation_params`.
_CREATION_PARAMS: dict[str, Any] = globals().get(
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
    """Return the flat list of supported signal generation types.

    Order and separators mirror DataLab desktop's "Create" menu
    (``SignalActionHandler.create_first_actions``).  Each entry:
    ``{"value": str, "label": str, "icon": str, "separator_before": bool}``.

    ``icon`` is the bare SVG filename — the React UI maps it to a URL via
    Vite's ``import.meta.glob`` over ``src/assets/icons/create``.
    """
    by_value = {stype.value: stype for stype in SignalTypes}
    out: list[dict[str, Any]] = []
    for value, separator in _SIGNAL_TYPE_ORDER:
        stype = by_value.get(value)
        if stype is None or stype not in SIGNAL_TYPE_PARAM_CLASSES:
            continue
        try:
            label = stype.label  # type: ignore[attr-defined]
        except AttributeError:
            label = value
        out.append(
            {
                "value": value,
                "label": label,
                "icon": _SIGNAL_TYPE_ICONS.get(value, ""),
                "separator_before": separator,
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
# Properties side panel — extended widgets (stats / array / metadata).
# ---------------------------------------------------------------------------


def _safe_stat(fn, arr) -> float | None:
    """Return ``fn(arr)`` as a float, or ``None`` when the array is
    empty or the value is non-finite (NaN / Inf)."""
    import numpy as np

    if arr is None or len(arr) == 0:
        return None
    try:
        v = float(fn(arr))
    except Exception:
        return None
    if not np.isfinite(v):
        return None
    return v


def get_object_stats(oid: str) -> dict[str, Any]:
    """Return a JSON-friendly stats summary for *oid*.

    Mirrors the "Statistics" panel of DataLab desktop — a compact
    read-only dashboard shown above the editable Properties form.
    """
    import numpy as np

    obj = _MODEL.get(oid)
    kind = _MODEL.kind_of(oid)
    if kind == "signal":
        x, y = obj.x, obj.y
        return {
            "kind": "signal",
            "n_points": int(x.size),
            "x_dtype": str(x.dtype),
            "y_dtype": str(y.dtype),
            "x_min": _safe_stat(np.min, x),
            "x_max": _safe_stat(np.max, x),
            "y_min": _safe_stat(np.min, y),
            "y_max": _safe_stat(np.max, y),
            "y_mean": _safe_stat(np.mean, y),
            "y_std": _safe_stat(np.std, y),
            "y_median": _safe_stat(np.median, y),
        }
    # image
    data = obj.data
    return {
        "kind": "image",
        "shape": list(data.shape),
        "dtype": str(data.dtype),
        "min": _safe_stat(np.min, data),
        "max": _safe_stat(np.max, data),
        "mean": _safe_stat(np.mean, data),
        "std": _safe_stat(np.std, data),
        "median": _safe_stat(np.median, data),
    }


# Internal metadata keys that should not be shown to the user.
# Mirrors :data:`_PLOTLY_ANNOTATIONS_KEY` defined later in the module.
_HIDDEN_METADATA_KEYS = ("_dlw_creation_stype_", "_dlw_plotly_annotations")


def _metadata_visible(key: str) -> bool:
    if key in _HIDDEN_METADATA_KEYS:
        return False
    if key.startswith("Geometry_") and key.endswith("_dict"):
        return False
    if key.startswith("Table_") and key.endswith("_dict"):
        return False
    return True


def _metadata_value_repr(v: Any) -> tuple[str, str]:
    """Categorise a metadata value and return ``(value_type, str_value)``.

    The ``value_type`` is one of ``"string" | "number" | "bool" |
    "json"`` and tells the front-end which editor widget to use.
    """
    import json

    if isinstance(v, bool):
        return "bool", "true" if v else "false"
    if isinstance(v, (int, float)):
        return "number", repr(v)
    if isinstance(v, str):
        return "string", v
    try:
        return "json", json.dumps(v, default=str)
    except Exception:
        return "json", str(v)


def list_object_metadata(oid: str) -> list[dict[str, Any]]:
    """Return the user-visible metadata entries of *oid*.

    Each entry is ``{key, value_type, value}`` where ``value_type``
    drives the front-end widget choice (string / number / bool / json).
    Internal bookkeeping keys (Plotly annotations, creation type,
    geometry/table results) are filtered out.
    """
    obj = _MODEL.get(oid)
    out: list[dict[str, Any]] = []
    for key in sorted(obj.metadata):
        if not _metadata_visible(key):
            continue
        value_type, str_value = _metadata_value_repr(obj.metadata[key])
        out.append(
            {"key": key, "value_type": value_type, "value": str_value}
        )
    return out


def set_object_metadata_value(
    oid: str, key: str, value_type: str, value: str
) -> None:
    """Add or update a metadata entry on *oid*.

    The string ``value`` is parsed back into a Python object according
    to ``value_type`` (``"string" | "number" | "bool" | "json"``).
    """
    import json

    obj = _MODEL.get(oid)
    if not _metadata_visible(key):
        raise ValueError(
            f"Metadata key {key!r} is reserved for internal use"
        )
    parsed: Any
    if value_type == "string":
        parsed = value
    elif value_type == "number":
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            parsed = float(value)
    elif value_type == "bool":
        s = (value or "").strip().lower()
        parsed = s in ("1", "true", "yes", "on")
    elif value_type == "json":
        parsed = json.loads(value)
    else:
        raise ValueError(f"Unknown value_type: {value_type!r}")
    obj.metadata[key] = parsed


def delete_object_metadata_key(oid: str, key: str) -> bool:
    """Remove *key* from *oid*'s metadata.  Returns ``True`` when the
    key was present, ``False`` otherwise."""
    obj = _MODEL.get(oid)
    if not _metadata_visible(key):
        # silently ignore reserved keys
        return False
    return obj.metadata.pop(key, None) is not None


# ---------------------------------------------------------------------------
# Generic file I/O (mirrors DataLab's "Open"/"Save" actions).
# ---------------------------------------------------------------------------


def list_signal_io_formats() -> dict[str, Any]:
    """Return the supported signal I/O formats.

    The shape mimics what DataLab desktop builds for its Qt file dialog:

    .. code:: python

        {
            "read": [{"name": str, "extensions": ["csv", "txt", ...]}, ...],
            "write": [...],
            "all_read_extensions": ["csv", "txt", "h5sig", ...],
            "all_write_extensions": [...],
        }
    """
    from sigima.io.signal.base import SignalIORegistry

    read: list[dict[str, Any]] = []
    write: list[dict[str, Any]] = []
    all_read: list[str] = []
    all_write: list[str] = []
    for fmt in SignalIORegistry.get_formats():
        entry = {
            "name": fmt.info.name,
            "extensions": list(fmt.extlist),
        }
        if fmt.info.readable:
            read.append(entry)
            all_read.extend(fmt.extlist)
        if fmt.info.writeable:
            write.append(entry)
            all_write.extend(fmt.extlist)
    return {
        "read": read,
        "write": write,
        "all_read_extensions": sorted(set(all_read)),
        "all_write_extensions": sorted(set(all_write)),
    }


def open_signal_from_bytes(
    filename: str, data: Any, group_id: str | None = None
) -> list[str]:
    """Decode *data* (a Pyodide ``Uint8Array`` / Python ``bytes``) as a signal
    file and add every signal it contains to the model.

    Dispatches by extension via Sigima's :class:`SignalIORegistry`, so every
    format DataLab desktop supports (HDF5 ``.h5sig``, CSV, NumPy ``.npy``,
    MATLAB ``.mat``, FT-Lab ``.sig``, MCA ``.mca``, …) Just Works.

    Args:
        filename: Original file name; only the basename + extension matter.
        data: Raw bytes from the browser ``File`` object.
        group_id: Optional group to put the new signals into.

    Returns:
        List of newly created object ids (one per signal in the file).
    """
    import os
    import tempfile
    from sigima.io import read_signals

    # Pyodide passes ``Uint8Array`` as a ``memoryview``-like JsProxy: convert
    # to ``bytes`` for write_bytes().
    if hasattr(data, "to_py"):
        data = data.to_py()
    if not isinstance(data, (bytes, bytearray, memoryview)):
        # ``Uint8Array.toJs()`` returns a list of ints in some Pyodide
        # versions — coerce to bytes.
        data = bytes(data)
    base = os.path.basename(filename) or "upload.bin"
    tmpdir = tempfile.mkdtemp(prefix="dlw_open_")
    path = os.path.join(tmpdir, base)
    with open(path, "wb") as fh:
        fh.write(bytes(data))
    try:
        signals = read_signals(path)
    finally:
        try:
            os.remove(path)
            os.rmdir(tmpdir)
        except OSError:
            pass
    if not signals:
        raise ValueError(f"No signal could be read from {base!r}")
    oids: list[str] = []
    for sig in signals:
        oids.append(_MODEL.add_object("signal", sig, group_id=group_id))
    return oids


def save_signal_to_bytes(oid: str, filename: str) -> bytes:
    """Serialise *oid* into a byte string in the format implied by *filename*.

    The extension drives format selection via Sigima's
    :class:`SignalIORegistry` (CSV, HDF5 ``.h5sig``, NumPy ``.npy``,
    MATLAB ``.mat``, …).
    """
    import os
    import tempfile
    from sigima.io import write_signal

    obj = _MODEL.get(oid)
    base = os.path.basename(filename) or "signal.csv"
    tmpdir = tempfile.mkdtemp(prefix="dlw_save_")
    path = os.path.join(tmpdir, base)
    try:
        write_signal(path, obj)
        with open(path, "rb") as fh:
            return fh.read()
    finally:
        try:
            os.remove(path)
            os.rmdir(tmpdir)
        except OSError:
            pass


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
# Image panel
# ---------------------------------------------------------------------------


from sigima.objects.image.creation import (  # noqa: E402  pylint: disable=wrong-import-position
    DEFAULT_TITLE as _IMAGE_DEFAULT_TITLE,
    IMAGE_TYPE_PARAM_CLASSES,
    ImageTypes,
    NewImageParam,
    create_image_from_param,
    create_image_parameters,
)


# Display order mirrors DataLab desktop's "Create" image menu.
# ``True`` in the second column means a separator is drawn *before* the entry.
_IMAGE_TYPE_ORDER: list[tuple[str, bool]] = [
    ("zero", False),
    ("normal_distribution", False),
    ("poisson_distribution", False),
    ("uniform_distribution", False),
    ("gauss", True),
    ("ramp", False),
    ("checkerboard", True),
    ("sinusoidal_grating", False),
    ("ring", False),
    ("siemens_star", False),
    ("sinc", False),
]


# Icon names follow the same convention as signals — bare SVG filenames
# resolved by the React UI through ``import.meta.glob`` over
# ``src/assets/icons/create``.  Fallback to a generic icon if missing.
_IMAGE_TYPE_ICONS: dict[str, str] = {
    "zero": "2d-zero.svg",
    "normal_distribution": "2d-normal.svg",
    "poisson_distribution": "2d-poisson.svg",
    "uniform_distribution": "2d-uniform.svg",
    "gauss": "2d-gaussian.svg",
    "ramp": "2d-ramp.svg",
    "checkerboard": "checkerboard.svg",
    "sinusoidal_grating": "grating.svg",
    "ring": "ring.svg",
    "siemens_star": "siemens.svg",
    "sinc": "2d-sinc.svg",
}


def list_image_creation_types() -> list[dict[str, Any]]:
    """Return the flat list of supported image generation types.

    Same payload shape as :func:`list_signal_creation_types`.
    """
    by_value = {itype.value: itype for itype in ImageTypes}
    out: list[dict[str, Any]] = []
    for value, separator in _IMAGE_TYPE_ORDER:
        itype = by_value.get(value)
        if itype is None or itype not in IMAGE_TYPE_PARAM_CLASSES:
            continue
        try:
            label = itype.label  # type: ignore[attr-defined]
        except AttributeError:
            label = value
        out.append(
            {
                "value": value,
                "label": label,
                "icon": _IMAGE_TYPE_ICONS.get(value, ""),
                "separator_before": separator,
            }
        )
    return out


def _itype_from_value(value: str) -> ImageTypes:
    for itype in ImageTypes:
        if itype.value == value:
            return itype
    raise ValueError(f"Unknown image type: {value!r}")


def create_image_typed(stype: str, group_id: str | None = None) -> str:
    """Create an image of *stype* with default parameters and store it.

    The originating :class:`NewImageParam` instance is cached in
    :data:`_CREATION_PARAMS` so the UI can later display & edit those
    parameters live (mirrors :func:`create_signal_typed`).
    """
    typ = _itype_from_value(stype)
    param = create_image_parameters(typ)
    obj = create_image_from_param(param)
    oid = _MODEL.add_object("image", obj, group_id=group_id)
    _CREATION_PARAMS[oid] = param
    obj.metadata["_dlw_creation_stype_"] = stype
    return oid


def update_image_creation_params(
    oid: str, values: dict[str, Any]
) -> dict[str, Any]:
    """Apply *values* to the cached creation parameters and rebuild *oid*."""
    from guidata.dataset import update_dataset

    if hasattr(values, "to_py"):
        values = values.to_py()
    param = _CREATION_PARAMS.get(oid)
    if param is None or not isinstance(param, NewImageParam):
        raise ValueError(
            f"Object {oid!r} has no cached image creation parameters; "
            "use create_image_typed first."
        )
    update_dataset(param, values)
    new_obj = create_image_from_param(param)
    obj = _MODEL.get(oid)
    obj.data = new_obj.data
    obj.x0 = new_obj.x0
    obj.y0 = new_obj.y0
    obj.dx = new_obj.dx
    obj.dy = new_obj.dy
    use_generated = not param.title or param.title == _IMAGE_DEFAULT_TITLE
    if use_generated:
        gen = getattr(param, "generate_title", lambda: "")()
        obj.title = gen or param.title
    else:
        obj.title = param.title
    obj.xlabel = param.xlabel
    obj.ylabel = param.ylabel
    obj.zlabel = param.zlabel
    obj.xunit = param.xunit
    obj.yunit = param.yunit
    obj.zunit = param.zunit
    return {
        "shape": [int(obj.data.shape[0]), int(obj.data.shape[1])],
        "title": obj.title,
    }


def create_image(
    kind: str,
    title: str,
    width: int,
    height: int,
    a: float = 1.0,
    sigma: float = 50.0,
    group_id: str | None = None,
) -> str:
    """Legacy synthetic image helper kept for backwards compatibility.

    Prefer :func:`create_image_typed` which mirrors DataLab desktop.
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
    """Return *oid* image data (read-only viewer payload).

    Coordinates honour ``x0``/``y0``/``dx``/``dy`` (image origin and pixel
    spacing).  ``data`` is exposed as nested lists.  ``data_min``/``max``
    let the front-end pick a default LUT range without re-iterating.
    """
    obj = _MODEL.get(oid)
    data = obj.data
    return {
        "id": oid,
        "title": obj.title or "",
        "width": int(data.shape[1]),
        "height": int(data.shape[0]),
        "data": data.tolist(),
        "dtype": str(data.dtype),
        "x0": float(getattr(obj, "x0", 0.0) or 0.0),
        "y0": float(getattr(obj, "y0", 0.0) or 0.0),
        "dx": float(getattr(obj, "dx", 1.0) or 1.0),
        "dy": float(getattr(obj, "dy", 1.0) or 1.0),
        "data_min": float(np.nanmin(data)),
        "data_max": float(np.nanmax(data)),
        "xlabel": obj.xlabel or "",
        "ylabel": obj.ylabel or "",
        "zlabel": getattr(obj, "zlabel", "") or "",
        "xunit": obj.xunit or "",
        "yunit": obj.yunit or "",
        "zunit": getattr(obj, "zunit", "") or "",
    }


# ---------------------------------------------------------------------------
# Image ROI (Phase 13)
# ---------------------------------------------------------------------------


def get_image_roi(oid: str) -> list[dict[str, Any]]:
    """Return ROI list attached to image *oid* in physical coordinates.

    Each entry is one of:

    * Rectangle: ``{"geometry": "rectangle", "title": str, "inverse": bool,
      "x0": float, "y0": float, "dx": float, "dy": float}``
    * Circle: ``{"geometry": "circle", "title": str, "inverse": bool,
      "xc": float, "yc": float, "r": float}``
    * Polygon: ``{"geometry": "polygon", "title": str, "inverse": bool,
      "points": [[x0,y0],[x1,y1],...]}``

    Returns ``[]`` when no ROI is defined.
    """
    from sigima.objects.image.roi import (
        CircularROI,
        PolygonalROI,
        RectangularROI,
    )

    obj = _MODEL.get(oid)
    roi = obj.roi
    if roi is None or not roi.single_rois:
        return []
    out: list[dict[str, Any]] = []
    for single in roi.single_rois:
        title = single.title or ""
        inverse = bool(getattr(single, "inverse", False))
        if isinstance(single, RectangularROI):
            x0, y0, dx, dy = single.get_physical_coords(obj)
            out.append(
                {
                    "geometry": "rectangle",
                    "title": title,
                    "inverse": inverse,
                    "x0": float(x0),
                    "y0": float(y0),
                    "dx": float(dx),
                    "dy": float(dy),
                }
            )
        elif isinstance(single, CircularROI):
            xc, yc, r = single.get_physical_coords(obj)
            out.append(
                {
                    "geometry": "circle",
                    "title": title,
                    "inverse": inverse,
                    "xc": float(xc),
                    "yc": float(yc),
                    "r": float(r),
                }
            )
        elif isinstance(single, PolygonalROI):
            coords = single.get_physical_coords(obj)
            pts = [
                [float(coords[2 * i]), float(coords[2 * i + 1])]
                for i in range(len(coords) // 2)
            ]
            out.append(
                {
                    "geometry": "polygon",
                    "title": title,
                    "inverse": inverse,
                    "points": pts,
                }
            )
    return out


def _build_image_roi(
    obj: Any, segments: list[dict[str, Any]]
) -> Any:
    """Build an :class:`ImageROI` populated with *segments* (physical coords)."""
    from sigima.objects.image.roi import (
        CircularROI,
        ImageROI,
        PolygonalROI,
        RectangularROI,
    )

    roi = ImageROI()
    for seg in segments:
        geometry = str(seg.get("geometry", "rectangle"))
        title = str(seg.get("title", "") or "")
        inverse = bool(seg.get("inverse", False))
        if geometry == "rectangle":
            x0 = float(seg["x0"])
            y0 = float(seg["y0"])
            dx = float(seg["dx"])
            dy = float(seg["dy"])
            if dx <= 0 or dy <= 0:
                raise ValueError(
                    f"Rectangle ROI requires positive dx/dy (got dx={dx}, dy={dy})"
                )
            roi.add_roi(
                RectangularROI(
                    [x0, y0, dx, dy], indices=False, title=title, inverse=inverse
                )
            )
        elif geometry == "circle":
            xc = float(seg["xc"])
            yc = float(seg["yc"])
            r = float(seg["r"])
            if r <= 0:
                raise ValueError(f"Circle ROI requires positive radius (got r={r})")
            roi.add_roi(
                CircularROI(
                    [xc, yc, r],
                    indices=False,
                    title=title,
                    inverse=inverse,
                )
            )
        elif geometry == "polygon":
            raw_pts = seg.get("points", [])
            flat: list[float] = []
            for pt in raw_pts:
                flat.append(float(pt[0]))
                flat.append(float(pt[1]))
            if len(flat) < 6:
                raise ValueError("Polygon ROI requires at least 3 vertices")
            roi.add_roi(
                PolygonalROI(flat, indices=False, title=title, inverse=inverse)
            )
        else:
            raise ValueError(f"Unknown ROI geometry: {geometry!r}")
    return roi


def set_image_roi(oid: str, segments: list[dict[str, Any]] | None) -> None:
    """Replace the ROI of image *oid* with *segments*.  Empty/None clears it."""
    if hasattr(segments, "to_py"):
        segments = segments.to_py()
    obj = _MODEL.get(oid)
    if not segments:
        obj.roi = None
        return
    obj.roi = _build_image_roi(obj, segments)


def delete_image_roi_at(oid: str, index: int) -> None:
    """Remove the ROI at *index* from image *oid* (no-op if oob)."""
    from sigima.objects.image.roi import ImageROI

    obj = _MODEL.get(oid)
    roi = obj.roi
    if roi is None or not roi.single_rois:
        return
    if 0 <= index < len(roi.single_rois):
        new_singles = list(roi.single_rois)
        del new_singles[index]
        if not new_singles:
            obj.roi = None
            return
        new_roi = ImageROI()
        for single in new_singles:
            new_roi.add_roi(single)
        obj.roi = new_roi


def extract_image_rois(oid: str, merged: bool) -> list[str]:
    """Extract the ROIs of image *oid* into one or several new images.

    Args:
        oid: Source image id.
        merged: When ``True`` produce a single output image containing the
            union of all ROIs (``sipi.extract_rois``).
            When ``False`` produce one image per ROI (``sipi.extract_roi``
            applied to each :class:`ROI2DParam`).

    Returns:
        Ids of the newly created images (in source order).  Empty when the
        source has no ROI.
    """
    obj = _MODEL.get(oid)
    roi = obj.roi
    if roi is None or not roi.single_rois:
        return []
    import sigima.proc.image as sipi

    panel = _MODEL._panels["image"]  # noqa: SLF001
    src_group_id: str | None = None
    try:
        src_group_id = panel.find_group_of(oid).gid
    except Exception:
        src_group_id = None
    params = [single.to_param(obj, i) for i, single in enumerate(roi.single_rois)]
    out_ids: list[str] = []
    if merged:
        result = sipi.extract_rois(obj, params)
        out_ids.append(_MODEL.add_object("image", result, group_id=src_group_id))
    else:
        for p in params:
            result = sipi.extract_roi(obj, p)
            out_ids.append(
                _MODEL.add_object("image", result, group_id=src_group_id)
            )
    return out_ids


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


def delete_signal_roi_at(oid: str, index: int) -> None:
    """Remove the ROI segment at *index* from signal *oid* (no-op if oob)."""
    obj = _MODEL.get(oid)
    roi = obj.roi
    if roi is None or not roi.single_rois:
        return
    if 0 <= index < len(roi.single_rois):
        # SignalROI.single_rois is a plain list — mutate in place.
        new_singles = list(roi.single_rois)
        del new_singles[index]
        if not new_singles:
            obj.roi = None
            return
        new_roi = SignalROI()
        for single in new_singles:
            new_roi.add_roi(single)
        obj.roi = new_roi


def extract_signal_rois(oid: str, merged: bool) -> list[str]:
    """Extract the ROIs of signal *oid* into one or several new signals.

    Args:
        oid: Source signal id.
        merged: When ``True`` produce a *single* output signal containing the
            concatenation of all ROIs (``sips.extract_rois``).
            When ``False`` produce *one signal per ROI* (``sips.extract_roi``
            applied to each ``ROI1DParam``).

    Returns:
        Ids of the newly created signals (in source order).  Empty list if
        the source has no ROI.
    """
    obj = _MODEL.get(oid)
    roi = obj.roi
    if roi is None or not roi.single_rois:
        return []
    import sigima.proc.signal as sips

    # Keep the source group so the extracted children land beside their parent.
    panel = _MODEL._panels["signal"]  # noqa: SLF001
    src_group_id: str | None = None
    try:
        src_group_id = panel.find_group_of(oid).gid
    except Exception:
        src_group_id = None
    params = [single.to_param(obj, i) for i, single in enumerate(roi.single_rois)]
    out_ids: list[str] = []
    if merged:
        result = sips.extract_rois(obj, params)
        out_ids.append(_MODEL.add_object("signal", result, group_id=src_group_id))
    else:
        for p in params:
            result = sips.extract_roi(obj, p)
            out_ids.append(
                _MODEL.add_object("signal", result, group_id=src_group_id)
            )
    return out_ids


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


# ---------------------------------------------------------------------------
# Signal analysis ("Analysis" menu) — DataLab parity.
#
# Each entry maps an analysis function name to the Sigima callable that
# produces a :class:`TableResult` or :class:`GeometryResult`.  Results are
# stored in ``obj.metadata`` exactly the way DataLab desktop does it
# (prefixed key ``"Table_<func>_dict"`` or ``"Geometry_<func>_dict"``) so
# project files round-trip 1:1 with the desktop application.
# ---------------------------------------------------------------------------


def _build_signal_analysis_catalog() -> "list[dict[str, Any]]":
    """Return the ordered catalog of signal-analysis features.

    Mirrors :class:`SignalActionHandler` in ``actionhandler.py`` (line 1419):
    same order, same labels, same icon names, same separator positions.
    """
    import sigima.proc.signal as sips

    return [
        {
            "id": "fwhm",
            "label": "Full width at half-maximum",
            "icon": "fwhm.svg",
            "func": sips.fwhm,
            "paramclass": sips.FWHMParam,
            "separator_before": False,
        },
        {
            "id": "fw1e2",
            "label": "Full width at 1/e²",
            "icon": "fw1e2.svg",
            "func": sips.fw1e2,
            "paramclass": None,
            "separator_before": False,
        },
        {
            "id": "full_width_at_y",
            "label": "Full width at y=…",
            "icon": "",
            "func": sips.full_width_at_y,
            "paramclass": sips.OrdinateParam,
            "separator_before": False,
        },
        {
            "id": "x_at_minmax",
            "label": "Abscissa of the minimum and maximum",
            "icon": "",
            "func": sips.x_at_minmax,
            "paramclass": None,
            "separator_before": False,
        },
        {
            "id": "x_at_y",
            "label": "First abscissa at y=…",
            "icon": "",
            "func": sips.x_at_y,
            "paramclass": sips.OrdinateParam,
            "separator_before": False,
        },
        {
            "id": "y_at_x",
            "label": "Ordinate at x=…",
            "icon": "",
            "func": sips.y_at_x,
            "paramclass": sips.AbscissaParam,
            "separator_before": False,
        },
        {
            "id": "extract_pulse_features",
            "label": "Extract pulse features",
            "icon": "",
            "func": sips.extract_pulse_features,
            "paramclass": sips.PulseFeaturesParam,
            "separator_before": False,
        },
        {
            "id": "sampling_rate_period",
            "label": "Sampling rate and period",
            "icon": "",
            "func": sips.sampling_rate_period,
            "paramclass": None,
            "separator_before": True,
        },
        {
            "id": "dynamic_parameters",
            "label": "Dynamic parameters",
            "icon": "",
            "func": sips.dynamic_parameters,
            "paramclass": sips.DynamicParam,
            "separator_before": False,
        },
        {
            "id": "bandwidth_3db",
            "label": "Bandwidth at -3dB",
            "icon": "",
            "func": sips.bandwidth_3db,
            "paramclass": None,
            "separator_before": False,
        },
        {
            "id": "contrast",
            "label": "Contrast",
            "icon": "",
            "func": sips.contrast,
            "paramclass": None,
            "separator_before": False,
        },
        {
            "id": "stats",
            "label": "Statistics",
            "icon": "stats.svg",
            "func": sips.stats,
            "paramclass": None,
            "separator_before": True,
        },
    ]


def _build_image_analysis_catalog() -> "list[dict[str, Any]]":
    """Return the ordered catalog of image-analysis features.

    Mirrors :class:`ImageActionHandler.register_analysis` in
    ``datalab/gui/processor/image.py``: same order, same labels, same
    icon names, same separator positions.  Only ``1_to_0`` entries are
    listed (i.e. analyses producing :class:`TableResult` /
    :class:`GeometryResult` results).  ``1_to_1`` analyses
    (horizontal/vertical projection, histogram) are exposed through the
    regular Operations/Processing menus.
    """
    import sigima.proc.image as sipi

    return [
        {
            "id": "stats",
            "label": "Statistics",
            "icon": "stats.svg",
            "func": sipi.stats,
            "paramclass": None,
            "separator_before": False,
        },
        {
            "id": "centroid",
            "label": "Centroid",
            "icon": "",
            "func": sipi.centroid,
            "paramclass": None,
            "separator_before": True,
        },
        {
            "id": "enclosing_circle",
            "label": "Minimum enclosing circle center",
            "icon": "",
            "func": sipi.enclosing_circle,
            "paramclass": None,
            "separator_before": False,
        },
        {
            "id": "contour_shape",
            "label": "Contour detection",
            "icon": "",
            "func": sipi.contour_shape,
            "paramclass": sipi.ContourShapeParam,
            "separator_before": True,
        },
        {
            "id": "peak_detection",
            "label": "Peak detection",
            "icon": "peak_detect.svg",
            "func": sipi.peak_detection,
            "paramclass": sipi.Peak2DDetectionParam,
            "separator_before": False,
        },
        {
            "id": "hough_circle_peaks",
            "label": "Circle Hough transform",
            "icon": "",
            "func": sipi.hough_circle_peaks,
            "paramclass": sipi.HoughCircleParam,
            "separator_before": False,
        },
        {
            "id": "blob_dog",
            "label": "Blob detection (DOG)",
            "icon": "",
            "func": sipi.blob_dog,
            "paramclass": sipi.BlobDOGParam,
            "separator_before": True,
        },
        {
            "id": "blob_doh",
            "label": "Blob detection (DOH)",
            "icon": "",
            "func": sipi.blob_doh,
            "paramclass": sipi.BlobDOHParam,
            "separator_before": False,
        },
        {
            "id": "blob_log",
            "label": "Blob detection (LOG)",
            "icon": "",
            "func": sipi.blob_log,
            "paramclass": sipi.BlobLOGParam,
            "separator_before": False,
        },
    ]


# Per-kind analysis catalog: {"signal": {func_id: entry}, "image": {...}}.
# Preserved across HMR so cached parameter values keep pointing at the
# right entries.
_ANALYSIS_CATALOG: dict[str, dict[str, dict[str, Any]]] = globals().get(
    "_ANALYSIS_CATALOG", {}
)
if not _ANALYSIS_CATALOG:
    _ANALYSIS_CATALOG["signal"] = {
        e["id"]: e for e in _build_signal_analysis_catalog()
    }
    _ANALYSIS_CATALOG["image"] = {
        e["id"]: e for e in _build_image_analysis_catalog()
    }


# Backwards-compat alias for any external code that still refers to it.
_SIGNAL_ANALYSIS = _ANALYSIS_CATALOG["signal"]


# Cached parameter instances per (kind, oid, func_id) so a parametric
# analysis can be re-opened with its previous values pre-filled.
_ANALYSIS_PARAMS: dict[str, Any] = globals().get("_ANALYSIS_PARAMS", {})


def list_signal_analysis() -> list[dict[str, Any]]:
    """Return the flat list of analysis entries that powers the menu.

    The order matches DataLab desktop's ``Analysis`` menu (separators
    included).  Each entry is JSON-friendly:

    .. code:: python

        {"id": "fwhm",
         "label": "Full width at half-maximum",
         "icon": "fwhm.svg",
         "separator_before": False,
         "has_params": True}
    """
    return _list_analysis_for_kind("signal")


def list_image_analysis() -> list[dict[str, Any]]:
    """Return the flat list of image-analysis entries (DataLab parity)."""
    return _list_analysis_for_kind("image")


def _list_analysis_for_kind(kind: str) -> list[dict[str, Any]]:
    catalog = _ANALYSIS_CATALOG.get(kind, {})
    return [
        {
            "id": e["id"],
            "label": e["label"],
            "icon": e["icon"],
            "separator_before": e["separator_before"],
            "has_params": e["paramclass"] is not None,
        }
        for e in catalog.values()
    ]


def _get_or_create_analysis_param(kind: str, oid: str, func_id: str) -> Any:
    catalog = _ANALYSIS_CATALOG.get(kind, {})
    if func_id not in catalog:
        raise KeyError(f"Unknown {kind} analysis function: {func_id!r}")
    entry = catalog[func_id]
    paramclass = entry["paramclass"]
    if paramclass is None:
        return None
    cache_key = f"{kind}::{oid}::{func_id}"
    cached = _ANALYSIS_PARAMS.get(cache_key)
    if cached is not None and isinstance(cached, paramclass):
        return cached
    param = paramclass()
    _ANALYSIS_PARAMS[cache_key] = param
    return param


def get_signal_analysis_param_schema(
    oid: str, func_id: str
) -> dict[str, Any] | None:
    """Return the JSON schema for *func_id*'s parameter set, with the
    cached values for *oid* pre-filled.  Returns ``None`` for parameter-
    less analyses."""
    return _get_analysis_param_schema("signal", oid, func_id)


def get_image_analysis_param_schema(
    oid: str, func_id: str
) -> dict[str, Any] | None:
    """Image-side counterpart of :func:`get_signal_analysis_param_schema`."""
    return _get_analysis_param_schema("image", oid, func_id)


def _get_analysis_param_schema(
    kind: str, oid: str, func_id: str
) -> dict[str, Any] | None:
    from guidata.dataset import dataset_to_schema_with_values

    param = _get_or_create_analysis_param(kind, oid, func_id)
    if param is None:
        return None
    return dataset_to_schema_with_values(param)


def _result_metadata_key(result: Any) -> str:
    """Return the metadata key used to store *result*.  Mirrors DataLab's
    :class:`BaseResultAdapter.metadata_key`."""
    from sigima.objects.scalar import GeometryResult, TableResult

    func_name = getattr(result, "func_name", None) or "result"
    if isinstance(result, GeometryResult):
        return f"Geometry_{func_name}_dict"
    if isinstance(result, TableResult):
        return f"Table_{func_name}_dict"
    raise TypeError(f"Unsupported analysis result type: {type(result).__name__}")


def _build_pulse_overlays(result: Any, obj: Any) -> list[dict[str, Any]]:
    """Build segment / vertical-line overlays for a pulse-features
    :class:`TableResult` so the front-end can render the same
    measurement geometry as DataLab desktop.

    Mirrors :class:`datalab.adapters_plotpy.objects.scalar.
    TablePlotPyAdapter.create_pulse_visualization_items`.
    """
    from sigima.tools.signal import pulse

    overlays: list[dict[str, Any]] = []
    headers = list(result.headers)
    seg_color = "#33ff00"
    vline_color = "#a7ff33"
    x_arr = obj.x
    y_arr = obj.y

    def _idx(name: str) -> int | None:
        try:
            return headers.index(name)
        except ValueError:
            return None

    def _valid(*vs: Any) -> bool:
        for v in vs:
            if v is None:
                return False
            try:
                if isinstance(v, float) and (v != v):  # NaN
                    return False
            except Exception:
                return False
        return True

    def _push_segment(
        x0: float, y0: float, x1: float, y1: float, label: str
    ) -> None:
        overlays.append(
            {
                "kind": "segment",
                "x0": float(x0),
                "y0": float(y0),
                "x1": float(x1),
                "y1": float(y1),
                "label": label,
                "color": seg_color,
            }
        )

    def _push_vline(x: float, label: str) -> None:
        overlays.append(
            {
                "kind": "vline",
                "x": float(x),
                "label": label,
                "color": vline_color,
            }
        )

    i_xs0, i_xs1 = _idx("xstartmin"), _idx("xstartmax")
    i_xe0, i_xe1 = _idx("xendmin"), _idx("xendmax")
    i_xp0, i_xp1 = _idx("xplateaumin"), _idx("xplateaumax")
    i_x0 = _idx("x0")
    i_x50 = _idx("x50")
    i_x100 = _idx("x100")

    for row in result.data:
        if i_xs0 is not None and i_xs1 is not None:
            xs0, xs1 = row[i_xs0], row[i_xs1]
            if _valid(xs0, xs1):
                ys = pulse.get_range_mean_y(x_arr, y_arr, (xs0, xs1))
                if _valid(ys):
                    _push_segment(xs0, ys, xs1, ys, "Start baseline")
        if i_xe0 is not None and i_xe1 is not None:
            xe0, xe1 = row[i_xe0], row[i_xe1]
            if _valid(xe0, xe1):
                ye = pulse.get_range_mean_y(x_arr, y_arr, (xe0, xe1))
                if _valid(ye):
                    _push_segment(xe0, ye, xe1, ye, "End baseline")
        if i_xp0 is not None and i_xp1 is not None:
            xp0, xp1 = row[i_xp0], row[i_xp1]
            if _valid(xp0, xp1):
                yp = pulse.get_range_mean_y(x_arr, y_arr, (xp0, xp1))
                if _valid(yp):
                    _push_segment(xp0, yp, xp1, yp, "Plateau")
        for i_x, label in (
            (i_x0, "x₀"),
            (i_x50, "x₅₀"),
            (i_x100, "x₁₀₀"),
        ):
            if i_x is None:
                continue
            xv = row[i_x]
            if _valid(xv):
                _push_vline(xv, label)
    return overlays


def _serialize_result(
    result: Any, key: str, obj: Any | None = None
) -> dict[str, Any]:
    """Build a JSON-friendly payload describing one analysis result."""
    from sigima.objects.scalar import GeometryResult, TableResult

    payload: dict[str, Any] = {
        "metadata_key": key,
        "title": result.title,
        "func_name": getattr(result, "func_name", None),
    }
    if isinstance(result, GeometryResult):
        payload["category"] = "geometry"
        payload["kind"] = result.kind.value
        payload["coords"] = result.coords.tolist()
        payload["headers"] = list(result.headers)
        payload["roi_indices"] = (
            None if result.roi_indices is None else result.roi_indices.tolist()
        )
    elif isinstance(result, TableResult):
        payload["category"] = "table"
        payload["kind"] = (
            result.kind.value if hasattr(result.kind, "value") else result.kind
        )
        payload["headers"] = list(result.headers)
        # Coerce numpy scalars to plain floats / ints for JSON.
        rows: list[list[Any]] = []
        for row in result.data:
            new_row: list[Any] = []
            for v in row:
                if isinstance(v, (bytes, bytearray)):
                    new_row.append(v.decode("utf-8", errors="replace"))
                elif hasattr(v, "item"):
                    try:
                        new_row.append(v.item())
                    except (TypeError, ValueError):
                        new_row.append(str(v))
                else:
                    new_row.append(v)
            rows.append(new_row)
        payload["data"] = rows
        payload["roi_indices"] = (
            None if result.roi_indices is None else list(result.roi_indices)
        )
        # Pulse-features tables get plot overlays mirroring DataLab Qt
        # (start/end baseline + plateau segments, x₀/x₅₀/x₁₀₀ vlines).
        try:
            is_pulse = result.is_pulse_features()
        except Exception:
            is_pulse = False
        if is_pulse and obj is not None:
            try:
                overlays = _build_pulse_overlays(result, obj)
            except Exception:  # pragma: no cover — defensive
                overlays = []
            if overlays:
                payload["overlays"] = overlays
    else:  # pragma: no cover — guarded by _result_metadata_key
        raise TypeError(f"Unsupported analysis result: {type(result).__name__}")
    return payload


def run_signal_analysis(
    oid: str, func_id: str, params: Any = None
) -> dict[str, Any] | None:
    """Run analysis *func_id* on signal *oid* and persist the result.

    Args:
        oid: Object id of the source signal.
        func_id: Analysis function id (see :func:`list_signal_analysis`).
        params: Optional parameter values for parametric analyses.  Either
         a dict (from JS) or an already-built guidata DataSet instance.

    Returns:
        A JSON-friendly description of the produced result, or ``None`` if
        the function returned no result (some analyses return ``None`` —
        e.g. ``fwhm`` on a flat signal).
    """
    return _run_analysis("signal", oid, func_id, params)


def run_image_analysis(
    oid: str, func_id: str, params: Any = None
) -> dict[str, Any] | None:
    """Image-side counterpart of :func:`run_signal_analysis`."""
    return _run_analysis("image", oid, func_id, params)


def _run_analysis(
    kind: str, oid: str, func_id: str, params: Any = None
) -> dict[str, Any] | None:
    catalog = _ANALYSIS_CATALOG.get(kind, {})
    if func_id not in catalog:
        raise KeyError(f"Unknown {kind} analysis function: {func_id!r}")
    entry = catalog[func_id]
    obj = _MODEL.get(oid)

    if hasattr(params, "to_py"):
        params = params.to_py()

    param = _get_or_create_analysis_param(kind, oid, func_id)
    if param is not None and isinstance(params, dict):
        from guidata.dataset import update_dataset

        update_dataset(param, params)

    if param is None:
        result = entry["func"](obj)
    else:
        result = entry["func"](obj, param)

    if result is None:
        return None
    # Make sure func_name is set for metadata-key consistency with DataLab.
    if not getattr(result, "func_name", None):
        try:
            object.__setattr__(result, "func_name", func_id)
        except Exception:  # pragma: no cover — frozen dataclass safety net
            pass
    key = _result_metadata_key(result)
    obj.metadata[key] = result.to_dict()
    return _serialize_result(result, key, obj)


def list_signal_results(oid: str) -> list[dict[str, Any]]:
    """Return every analysis result currently stored on signal *oid*.

    Reconstructs each result from the metadata dict, in the same order
    the keys appear (which matches insertion order in CPython ≥3.7 and
    Pyodide).  Used by the front-end to redraw overlays after refresh,
    project load, or HMR reload.
    """
    from sigima.objects.scalar import GeometryResult, TableResult

    obj = _MODEL.get(oid)
    out: list[dict[str, Any]] = []
    for key, value in obj.metadata.items():
        if not isinstance(value, dict):
            continue
        if key.startswith("Geometry_") and key.endswith("_dict"):
            try:
                result = GeometryResult.from_dict(value)
            except Exception:  # pragma: no cover — malformed metadata
                continue
            out.append(_serialize_result(result, key, obj))
        elif key.startswith("Table_") and key.endswith("_dict"):
            try:
                result = TableResult.from_dict(value)
            except Exception:  # pragma: no cover — malformed metadata
                continue
            out.append(_serialize_result(result, key, obj))
    return out


def clear_signal_results(oid: str, metadata_key: str | None = None) -> int:
    """Drop one or all analysis results from signal *oid*'s metadata.

    Args:
        oid: Source signal id.
        metadata_key: If given, drop only that key.  Otherwise drop every
         ``Table_*_dict`` and ``Geometry_*_dict`` entry.

    Returns:
        Number of metadata keys removed.
    """
    obj = _MODEL.get(oid)
    if metadata_key is not None:
        return 1 if obj.metadata.pop(metadata_key, None) is not None else 0
    to_drop = [
        k
        for k in list(obj.metadata.keys())
        if (k.startswith("Geometry_") or k.startswith("Table_"))
        and k.endswith("_dict")
    ]
    for k in to_drop:
        obj.metadata.pop(k, None)
    return len(to_drop)


# The result-storage mechanism is metadata-based and therefore identical
# for signals and images.  Aliases keep the JS bridge symmetric.
list_image_results = list_signal_results
clear_image_results = clear_signal_results


__all__ = [
    "ObjectModel",
    "create_signal",
    "create_signal_typed",
    "list_signal_creation_types",
    "get_creation_param_schema",
    "update_signal_creation_params",
    "get_object_property_schema",
    "set_object_property_values",
    "get_object_stats",
    "list_object_metadata",
    "set_object_metadata_value",
    "delete_object_metadata_key",
    "list_signal_io_formats",
    "open_signal_from_bytes",
    "save_signal_to_bytes",
    "list_signals",
    "get_signal_xy",
    "delete_signal",
    "create_image",
    "create_image_typed",
    "list_image_creation_types",
    "update_image_creation_params",
    "get_image_data",
    "get_image_roi",
    "set_image_roi",
    "delete_image_roi_at",
    "extract_image_rois",
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
    "delete_signal_roi_at",
    "extract_signal_rois",
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
    "list_signal_analysis",
    "get_signal_analysis_param_schema",
    "run_signal_analysis",
    "list_signal_results",
    "clear_signal_results",
    "list_image_analysis",
    "get_image_analysis_param_schema",
    "run_image_analysis",
    "list_image_results",
    "clear_image_results",
]
