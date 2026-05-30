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

# bootstrap.py introspects its own ``ObjectModel`` internals (``_panels``,
# ``_objects``) when serialising/deserialising HDF5 workspaces — the ``noqa:
# SLF001`` markers already document each access for ruff. The HDF5 helpers
# also lazily import heavy optional dependencies (``os``, ``tempfile``,
# ``re``, ``guidata.io``…) inside the function body so the module loads
# fast in Pyodide. ``except Exception`` is the desktop-DataLab convention
# for "best-effort H5 read; never abort on a malformed dataset".
# pylint: disable=protected-access,import-outside-toplevel,broad-exception-caught

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Iterable

import dlw_interactive_fit as _ifit

# ``dlw_processor`` / ``dlw_interactive_fit`` / ``dlw_h5browser`` are
# sibling modules pushed into Pyodide's filesystem alongside this one;
# pylint sees them as third-party because they live outside any package.
# pylint: disable=wrong-import-order,ungrouped-imports,import-error
# NOTE on locale / translations:
# ``runtime.ts`` (and ``macroWorker.ts`` / ``notebookWorker.ts`` for the
# secondary Pyodide instances) pin ``os.environ["LANG"]`` *before* this
# module — and before any ``guidata`` import — to the value derived from
# the active UI locale (``C`` for English, or e.g. ``fr``). All
# ``gettext _()``-wrapped labels coming from ``sigima`` / ``guidata``
# (e.g. ``SignalTypes.label``, ``ImageTypes.label``, processing names,
# parameter labels…) are then returned in the matching language and stay
# consistent with the React UI. Do NOT set ``LANG`` here:
# ``guidata.configtools.get_translation`` caches the translation object
# at first import, so any change made from this module would already be
# too late — and switching language is handled by a full page reload, so
# a fresh Pyodide instance always boots with the right ``LANG``. See the
# "Internationalisation" section of ``README.md``.
import dlw_processor as _proc

# ``dlw_title_format`` installs Sigima's ``PlaceholderTitleFormatter`` as
# the default. Imported for its side-effect; the actual substitution of
# placeholders with source-object short IDs is done by
# :func:`patch_title_with_ids` below, invoked from :func:`apply_feature`.
import dlw_title_format  # noqa: F401  # pylint: disable=unused-import
import numpy as np
import sigima
from dlw_macro_lint import lint_macro
from sigima.objects import SignalObj
from sigima.objects.signal.creation import (
    SIGNAL_TYPE_PARAM_CLASSES,
    SignalTypes,
    create_signal_parameters,
)
from sigima.objects.signal.roi import SignalROI

# Re-export interactive-fit helpers as module-level callables so the JS
# runtime can resolve them via ``py.globals.get(...)``.
list_interactive_fits = _ifit.list_interactive_fits
init_interactive_fit = _ifit.init_interactive_fit
evaluate_interactive_fit = _ifit.evaluate_interactive_fit
auto_fit_interactive = _ifit.auto_fit_interactive
commit_interactive_fit = _ifit.commit_interactive_fit


# ---------------------------------------------------------------------------
# Object model
# ---------------------------------------------------------------------------


def _new_id(prefix: str = "") -> str:
    """Return a short, unique identifier (optionally prefixed)."""
    return f"{prefix}{uuid.uuid4().hex[:8]}"


# Locale-aware default labels. Unlike sigima/guidata strings (translated via
# gettext, see the locale note above), bootstrap.py is DataLab-Web's own code,
# so its few user-facing defaults — the "Group" prefix for auto-created groups
# and the "Untitled" macro/notebook title — are bridged explicitly: the React
# side owns the translations and pushes them in via :func:`set_default_labels`
# right after this module is first executed (see ``runtime.ts``). Preserved
# across HMR re-executions so the active locale survives a helper reload.
_DEFAULT_LABELS: dict[str, str] = globals().get(  # type: ignore[assignment]
    "_DEFAULT_LABELS", {"group": "Group", "untitled": "Untitled"}
)


def set_default_labels(group: str | None = None, untitled: str | None = None) -> None:
    """Set locale-aware default labels for new groups, macros and notebooks.

    Called once from the JS runtime at start-up with the strings already
    translated for the active UI locale.

    Args:
        group: Translated default group-name prefix (e.g. ``"Groupe"``).
        untitled: Translated default macro/notebook title (e.g. ``"Sans titre"``).
    """
    if group:
        _DEFAULT_LABELS["group"] = group
    if untitled:
        _DEFAULT_LABELS["untitled"] = untitled


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
    default_group_name: str = field(default_factory=lambda: _DEFAULT_LABELS["group"])

    def ensure_default_group(self) -> _Group:
        """Return the first group, creating one when the panel is empty."""
        if not self.groups:
            self.groups.append(
                _Group(gid=_new_id("g"), name=f"{self.default_group_name} 1")
            )
        return self.groups[0]

    def find_group(self, gid: str) -> _Group:
        """Return the group with id *gid* (raises :class:`KeyError`)."""
        for g in self.groups:
            if g.gid == gid:
                return g
        raise KeyError(f"Unknown group: {gid!r}")

    def find_group_of(self, oid: str) -> _Group:
        """Return the group containing object *oid*."""
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
        """Return (creating on first access) the panel for *kind*."""
        if kind not in self._panels:
            self._panels[kind] = _Panel(kind=kind)
        return self._panels[kind]

    # -- Object access ------------------------------------------------------

    def get(self, oid: str) -> Any:
        """Return the object identified by *oid*."""
        return self._objects[oid].obj

    def kind_of(self, oid: str) -> str:
        """Return the panel kind hosting object *oid*."""
        return self._objects[oid].kind

    def has(self, oid: str) -> bool:
        """Return True if *oid* is a known object id."""
        return oid in self._objects

    # -- Object mutation ----------------------------------------------------

    def add_object(self, kind: str, obj: Any, group_id: str | None = None) -> str:
        """Insert *obj* in *kind*'s panel (in *group_id* or default group)."""
        panel = self.panel(kind)
        group = panel.find_group(group_id) if group_id else panel.ensure_default_group()
        oid = _new_id()
        self._objects[oid] = _ObjectEntry(oid=oid, kind=kind, obj=obj)
        group.object_ids.append(oid)
        return oid

    def delete_object(self, oid: str) -> None:
        """Remove object *oid* from its panel (silent no-op if absent)."""
        if oid not in self._objects:
            return
        kind = self._objects[oid].kind
        self._objects.pop(oid)
        panel = self.panel(kind)
        for g in panel.groups:
            if oid in g.object_ids:
                g.object_ids.remove(oid)
                break

    def move_object(
        self, oid: str, target_group_id: str, target_index: int = -1
    ) -> None:
        """Move object *oid* to *target_group_id* within its panel.

        *target_index* is the insertion position in the destination group,
        computed **after** the object has been removed from its source group.
        Use ``-1`` (default) to append at the end. The index is clamped to
        the valid range; same-group reorders are supported.
        """
        self.move_objects([oid], target_group_id, target_index)

    def move_objects(
        self, oids: list[str], target_group_id: str, target_index: int = -1
    ) -> None:
        """Move multiple objects to *target_group_id*, preserving *oids* order.

        All *oids* must belong to the same panel kind. *target_index* is
        the insertion position in the destination group, computed **after**
        all moved objects have been removed from their current groups
        (use ``-1`` to append at the end). No-op when *oids* is empty.
        """
        if not oids:
            return
        kind = self._objects[oids[0]].kind
        panel = self.panel(kind)
        target = panel.find_group(target_group_id)
        moved = set(oids)
        # Compute insertion index relative to the target group *after* removal
        # of moved objects (so callers can pass the visible drop position).
        target_remaining = [x for x in target.object_ids if x not in moved]
        if target_index < 0 or target_index > len(target_remaining):
            insert_at = len(target_remaining)
        else:
            insert_at = target_index
        # Remove moved objects from every group of the panel.
        for g in panel.groups:
            if any(x in moved for x in g.object_ids):
                g.object_ids = [x for x in g.object_ids if x not in moved]
        # Insert at the computed position, preserving caller-provided order.
        target.object_ids[insert_at:insert_at] = list(oids)

    def move_object_in_group(self, oid: str, delta: int) -> None:
        """Reorder object *oid* within its current group by *delta*.

        ``delta = -1`` moves the object one slot up, ``+1`` moves it one slot
        down. The operation is clamped so the object never falls outside the
        group bounds (silent no-op when already at the boundary).
        """
        if delta == 0:
            return
        kind = self._objects[oid].kind
        panel = self.panel(kind)
        group = panel.find_group_of(oid)
        idx = group.object_ids.index(oid)
        new_idx = max(0, min(len(group.object_ids) - 1, idx + delta))
        if new_idx == idx:
            return
        group.object_ids.remove(oid)
        group.object_ids.insert(new_idx, oid)

    def duplicate_object(self, oid: str) -> str:
        """Insert a deep copy of object *oid* right after it in its group."""
        entry = self._objects[oid]
        new_obj = entry.obj.copy()
        new_oid = _new_id()
        self._objects[new_oid] = _ObjectEntry(oid=new_oid, kind=entry.kind, obj=new_obj)
        panel = self.panel(entry.kind)
        group = panel.find_group_of(oid)
        idx = group.object_ids.index(oid)
        group.object_ids.insert(idx + 1, new_oid)
        return new_oid

    def rename_object(self, oid: str, name: str) -> None:
        """Rename object *oid* in place."""
        obj = self._objects[oid].obj
        obj.title = name

    # -- Group mutation -----------------------------------------------------

    def create_group(self, kind: str, name: str | None = None) -> str:
        """Create a new group on *kind* and return its gid."""
        panel = self.panel(kind)
        if name is None:
            name = f"{panel.default_group_name} {len(panel.groups) + 1}"
        gid = _new_id("g")
        panel.groups.append(_Group(gid=gid, name=name))
        return gid

    def rename_group(self, kind: str, gid: str, name: str) -> None:
        """Rename group *gid* of *kind* in place."""
        self.panel(kind).find_group(gid).name = name

    def delete_group(self, kind: str, gid: str) -> None:
        """Delete group *gid* of *kind* and all its objects."""
        panel = self.panel(kind)
        group = panel.find_group(gid)
        for oid in list(group.object_ids):
            self.delete_object(oid)
        panel.groups.remove(group)
        # Always keep at least one group available for fresh additions.
        panel.ensure_default_group()

    # -- Serialisation ------------------------------------------------------

    def panel_tree(self, kind: str) -> dict[str, Any]:
        """Return the JSON-friendly tree of groups and objects for *kind*."""
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
        """Iterate over ``(oid, obj)`` pairs of *kind*."""
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
            "style": _signal_style(obj),
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


def _signal_style(obj: Any) -> dict[str, Any]:
    """Extract optional per-curve style from a SignalObj's metadata.

    Sigima/PlotPy persist ``color`` / ``linestyle`` / ``linewidth`` (and
    a few sibling keys) under the object's ``metadata`` dict so they
    survive copy/save/restore.  Missing fields are returned as ``None``
    so the front-end can fall back to the cycling palette.
    """
    md = getattr(obj, "metadata", None) or {}
    color = md.get("color") or md.get("curvecolor")
    linestyle = md.get("linestyle") or md.get("line_style")
    linewidth = md.get("linewidth") or md.get("line_width")
    curvestyle = md.get("curvestyle") or md.get("curve_style")
    try:
        linewidth = float(linewidth) if linewidth is not None else None
    except (TypeError, ValueError):
        linewidth = None
    return {
        "color": str(color) if color else None,
        "linestyle": str(linestyle) if linestyle else None,
        "linewidth": linewidth,
        "curvestyle": str(curvestyle) if curvestyle else None,
    }


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
            output_kind=spec.output_kind,
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
# Macro store (mirrors DataLab Qt's MacroPanel state)
# ---------------------------------------------------------------------------

# In-memory list of macros: ``[{"id": str, "title": str, "code": str}, ...]``.
# Order matters (mirrors Qt tab order) — preserved across HMR re-executions.
_MACROS: list[dict[str, str]] = globals().get("_MACROS", [])  # type: ignore[assignment]


_MACRO_SAMPLE_TITLE = "Untitled 1"
_MACRO_SAMPLE_CODE = """# Macro simple example

import numpy as np

# `proxy` is pre-injected (DataLab-Web equivalent of RemoteProxy).
# All proxy methods are async — use `await`.
# Available methods: add_signal, add_image, calc, get_object,
# list_signals, list_images, set_current_panel, call_method, ...

x = np.linspace(-10, 10, 500)
y = np.sin(x) / (x + 1e-9)
oid = await proxy.add_signal("sinc", x, y)
print(f"Created signal {oid}")

print("All done!")
"""


def _macro_index(macro_id: str) -> int:
    for idx, m in enumerate(_MACROS):
        if m["id"] == macro_id:
            return idx
    raise KeyError(f"Unknown macro: {macro_id!r}")


def _next_untitled_title() -> str:
    """Return a unique ``"Untitled N"`` title."""
    used = {m["title"] for m in _MACROS}
    base = _DEFAULT_LABELS["untitled"]
    n = 1
    while f"{base} {n}" in used:
        n += 1
    return f"{base} {n}"


def list_macros() -> list[dict[str, str]]:
    """Return a JSON-friendly snapshot of every macro (id + title only)."""
    return [{"id": m["id"], "title": m["title"]} for m in _MACROS]


def get_macro(macro_id: str) -> dict[str, str]:
    """Return ``{id, title, code}`` for *macro_id*."""
    return dict(_MACROS[_macro_index(macro_id)])


def create_macro(title: str | None = None, code: str | None = None) -> dict[str, str]:
    """Create a new macro and return its full record."""
    new_title = title if title else _next_untitled_title()
    new_code = code if code is not None else _MACRO_SAMPLE_CODE
    record = {"id": _new_id("m"), "title": new_title, "code": new_code}
    _MACROS.append(record)
    return dict(record)


def set_macro_code(macro_id: str, code: str) -> None:
    """Update the code of *macro_id*."""
    _MACROS[_macro_index(macro_id)]["code"] = code


def rename_macro(macro_id: str, title: str) -> None:
    """Rename macro *macro_id*."""
    _MACROS[_macro_index(macro_id)]["title"] = title or _DEFAULT_LABELS["untitled"]


def delete_macro(macro_id: str) -> None:
    """Remove macro *macro_id* from the store."""
    _MACROS.pop(_macro_index(macro_id))


def duplicate_macro(macro_id: str) -> dict[str, str]:
    """Insert a copy of *macro_id* right after it; return the new record."""
    idx = _macro_index(macro_id)
    src = _MACROS[idx]
    record = {
        "id": _new_id("m"),
        "title": f"{src['title']} (copy)",
        "code": src["code"],
    }
    _MACROS.insert(idx + 1, record)
    return dict(record)


def reorder_macros(macro_ids: Any) -> None:
    """Reorder ``_MACROS`` according to *macro_ids* (must contain every id)."""
    if hasattr(macro_ids, "to_py"):
        macro_ids = macro_ids.to_py()
    new_order: list[dict[str, str]] = []
    by_id = {m["id"]: m for m in _MACROS}
    for mid in macro_ids:
        if mid in by_id:
            new_order.append(by_id.pop(mid))
    # Append any leftovers (defensive — should not happen).
    new_order.extend(by_id.values())
    _MACROS[:] = new_order


def replace_macros(records: Any) -> None:
    """Replace the whole macro store (used for localStorage restore)."""
    if hasattr(records, "to_py"):
        records = records.to_py()
    cleaned: list[dict[str, str]] = []
    for rec in records or []:
        rid = str(rec.get("id") or _new_id("m"))
        title = str(rec.get("title") or _DEFAULT_LABELS["untitled"])
        code = str(rec.get("code") or "")
        cleaned.append({"id": rid, "title": title, "code": code})
    _MACROS[:] = cleaned


# ---------------------------------------------------------------------------
# Notebook store (mirrors :data:`_MACROS` for Jupyter-style notebooks)
# ---------------------------------------------------------------------------
#
# Notebooks are stored as opaque ``nbformat`` v4.5 JSON strings — the
# Python side does not parse them.  This keeps the bootstrap layer
# symmetric with macros (``code`` ⇄ ``content``) and lets the JS
# notebook UI remain the sole owner of the nbformat schema.

_NOTEBOOKS: list[dict[str, str]] = globals().get(  # type: ignore[assignment]
    "_NOTEBOOKS", []
)


def _notebook_index(notebook_id: str) -> int:
    for idx, n in enumerate(_NOTEBOOKS):
        if n["id"] == notebook_id:
            return idx
    raise KeyError(f"Unknown notebook: {notebook_id!r}")


def _next_untitled_notebook_title() -> str:
    """Return a unique ``"Untitled N"`` notebook title."""
    used = {n["title"] for n in _NOTEBOOKS}
    base = _DEFAULT_LABELS["untitled"]
    n = 1
    while f"{base} {n}" in used:
        n += 1
    return f"{base} {n}"


def list_notebooks() -> list[dict[str, str]]:
    """Return a JSON-friendly snapshot of every notebook (id + title only)."""
    return [{"id": n["id"], "title": n["title"]} for n in _NOTEBOOKS]


def get_notebook(notebook_id: str) -> dict[str, str]:
    """Return ``{id, title, content}`` for *notebook_id*."""
    return dict(_NOTEBOOKS[_notebook_index(notebook_id)])


def create_notebook(
    title: str | None = None, content: str | None = None
) -> dict[str, str]:
    """Create a new notebook and return its full record.

    *content* must be a serialised nbformat v4.5 JSON string.  When
    omitted, an empty string is stored — the JS layer is then expected
    to push an initial template via :func:`set_notebook_content`.
    """
    new_title = title if title else _next_untitled_notebook_title()
    new_content = content if content is not None else ""
    record = {"id": _new_id("n"), "title": new_title, "content": new_content}
    _NOTEBOOKS.append(record)
    return dict(record)


def set_notebook_content(notebook_id: str, content: str) -> None:
    """Update the nbformat JSON content of *notebook_id*."""
    _NOTEBOOKS[_notebook_index(notebook_id)]["content"] = content


def rename_notebook(notebook_id: str, title: str) -> None:
    """Rename notebook *notebook_id*."""
    _NOTEBOOKS[_notebook_index(notebook_id)]["title"] = (
        title or _DEFAULT_LABELS["untitled"]
    )


def delete_notebook(notebook_id: str) -> None:
    """Remove notebook *notebook_id* from the store."""
    _NOTEBOOKS.pop(_notebook_index(notebook_id))


def duplicate_notebook(notebook_id: str) -> dict[str, str]:
    """Insert a copy of *notebook_id* right after it; return the new record."""
    idx = _notebook_index(notebook_id)
    src = _NOTEBOOKS[idx]
    record = {
        "id": _new_id("n"),
        "title": f"{src['title']} (copy)",
        "content": src["content"],
    }
    _NOTEBOOKS.insert(idx + 1, record)
    return dict(record)


def reorder_notebooks(notebook_ids: Any) -> None:
    """Reorder ``_NOTEBOOKS`` according to *notebook_ids* (must contain every id)."""
    if hasattr(notebook_ids, "to_py"):
        notebook_ids = notebook_ids.to_py()
    new_order: list[dict[str, str]] = []
    by_id = {n["id"]: n for n in _NOTEBOOKS}
    for nid in notebook_ids:
        if nid in by_id:
            new_order.append(by_id.pop(nid))
    # Append any leftovers (defensive — should not happen).
    new_order.extend(by_id.values())
    _NOTEBOOKS[:] = new_order


def replace_notebooks(records: Any) -> None:
    """Replace the whole notebook store (used for IndexedDB restore)."""
    if hasattr(records, "to_py"):
        records = records.to_py()
    cleaned: list[dict[str, str]] = []
    for rec in records or []:
        rid = str(rec.get("id") or _new_id("n"))
        title = str(rec.get("title") or _DEFAULT_LABELS["untitled"])
        content = str(rec.get("content") or "")
        cleaned.append({"id": rid, "title": title, "content": content})
    _NOTEBOOKS[:] = cleaned


# ---------------------------------------------------------------------------
# Plugin system bootstrap
# ---------------------------------------------------------------------------


def _plugin_features_for_kind(kind: str) -> dict[str, _proc.FeatureSpec]:
    """Return ``{feature_id: FeatureSpec}`` for plugin contributions."""
    return _proc.merge_plugin_features({}, kind)


def _full_catalog_with_plugins() -> dict[str, _proc.FeatureSpec]:
    """Return the curated catalogue augmented with plugin features."""
    cat = dict(_CATALOG)
    for kind in ("signal", "image"):
        cat.update(_plugin_features_for_kind(kind))
    return cat


# JavaScript dialog bridge — set by ``runtime.ts`` via ``set_dialog_bridge``.
# Signature: ``async (kind: str, payload: dict) -> Any``.
_DIALOG_BRIDGE: Any = globals().get("_DIALOG_BRIDGE", None)


def set_dialog_bridge(bridge: Any) -> None:
    """Install the JS bridge used by async guidata/datalab dialogs."""
    global _DIALOG_BRIDGE  # pylint: disable=global-statement  # singleton bridge
    _DIALOG_BRIDGE = bridge


def _require_bridge(slot: str) -> Any:
    if _DIALOG_BRIDGE is None:
        raise RuntimeError(
            f"Dialog bridge missing — cannot service {slot!r}. "
            "Call sigima.setDialogHandler(...) on the JS side first."
        )
    return _DIALOG_BRIDGE


def _to_js_payload(payload: dict) -> Any:
    """Convert *payload* to a plain JS object before crossing the bridge.

    Without this, Pyodide hands JS a ``PyProxy`` of the dict.  The JS bridge
    then converts + destroys the proxy explicitly, but Pyodide's
    ``FinalizationRegistry`` still tries to register the same proxy on the
    next GC cycle — finding it destroyed and aborting the WASM runtime
    ("Object has already been destroyed", from ``gc_register_proxies``).
    Converting on the Python side avoids any PyProxy ever existing on JS.
    """
    try:
        from js import Object  # type: ignore[import-not-found]
        from pyodide.ffi import to_js  # type: ignore[import-not-found]
    except Exception:  # pragma: no cover - non-Pyodide environments (tests)
        return payload
    return to_js(payload, dict_converter=Object.fromEntries)


async def _async_edit_dataset(
    instance: Any, parent: Any = None, **_kwargs: Any
) -> bool:
    """Async :meth:`DataSet.edit` handler routed through the JS bridge."""
    del parent  # signature compat with guidata's sync ``edit`` API
    from guidata.dataset import dataset_to_schema_with_values, update_dataset

    bridge = _require_bridge("edit_dataset_async")
    payload = dataset_to_schema_with_values(instance)
    payload["title"] = getattr(instance, "_title", None) or type(instance).__name__
    result = await bridge("edit_dataset", _to_js_payload(payload))
    if hasattr(result, "to_py"):
        result = result.to_py()
    if not result:
        return False
    update_dataset(instance, result)
    return True


async def _async_show_message(
    kind: str, message: str, title: str | None = None, **_kwargs: Any
) -> None:
    bridge = _require_bridge("show_message_async")
    await bridge(
        "message",
        _to_js_payload({"kind": kind, "message": message, "title": title or ""}),
    )


async def _async_ask_question(
    message: str, title: str | None = None, cancelable: bool = False, **_kwargs: Any
) -> bool | None:
    bridge = _require_bridge("ask_question_async")
    result = await bridge(
        "confirm",
        _to_js_payload(
            {
                "message": message,
                "title": title or "",
                "cancelable": bool(cancelable),
            }
        ),
    )
    if hasattr(result, "to_py"):
        result = result.to_py()
    return result


def _install_datalab_shim() -> None:
    """Wire the portable ``datalab.*`` shim to the live bootstrap.

    Idempotent — safe to call from HMR re-execution. Installs:

    * the ``WebMainBridge`` into :class:`datalab.gui.main.DLMainWindow`;
    * the async dialog handlers into the guidata + datalab registries;
    * the bridge into :mod:`dlw_plugins` so plugin ``register()`` works.
    """
    try:
        import dlw_main as _dlw_main
        import dlw_plugins as _dlw_plugins
        from datalab import helpers as _dl_helpers
        from datalab.gui.main import install_main as _install_main
        from guidata.dataset import backends as _gds_backends
    except Exception:  # pragma: no cover - shim missing in standalone tests
        print("[bootstrap] datalab.* shim unavailable; plugins disabled")
        return

    bridge_main = _dlw_main.WebMainBridge()
    main = _install_main(bridge_main)
    _dlw_plugins.install_main(main)

    # Async guidata backend
    _gds_backends.set_handler("edit_dataset_async", _async_edit_dataset)

    # Async datalab.helpers backend
    _dl_helpers.set_handler("show_message_async", _async_show_message)
    _dl_helpers.set_handler("ask_question_async", _async_ask_question)


# Install once per cold-start; re-installation is idempotent (handlers
# replace the previous ones), so HMR is safe.
_install_datalab_shim()


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


def _coerce_array(data: Any, dtype: Any) -> np.ndarray:
    """Convert a JS-side array payload into a 1-D numpy array.

    Optimised for the bridge: when the JS side hands us a typed array
    (Pyodide auto-converts ``Float64Array``/``Float32Array`` to
    ``memoryview``, ``Uint8Array`` to ``bytes``), we wrap it through
    :func:`numpy.frombuffer` for a true zero-copy view.  Plain JS
    arrays (``number[]``) still work via the slow ``np.asarray`` path
    so existing callers using nested lists are unaffected.

    Args:
        data: ``bytes``/``bytearray``/``memoryview`` (zero-copy),
         a JsProxy with a ``to_py`` method (e.g. unconverted
         ``Float64Array``), or a Python iterable / list.
        dtype: target numpy dtype.  Must match the binary layout of
         the input when the latter is a buffer.
    """
    np_dtype = np.dtype(dtype)
    # Buffer-like inputs -> zero-copy view.
    if isinstance(data, (bytes, bytearray, memoryview)):
        return np.frombuffer(data, dtype=np_dtype)
    # Pyodide JsProxy of a TypedArray -> use ``.to_py()`` which returns
    # a memoryview without copying the underlying WASM heap.
    if hasattr(data, "to_py"):
        try:
            converted = data.to_py()
        except Exception:  # pragma: no cover - defensive only
            converted = None
        if isinstance(converted, memoryview):
            arr = np.frombuffer(converted, dtype=np_dtype)
            return arr
        if converted is not None:
            return np.asarray(converted, dtype=np_dtype)
    # Last resort: plain Python list / iterable.
    return np.asarray(data, dtype=np_dtype)


def add_signal_from_arrays(
    title: str,
    xdata,
    ydata,
    xunit: str = "",
    yunit: str = "",
    xlabel: str = "",
    ylabel: str = "",
    group_id: str | None = None,
    dtype: str = "float64",
) -> str:
    """Create a signal from raw X / Y arrays and store it.

    Used by the macro proxy bridge so the JS side can pass plain
    nested lists / typed arrays without building Python source code.
    Typed arrays (``Float64Array`` / ``Float32Array``) and ``bytes``
    are converted via :func:`_coerce_array` for zero-copy ingest.
    """
    x = _coerce_array(xdata, dtype)
    y = _coerce_array(ydata, dtype)
    obj: SignalObj = sigima.create_signal(title=title, x=x, y=y)
    if xunit:
        obj.xunit = xunit
    if yunit:
        obj.yunit = yunit
    if xlabel:
        obj.xlabel = xlabel
    if ylabel:
        obj.ylabel = ylabel
    return _MODEL.add_object("signal", obj, group_id=group_id)


def add_image_from_array(
    title: str,
    data,
    xunit: str = "",
    yunit: str = "",
    zunit: str = "",
    xlabel: str = "",
    ylabel: str = "",
    zlabel: str = "",
    group_id: str | None = None,
    width: int | None = None,
    height: int | None = None,
    dtype: str = "float64",
) -> str:
    """Create an image from a raw 2D array and store it.

    ``data`` may be a Python nested list (legacy slow path), a JsProxy
    of a nested array, or — for large transfers — a flat 1-D buffer
    (``bytes`` / typed array) accompanied by ``width`` and ``height``.
    The buffer mode is zero-copy and dramatically lowers the bandwidth
    cost for large remote transfers.
    """
    if width is not None and height is not None:
        flat = _coerce_array(data, dtype)
        if flat.size != width * height:
            raise ValueError(
                f"flat buffer size {flat.size} does not match width*height "
                f"= {width * height}"
            )
        arr = flat.reshape((height, width))
    else:
        # Legacy nested-list path: accept JsProxy via .to_py() too.
        if hasattr(data, "to_py"):
            data = data.to_py()
        arr = np.asarray(data, dtype=float)
    obj = sigima.create_image(title=title, data=arr)
    if xunit:
        obj.xunit = xunit
    if yunit:
        obj.yunit = yunit
    if zunit:
        obj.zunit = zunit
    if xlabel:
        obj.xlabel = xlabel
    if ylabel:
        obj.ylabel = ylabel
    if zlabel:
        obj.zlabel = zlabel
    return _MODEL.add_object("image", obj, group_id=group_id)


def get_signal_xy(oid: str, encoding: str = "list") -> dict[str, Any]:
    """Return the X / Y arrays of *oid* in JSON-friendly form.

    Args:
        oid: signal identifier in the in-memory store.
        encoding: ``"list"`` (default) returns ``x``/``y`` as Python
         lists (slow but JSON-trivial — kept for backwards compat).
         ``"bytes"`` returns ``x_bytes``/``y_bytes`` as raw
         little-endian ``float64`` byte strings — Pyodide hands them
         to JS as a single ``Uint8Array`` memcpy, which the front-end
         decodes into a typed array.  Use this on the remote bridge
         for large signals: a 1 M-sample signal goes from ~50 MB of
         intermediate JSON allocations to a single 8 MB memcpy.
    """
    obj = _MODEL.get(oid)
    payload: dict[str, Any] = {
        "id": oid,
        **_object_meta(_ObjectEntry(oid=oid, kind="signal", obj=obj)),
    }
    # Complex-valued Y arrays (e.g. raw FFT output) cannot be sent as
    # plain ``float64`` to the JS side without losing information AND
    # without crashing JS code that assumes ``y[i]`` is a number
    # (``v.toPrecision`` etc.). Mirror NumPy/Plotly defaults: take the
    # real part for both the ``list`` and ``bytes`` encodings. Sigima
    # exposes the imaginary part separately when the user actually
    # needs it (e.g. ``fft_imag``).
    y_arr = obj.y
    if np.iscomplexobj(y_arr):
        y_arr = y_arr.real
    if encoding == "bytes":
        x_arr = np.ascontiguousarray(obj.x, dtype=np.float64)
        y_arr = np.ascontiguousarray(y_arr, dtype=np.float64)
        payload["x_bytes"] = x_arr.tobytes()
        payload["y_bytes"] = y_arr.tobytes()
        payload["dtype"] = "float64"
        payload["size"] = int(x_arr.size)
        payload["encoding"] = "f64"
    else:
        payload["x"] = obj.x.tolist()
        payload["y"] = np.asarray(y_arr, dtype=np.float64).tolist()
        payload["encoding"] = "list"
    return payload


def get_signals_xy(oids: list[str]) -> list[dict[str, Any]]:
    """Batched variant of :func:`get_signal_xy`.

    Used by the front-end when several signals are selected so they can
    be overlaid on a single plot in one round-trip across the Pyodide
    bridge.  Unknown ids are silently skipped.
    """
    out: list[dict[str, Any]] = []
    for oid in oids:
        try:
            out.append(get_signal_xy(oid))
        except KeyError:
            continue
    return out


def set_signal_style(
    oid: str,
    color: str | None = None,
    linestyle: str | None = None,
    linewidth: float | None = None,
    curvestyle: str | None = None,
) -> None:
    """Persist per-curve style attributes on signal *oid*.

    Each argument writes to the canonical metadata key consumed by
    :func:`_signal_style` (and therefore by ``SignalPlot`` on the JS
    side).  Pass ``None`` (the default) to **clear** that attribute and
    fall back to the auto-cycling palette / Plotly defaults; pass an
    explicit value to set it.

    Recognised values:

    * ``color``      — any valid CSS / Plotly color string
                       (``"#rrggbb"``, ``"red"``, ``"rgb(...)"``).
    * ``linestyle``  — ``SolidLine`` / ``DashLine`` / ``DotLine`` /
                       ``DashDotLine`` / ``DashDotDotLine`` (or the
                       lowercase Plotly ``dash`` values).
    * ``linewidth``  — positive number; coerced to ``float``.
    * ``curvestyle`` — ``Lines`` / ``Sticks`` / ``Steps`` / ``Dots`` /
                       ``NoCurve``.
    """
    obj = _MODEL.get(oid)
    md = obj.metadata
    # ``color`` and its alias.
    if color is None:
        md.pop("color", None)
        md.pop("curvecolor", None)
    else:
        md["color"] = str(color)
    # ``linestyle`` and its alias.
    if linestyle is None:
        md.pop("linestyle", None)
        md.pop("line_style", None)
    else:
        md["linestyle"] = str(linestyle)
    # ``linewidth`` and its alias.
    if linewidth is None:
        md.pop("linewidth", None)
        md.pop("line_width", None)
    else:
        try:
            md["linewidth"] = float(linewidth)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid linewidth: {linewidth!r}") from exc
    # ``curvestyle`` and its alias.
    if curvestyle is None:
        md.pop("curvestyle", None)
        md.pop("curve_style", None)
    else:
        md["curvestyle"] = str(curvestyle)


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
_CREATION_PARAMS: dict[str, Any] = globals().get("_CREATION_PARAMS", {})


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


def update_signal_creation_params(oid: str, values: dict[str, Any]) -> dict[str, Any]:
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
    from guidata.dataset.dataitems import FloatArrayItem

    if hasattr(values, "to_py"):
        values = values.to_py()
    obj = _MODEL.get(oid)
    # The Properties side panel hides ``float_array`` fields from the
    # generic form but still echoes their values back unchanged on
    # Apply.  Those round-trip through JS as nested lists; assigning
    # them raw to a :class:`FloatArrayItem` would silently demote
    # ``obj.data`` / ``obj.x`` / ... to a Python list and break every
    # downstream ``.shape`` access (see ``_object_meta``,
    # ``get_image_data``).  Coerce them back to ``np.ndarray`` here so
    # the model invariant is preserved regardless of the caller.
    array_fields = {
        item.get_name() for item in obj.get_items() if isinstance(item, FloatArrayItem)
    }
    for name in array_fields & values.keys():
        value = values[name]
        if value is not None and not isinstance(value, np.ndarray):
            values[name] = np.asarray(value)
    update_dataset(obj, values)


# ---------------------------------------------------------------------------
# Properties side panel — extended widgets (stats / array / metadata).
# ---------------------------------------------------------------------------


def _safe_stat(fn, arr) -> float | None:
    """Return ``fn(arr)`` as a float, or ``None`` when the array is
    empty or the value is non-finite (NaN / Inf)."""
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
        out.append({"key": key, "value_type": value_type, "value": str_value})
    return out


def set_object_metadata_value(oid: str, key: str, value_type: str, value: str) -> None:
    """Add or update a metadata entry on *oid*.

    The string ``value`` is parsed back into a Python object according
    to ``value_type`` (``"string" | "number" | "bool" | "json"``).
    """
    import json

    obj = _MODEL.get(oid)
    if not _metadata_visible(key):
        raise ValueError(f"Metadata key {key!r} is reserved for internal use")
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


def format_signal_basenames(oids: list[str], fmt: str) -> list[str]:
    """Build basenames for *oids* using DataLab's filename pattern syntax.

    Delegates to :func:`sigima.io.common.basename.format_basenames`, which
    supports placeholders such as ``{title}``, ``{index}``, ``{count}``,
    ``{xlabel}``, ``{xunit}``, ``{ylabel}``, ``{yunit}`` and
    ``{metadata[key]}`` together with Python format-spec extensions
    (``upper``/``lower`` modifiers, integer zero-padding, …).

    Args:
        oids: Object ids of signals (or images) to format.
        fmt: Filename pattern (without extension).

    Returns:
        List of basenames in the same order as *oids*.
    """
    from sigima.io.common.basename import format_basenames

    objs = [_MODEL.get(oid) for oid in oids]
    return list(format_basenames(objs, fmt))


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


def list_image_io_formats() -> dict[str, Any]:
    """Return the supported image I/O formats.

    Same shape as :func:`list_signal_io_formats` but driven by Sigima's
    :class:`ImageIORegistry`.
    """
    from sigima.io.image.base import ImageIORegistry

    read: list[dict[str, Any]] = []
    write: list[dict[str, Any]] = []
    all_read: list[str] = []
    all_write: list[str] = []
    for fmt in ImageIORegistry.get_formats():
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


def open_image_from_bytes(
    filename: str, data: Any, group_id: str | None = None
) -> list[str]:
    """Decode *data* as an image file and add every image it contains to the
    image panel.  Mirrors :func:`open_signal_from_bytes`.

    Args:
        filename: Original file name; only the basename + extension matter.
        data: Raw bytes from the browser ``File`` object.
        group_id: Optional group to put the new images into.

    Returns:
        List of newly created object ids (one per image in the file).
    """
    import os
    import tempfile

    from sigima.io import read_images

    if hasattr(data, "to_py"):
        data = data.to_py()
    if not isinstance(data, (bytes, bytearray, memoryview)):
        data = bytes(data)
    base = os.path.basename(filename) or "upload.bin"
    tmpdir = tempfile.mkdtemp(prefix="dlw_open_img_")
    path = os.path.join(tmpdir, base)
    with open(path, "wb") as fh:
        fh.write(bytes(data))
    try:
        images = read_images(path)
    finally:
        try:
            os.remove(path)
            os.rmdir(tmpdir)
        except OSError:
            pass
    if not images:
        raise ValueError(f"No image could be read from {base!r}")
    oids: list[str] = []
    for img in images:
        oids.append(_MODEL.add_object("image", img, group_id=group_id))
    return oids


def save_image_to_bytes(oid: str, filename: str) -> bytes:
    """Serialise image *oid* into bytes using the format implied by *filename*.

    Mirrors :func:`save_signal_to_bytes` for images, dispatching via Sigima's
    :class:`ImageIORegistry`.
    """
    import os
    import tempfile

    from sigima.io import write_image

    obj = _MODEL.get(oid)
    base = os.path.basename(filename) or "image.tif"
    tmpdir = tempfile.mkdtemp(prefix="dlw_save_img_")
    path = os.path.join(tmpdir, base)
    try:
        write_image(path, obj)
        with open(path, "rb") as fh:
            return fh.read()
    finally:
        try:
            os.remove(path)
            os.rmdir(tmpdir)
        except OSError:
            pass


def open_from_directory_chunk(kind: str, group_name: str, files: Any) -> dict[str, Any]:
    """Open every file in *files* (one folder's worth) into a new group.

    Mirrors DataLab desktop's per-subfolder branch of
    ``BaseDataPanel.load_from_directory``: each file is loaded under a
    ``try/except`` that swallows format errors, and the group is created
    only if at least one object was successfully read — so empty / fully
    unreadable folders leave no trace.

    Args:
        kind: ``"signal"`` or ``"image"`` — selects the I/O registry.
        group_name: Display name for the new group (typically the path
            relative to the folder the user picked).
        files: List of ``{"name": str, "data": bytes}`` entries (a
            Pyodide ``JsProxy`` is accepted and converted).

    Returns:
        ``{"gid": str | None, "oids": list[str], "errors": int}``.
    """
    import os
    import tempfile

    if kind == "image":
        from sigima.io import read_images as _read

        panel = "image"
    else:
        from sigima.io import read_signals as _read

        panel = "signal"

    if hasattr(files, "to_py"):
        files = files.to_py()

    tmpdir = tempfile.mkdtemp(prefix="dlw_opendir_")
    objs: list[Any] = []
    errors = 0
    try:
        for entry in files:
            name = entry.get("name") if isinstance(entry, dict) else entry["name"]
            data = entry.get("data") if isinstance(entry, dict) else entry["data"]
            if hasattr(data, "to_py"):
                data = data.to_py()
            if not isinstance(data, (bytes, bytearray, memoryview)):
                data = bytes(data)
            base = os.path.basename(name) or "upload.bin"
            path = os.path.join(tmpdir, base)
            try:
                with open(path, "wb") as fh:
                    fh.write(bytes(data))
                read_objs = _read(path)
            except Exception:  # noqa: BLE001 — parity with Qt `ignore_errors=True`
                errors += 1
                continue
            finally:
                try:
                    os.remove(path)
                except OSError:
                    pass
            if read_objs:
                objs.extend(read_objs)
            else:
                errors += 1
    finally:
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass

    if not objs:
        return {"gid": None, "oids": [], "errors": errors}
    gid = _MODEL.create_group(panel, group_name)
    oids = [_MODEL.add_object(panel, obj, group_id=gid) for obj in objs]
    return {"gid": gid, "oids": oids, "errors": errors}


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


def move_object(oid: str, target_group_id: str, target_index: int = -1) -> None:
    """Move object *oid* to *target_group_id* (optionally at *target_index*)."""
    _MODEL.move_object(oid, target_group_id, target_index)


def move_objects(oids: list[str], target_group_id: str, target_index: int = -1) -> None:
    """Move multiple objects to *target_group_id* preserving *oids* order."""
    _MODEL.move_objects(oids, target_group_id, target_index)


def move_object_in_group(oid: str, delta: int) -> None:
    """Reorder object *oid* within its current group by *delta* slots."""
    _MODEL.move_object_in_group(oid, delta)


def duplicate_object(oid: str) -> str:
    """Insert a deep copy of object *oid* and return the new oid."""
    return _MODEL.duplicate_object(oid)


def delete_object(oid: str) -> None:
    """Delete object *oid* from its panel."""
    _MODEL.delete_object(oid)
    _LAST_PROCESSING.pop(oid, None)
    _CREATION_PARAMS.pop(oid, None)


# ---------------------------------------------------------------------------
# Pickle-based object exchange (used by the macro proxy bridge for
# ``add_object`` / ``set_object`` — i.e. when a worker macro builds a
# fully-formed ``SignalObj`` / ``ImageObj`` and wants to publish it to
# the live model). Both runtimes ship the same Sigima version so binary
# compatibility holds.
# ---------------------------------------------------------------------------


def _decode_pickled_obj(b64: str):
    """Return the ``SignalObj`` / ``ImageObj`` decoded from base-64 pickle."""
    import base64  # noqa: PLC0415
    import pickle  # noqa: PLC0415

    return pickle.loads(base64.b64decode(b64.encode("ascii")))


def add_object_pickled(pickled_b64: str, kind: str, group_id: str | None = None) -> str:
    """Insert a pickled ``SignalObj`` / ``ImageObj`` in *kind*'s panel."""
    obj = _decode_pickled_obj(pickled_b64)
    return _MODEL.add_object(kind, obj, group_id=group_id)


def set_object_pickled(pickled_b64: str) -> str:
    """Replace an existing object's data, matched by its ``uuid`` attribute."""
    obj = _decode_pickled_obj(pickled_b64)
    target_uuid = getattr(obj, "uuid", None)
    if target_uuid is None:
        raise KeyError("Replacement object carries no UUID")
    for entry in _MODEL._objects.values():  # noqa: SLF001
        if getattr(entry.obj, "uuid", None) == target_uuid:
            entry.obj = obj
            return entry.oid
    raise KeyError(f"No object with UUID {target_uuid!r} in the workspace")


def get_group_titles_with_object_info(
    panel: str = "signal",
) -> tuple[list[str], list[list[str]], list[list[str]]]:
    """Return ``(group_titles, group_obj_uuids, group_obj_titles)`` for *panel*.

    Mirrors ``BaseProxy.get_group_titles_with_object_info`` — three
    parallel lists, one entry per group, with inner lists holding the
    object UUIDs and titles in their on-screen order.
    """
    p = _MODEL.panel(panel)
    p.ensure_default_group()
    titles: list[str] = []
    uuids: list[list[str]] = []
    obj_titles: list[list[str]] = []
    for g in p.groups:
        titles.append(g.name)
        gids: list[str] = []
        gtitles: list[str] = []
        for oid in g.object_ids:
            entry = _MODEL._objects.get(oid)  # noqa: SLF001
            if entry is None:
                continue
            gids.append(getattr(entry.obj, "uuid", oid) or oid)
            gtitles.append(getattr(entry.obj, "title", ""))
        uuids.append(gids)
        obj_titles.append(gtitles)
    return titles, uuids, obj_titles


def resolve_group_oids(panel: str, selection) -> list[str]:
    """Return the flat list of object oids referenced by *selection*.

    *selection* may contain group ids (str) or 1-based group indices (int).
    ``None`` selects every group of *panel*.
    """
    p = _MODEL.panel(panel)
    p.ensure_default_group()
    if selection is None:
        groups = list(p.groups)
    else:
        groups = []
        for token in selection:
            if isinstance(token, int):
                if 1 <= token <= len(p.groups):
                    groups.append(p.groups[token - 1])
            else:
                groups.append(p.find_group(str(token)))
    out: list[str] = []
    for g in groups:
        out.extend(g.object_ids)
    return out


def reset_all() -> None:
    """Delete every object and every group in every panel.

    Also wipes the macro and notebook stores so the in-Pyodide state
    is fully reset to its post-bootstrap value.  Used by the E2E test
    fixture that reuses a single Pyodide worker across multiple tests.
    """
    for kind, panel in list(_MODEL._panels.items()):  # noqa: SLF001
        for oid in [
            entry.oid
            for entry in list(_MODEL._objects.values())  # noqa: SLF001
            if entry.kind == kind
        ]:
            _MODEL.delete_object(oid)
        panel.groups.clear()
        panel.ensure_default_group()
    _LAST_PROCESSING.clear()
    _CREATION_PARAMS.clear()
    _MACROS.clear()
    _NOTEBOOKS.clear()


# Backwards-compatible flat list (used by debug helpers / DevTools console).


def list_signals() -> list[dict[str, Any]]:
    """Return metadata for every stored signal (flat)."""
    return [
        {"id": oid, **_object_meta(_ObjectEntry(oid=oid, kind="signal", obj=obj))}
        for oid, obj in _MODEL.iter_all("signal")
    ]


def list_images() -> list[dict[str, Any]]:
    """Return ``{"id", "title"}`` for every stored image (flat)."""
    return [{"id": oid, "title": obj.title} for oid, obj in _MODEL.iter_all("image")]


def get_object(oid: str) -> dict[str, Any]:
    """Return ``{"id", "kind", "title"}`` for the object identified by *oid*."""
    return {"id": oid, "kind": _MODEL.kind_of(oid), "title": _MODEL.get(oid).title}


def get_object_uuids(panel: str) -> list[str]:
    """Return the ids of every object whose kind matches *panel*."""
    return [oid for oid, _obj in _MODEL.iter_all(panel)]


# ---------------------------------------------------------------------------
# Image panel
# ---------------------------------------------------------------------------


from sigima.objects.image.creation import (  # noqa: E402  pylint: disable=wrong-import-position
    DEFAULT_TITLE as _IMAGE_DEFAULT_TITLE,
)
from sigima.objects.image.creation import (  # noqa: E402  pylint: disable=wrong-import-position
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


def update_image_creation_params(oid: str, values: dict[str, Any]) -> dict[str, Any]:
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
        data = a * np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (2.0 * sigma * sigma)))
    elif kind == "ramp":
        data = a * (xx / max(width - 1, 1))
    elif kind == "random":
        rng = np.random.default_rng()
        data = a * rng.random(size=(height, width))
    else:
        raise ValueError(f"Unknown image kind: {kind!r}")
    obj = sigima.create_image(title=title, data=data.astype(np.float64))
    return _MODEL.add_object("image", obj, group_id=group_id)


def _maybe_downsample(data: "np.ndarray", max_size: int | None) -> "np.ndarray":
    """Return *data* decimated so its largest dimension is ≤ *max_size*.

    Uses simple integer striding (``data[::s, ::s]``) — fast,
    allocation-free, and good enough for the multi-image grid where
    cells are only a few hundred pixels wide.  When *max_size* is
    ``None`` or the image is already small enough, returns *data*
    unchanged.
    """
    if max_size is None:
        return data
    h, w = data.shape[:2]
    longest = max(h, w)
    if longest <= max_size:
        return data
    stride = int(np.ceil(longest / max_size))
    return data[::stride, ::stride]


def get_image_data(
    oid: str,
    max_size: int | None = None,
    encoding: str = "list",
) -> dict[str, Any]:
    """Return *oid* image data (read-only viewer payload).

    Coordinates honour ``x0``/``y0``/``dx``/``dy`` (image origin and pixel
    spacing).  ``data_min``/``max`` let the front-end pick a default LUT
    range without re-iterating.

    Args:
        oid: image identifier in the in-memory store.
        max_size: when set, decimate the image so its largest dimension
            is at most ``max_size`` pixels.  Used by the multi-image
            grid to keep the bridge payload bounded.  ``None`` keeps the
            original resolution.
        encoding: ``"bytes"`` (default) returns ``data`` as raw
            little-endian ``float32`` bytes — Pyodide hands them to JS
            as a single ``Uint8Array`` memcpy, which the front-end
            decodes into a typed array.  ``"list"`` returns the legacy
            nested-list representation (kept for tests that consume the
            payload from Python).
    """
    obj = _MODEL.get(oid)
    raw = obj.data
    md = getattr(obj, "metadata", None) or {}
    colormap = md.get("colormap") or md.get("colourmap")
    invert_cm = md.get("invert_colormap") or md.get("colormap_inverted")
    # LUT extrema are computed on the *full* resolution so the colour
    # range stays representative even when we ship a downsampled view.
    data_min = float(np.nanmin(raw))
    data_max = float(np.nanmax(raw))
    data = _maybe_downsample(raw, max_size)
    payload: dict[str, Any] = {
        "id": oid,
        "title": obj.title or "",
        "width": int(data.shape[1]),
        "height": int(data.shape[0]),
        "dtype": str(data.dtype),
        # Adjust pixel spacing if we downsampled so physical
        # coordinates remain correct (one pixel covers ``stride * dx``
        # of the original image).
        "x0": float(getattr(obj, "x0", 0.0) or 0.0),
        "y0": float(getattr(obj, "y0", 0.0) or 0.0),
        "dx": float(getattr(obj, "dx", 1.0) or 1.0) * (raw.shape[1] / data.shape[1]),
        "dy": float(getattr(obj, "dy", 1.0) or 1.0) * (raw.shape[0] / data.shape[0]),
        "data_min": data_min,
        "data_max": data_max,
        "xlabel": obj.xlabel or "",
        "ylabel": obj.ylabel or "",
        "zlabel": getattr(obj, "zlabel", "") or "",
        "xunit": obj.xunit or "",
        "yunit": obj.yunit or "",
        "zunit": getattr(obj, "zunit", "") or "",
        "colormap": str(colormap) if colormap else None,
        "invert_colormap": bool(invert_cm) if invert_cm is not None else False,
    }
    if encoding == "bytes":
        # ``np.ascontiguousarray`` guarantees the byte buffer is a
        # tight (H, W) float32 grid — required because ``_maybe_
        # downsample`` returns a strided view.
        payload["data"] = np.ascontiguousarray(data, dtype=np.float32).tobytes()
        payload["encoding"] = "f32"
    else:
        payload["data"] = data.tolist()
        payload["encoding"] = "list"
    return payload


def get_images_data(
    oids: list[str],
    max_size: int | None = None,
    encoding: str = "list",
) -> list[dict[str, Any]]:
    """Batched variant of :func:`get_image_data`.

    Used by the front-end when several images are selected so they can
    be laid out side-by-side in one round-trip across the Pyodide
    bridge.  Unknown ids are silently skipped (mirrors
    :func:`get_signals_xy`).

    The ``max_size`` and ``encoding`` arguments are forwarded to
    :func:`get_image_data` so the multi-image grid can request a
    downsampled, byte-encoded payload (≈ 50× smaller than the legacy
    full-resolution nested-list form).
    """
    out: list[dict[str, Any]] = []
    for oid in oids:
        try:
            out.append(get_image_data(oid, max_size=max_size, encoding=encoding))
        except KeyError:
            continue
    return out


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


def _build_image_roi(obj: Any, segments: list[dict[str, Any]]) -> Any:
    """Build an :class:`ImageROI` populated with *segments* (physical coords)."""
    del obj  # API compat with the signal counterpart (``_build_signal_roi``)
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
            roi.add_roi(PolygonalROI(flat, indices=False, title=title, inverse=inverse))
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
            out_ids.append(_MODEL.add_object("image", result, group_id=src_group_id))
    return out_ids


def erase_image_area(oid: str, segments: list[dict[str, Any]] | None) -> str:
    """Erase one or more areas of image *oid* defined by *segments*.

    Mirrors DataLab desktop's ``compute_erase``: builds an ad-hoc
    :class:`ImageROI` from the user-defined *segments* (which is *not*
    stored on the source image), converts it to a list of
    :class:`ROI2DParam`, and runs :func:`sigima.proc.image.erase`. The
    erased pixels are replaced by the mean of the image (Sigima default).

    Args:
        oid: Source image id.
        segments: ROI segments in the same format as :func:`set_image_roi`
            (rectangle / circle / polygon, physical coordinates).

    Returns:
        The id of the newly created result image, placed in the same
        group as the source.
    """
    if hasattr(segments, "to_py"):
        segments = segments.to_py()
    if not segments:
        raise ValueError("erase_image_area requires at least one ROI segment")
    import sigima.proc.image as sipi

    obj = _MODEL.get(oid)
    roi = _build_image_roi(obj, segments)
    params = [single.to_param(obj, i) for i, single in enumerate(roi.single_rois)]
    panel = _MODEL._panels["image"]  # noqa: SLF001
    src_group_id: str | None = None
    try:
        src_group_id = panel.find_group_of(oid).gid
    except Exception:
        src_group_id = None
    result = sipi.erase(obj, params)
    return _MODEL.add_object("image", result, group_id=src_group_id)


# ---------------------------------------------------------------------------
# Metadata & annotations (Phase 4)
# ---------------------------------------------------------------------------


_PLOTLY_ANNOTATIONS_KEY = "_dlw_plotly_annotations"
_LUT_RANGE_KEY = "_dlw_lut_range"


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


def get_lut_range(oid: str) -> list[float] | None:
    """Return the persisted LUT range ``[zmin, zmax]`` for image *oid*.

    Returns ``None`` when no override has been stored — in which case the
    UI should fall back to the image's intrinsic ``data_min``/``data_max``.
    """
    obj = _MODEL.get(oid)
    payload = obj.metadata.get(_LUT_RANGE_KEY)
    if not isinstance(payload, (list, tuple)) or len(payload) != 2:
        return None
    try:
        zmin = float(payload[0])
        zmax = float(payload[1])
    except (TypeError, ValueError):
        return None
    return [zmin, zmax]


def set_lut_range(oid: str, payload: list[float] | None) -> None:
    """Persist the LUT range ``[zmin, zmax]`` for image *oid*.

    Pass ``None`` (or an empty/invalid value) to clear the override.
    """
    if hasattr(payload, "to_py"):
        payload = payload.to_py()
    obj = _MODEL.get(oid)
    if payload is None:
        obj.metadata.pop(_LUT_RANGE_KEY, None)
        return
    if not isinstance(payload, (list, tuple)) or len(payload) != 2:
        obj.metadata.pop(_LUT_RANGE_KEY, None)
        return
    try:
        zmin = float(payload[0])
        zmax = float(payload[1])
    except (TypeError, ValueError):
        obj.metadata.pop(_LUT_RANGE_KEY, None)
        return
    obj.metadata[_LUT_RANGE_KEY] = [zmin, zmax]


def set_colormap(oid: str, name: str | None, inverted: bool = False) -> None:
    """Persist the colormap (name + inversion flag) for image *oid*.

    The values are stored under the canonical ``colormap`` /
    ``invert_colormap`` metadata keys so :func:`get_image_data` picks
    them up on the next read.  Pass ``name=None`` (or empty) to clear
    the override; ``invert_colormap`` is removed alongside it.
    """
    obj = _MODEL.get(oid)
    if not name:
        obj.metadata.pop("colormap", None)
        obj.metadata.pop("colourmap", None)
        obj.metadata.pop("invert_colormap", None)
        obj.metadata.pop("colormap_inverted", None)
        return
    obj.metadata["colormap"] = str(name)
    obj.metadata["invert_colormap"] = bool(inverted)


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
            raise ValueError(f"ROI segment xmin ({xmin}) must be < xmax ({xmax})")
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
            out_ids.append(_MODEL.add_object("signal", result, group_id=src_group_id))
    return out_ids


# ---------------------------------------------------------------------------
# CSV I/O (Phase 6)
# ---------------------------------------------------------------------------


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
        # Probe: are the first two fields parseable as floats?
        for c in first_fields[:2]:
            float(c.strip())
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
# Text Import Wizard helpers (mirrors datalab.widgets.textimport)
# ---------------------------------------------------------------------------


def _normalise_text_import_params(
    delimiter: str = ",",
    decimal: str = ".",
    comment: str = "#",
    skip_rows: int = 0,
    max_rows: int | None = None,
    header: str = "infer",
    transpose: bool = False,
    first_col_is_x: bool = True,
    dtype_str: str = "float64",
) -> dict[str, Any]:
    """Return a normalised parameter dict for the text-import helpers."""
    if delimiter == r"\t":
        delimiter = "\t"
    if max_rows is not None and max_rows <= 0:
        max_rows = None
    return {
        "delimiter": delimiter or ",",
        "decimal": decimal or ".",
        "comment": comment or "",
        "skip_rows": max(int(skip_rows or 0), 0),
        "max_rows": max_rows,
        "header": header if header in ("infer", "none", "first") else "infer",
        "transpose": bool(transpose),
        "first_col_is_x": bool(first_col_is_x),
        "dtype_str": dtype_str or "float64",
    }


def _parse_text_to_matrix(
    content: str, params: dict[str, Any]
) -> tuple[list[str], list[list[float]]]:
    """Parse *content* into ``(headers, rows)``.

    Lines starting with the comment character are dropped before any other
    processing. ``skip_rows`` is then applied. ``header`` controls whether
    the first remaining line is treated as a list of column names.
    """
    delim = params["delimiter"]
    decimal = params["decimal"]
    comment = params["comment"]
    skip_rows = params["skip_rows"]
    max_rows = params["max_rows"]
    header = params["header"]

    raw_lines: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if comment and stripped.startswith(comment):
            continue
        raw_lines.append(line)
    raw_lines = raw_lines[skip_rows:]
    if not raw_lines:
        return [], []

    def _split(line: str) -> list[str]:
        if delim == " ":
            return [c for c in line.split() if c != ""]
        return [c.strip() for c in line.split(delim)]

    def _to_float(cell: str) -> float:
        if cell == "" or cell.lower() in ("nan", "na", "n/a"):
            return float("nan")
        if decimal != ".":
            cell = cell.replace(decimal, ".")
        return float(cell)

    headers: list[str] = []
    data_lines = raw_lines

    use_header = False
    if header == "first":
        use_header = True
    elif header == "infer":
        first_fields = _split(raw_lines[0])
        try:
            for c in first_fields:
                _to_float(c)
        except ValueError:
            use_header = True

    if use_header:
        headers = _split(raw_lines[0])
        data_lines = raw_lines[1:]

    if max_rows is not None:
        data_lines = data_lines[:max_rows]

    rows: list[list[float]] = []
    ncols = 0
    for line in data_lines:
        cells = _split(line)
        try:
            row = [_to_float(c) for c in cells]
        except ValueError:
            continue
        if not row:
            continue
        ncols = max(ncols, len(row))
        rows.append(row)

    # Pad short rows with NaN to keep the matrix rectangular.
    for row in rows:
        if len(row) < ncols:
            row.extend([float("nan")] * (ncols - len(row)))

    if not headers:
        headers = [f"col{i}" for i in range(ncols)]
    elif len(headers) < ncols:
        headers.extend(f"col{i}" for i in range(len(headers), ncols))
    elif len(headers) > ncols:
        headers = headers[:ncols]

    if params["transpose"]:
        if rows:
            transposed = list(map(list, zip(*rows)))
            rows = [list(r) for r in transposed]
            headers = [f"col{i}" for i in range(len(rows[0]) if rows else 0)]
    return headers, rows


def parse_text_import(
    content: str,
    *,
    delimiter: str = ",",
    decimal: str = ".",
    comment: str = "#",
    skip_rows: int = 0,
    max_rows: int | None = None,
    header: str = "infer",
    transpose: bool = False,
    first_col_is_x: bool = True,
    dtype_str: str = "float64",
    preview_rows: int = 200,
) -> dict[str, Any]:
    """Return a parsed preview of *content* for the import wizard.

    The result dict contains:

    * ``headers``: list of column names (one per column)
    * ``preview_rows``: first ``preview_rows`` rows as a list of list of
      floats (or strings for ``"NaN"``)
    * ``nrows``: total number of *data* rows parsed
    * ``ncols``: number of columns
    * ``signal_titles``: list of candidate signal titles (taking
      ``first_col_is_x`` into account)
    * ``error``: ``None`` on success, a human-readable string otherwise
    """
    params = _normalise_text_import_params(
        delimiter=delimiter,
        decimal=decimal,
        comment=comment,
        skip_rows=skip_rows,
        max_rows=max_rows,
        header=header,
        transpose=transpose,
        first_col_is_x=first_col_is_x,
        dtype_str=dtype_str,
    )
    try:
        headers, rows = _parse_text_to_matrix(content, params)
    except Exception as exc:  # pylint: disable=broad-except
        return {
            "headers": [],
            "preview_rows": [],
            "nrows": 0,
            "ncols": 0,
            "signal_titles": [],
            "error": str(exc),
        }
    if not rows:
        return {
            "headers": headers,
            "preview_rows": [],
            "nrows": 0,
            "ncols": len(headers),
            "signal_titles": [],
            "error": "No numeric data found",
        }
    ncols = len(rows[0])
    nrows = len(rows)
    if first_col_is_x and ncols >= 2:
        signal_titles = [headers[i] for i in range(1, ncols)]
    else:
        signal_titles = list(headers)
    preview = []
    for row in rows[: max(0, int(preview_rows))]:
        preview.append(
            # ``v != v`` is the canonical NaN check for plain Python floats.
            # pylint: disable-next=comparison-with-itself
            [("NaN" if (isinstance(v, float) and v != v) else v) for v in row]
        )
    return {
        "headers": headers,
        "preview_rows": preview,
        "nrows": nrows,
        "ncols": ncols,
        "signal_titles": signal_titles,
        "error": None,
    }


def build_text_import_signals(
    content: str,
    *,
    delimiter: str = ",",
    decimal: str = ".",
    comment: str = "#",
    skip_rows: int = 0,
    max_rows: int | None = None,
    header: str = "infer",
    transpose: bool = False,
    first_col_is_x: bool = True,
    dtype_str: str = "float64",
) -> dict[str, Any]:
    """Build candidate signal payloads (no insertion into the model).

    Returns a dict with ``signals`` (list of ``{title, x, y, xlabel,
    ylabel}``) and ``error``.  The wizard uses this to render the
    graphical-preview page.
    """
    params = _normalise_text_import_params(
        delimiter=delimiter,
        decimal=decimal,
        comment=comment,
        skip_rows=skip_rows,
        max_rows=max_rows,
        header=header,
        transpose=transpose,
        first_col_is_x=first_col_is_x,
        dtype_str=dtype_str,
    )
    try:
        headers, rows = _parse_text_to_matrix(content, params)
    except Exception as exc:  # pylint: disable=broad-except
        return {"signals": [], "error": str(exc)}
    if not rows:
        return {"signals": [], "error": "No numeric data found"}
    try:
        data = np.asarray(rows, dtype=np.dtype(params["dtype_str"]))
    except (TypeError, ValueError) as exc:
        return {"signals": [], "error": f"Invalid data type: {exc}"}
    if data.ndim != 2:
        return {"signals": [], "error": "Parsed data is not 2D"}
    columns = data.T  # shape: (ncols, nrows)
    ncols = columns.shape[0]
    if params["first_col_is_x"] and ncols >= 2:
        x = columns[0]
        xlabel = headers[0] if headers else "x"
        signals = []
        for i in range(1, ncols):
            signals.append(
                {
                    "title": headers[i] if i < len(headers) else f"col{i}",
                    "x": x.tolist(),
                    "y": columns[i].tolist(),
                    "xlabel": xlabel,
                    "ylabel": headers[i] if i < len(headers) else "",
                }
            )
    else:
        n = columns.shape[1]
        x_default = np.arange(n, dtype=np.dtype(params["dtype_str"]))
        signals = []
        for i in range(ncols):
            signals.append(
                {
                    "title": headers[i] if i < len(headers) else f"col{i}",
                    "x": x_default.tolist(),
                    "y": columns[i].tolist(),
                    "xlabel": "",
                    "ylabel": headers[i] if i < len(headers) else "",
                }
            )
    return {"signals": signals, "error": None}


def commit_text_import(
    content: str,
    *,
    delimiter: str = ",",
    decimal: str = ".",
    comment: str = "#",
    skip_rows: int = 0,
    max_rows: int | None = None,
    header: str = "infer",
    transpose: bool = False,
    first_col_is_x: bool = True,
    dtype_str: str = "float64",
    selected_indices: list[int] | None = None,
    title: str = "",
    xlabel: str = "",
    ylabel: str = "",
    xunit: str = "",
    yunit: str = "",
    group_id: str | None = None,
) -> list[str]:
    """Create the selected signals in the model and return their oids."""
    payload = build_text_import_signals(
        content,
        delimiter=delimiter,
        decimal=decimal,
        comment=comment,
        skip_rows=skip_rows,
        max_rows=max_rows,
        header=header,
        transpose=transpose,
        first_col_is_x=first_col_is_x,
        dtype_str=dtype_str,
    )
    if payload["error"]:
        raise ValueError(payload["error"])
    candidates = payload["signals"]
    if not candidates:
        raise ValueError("No signal could be built from the provided data")
    if selected_indices is None:
        indices = list(range(len(candidates)))
    else:
        indices = [int(i) for i in selected_indices if 0 <= int(i) < len(candidates)]
    if not indices:
        raise ValueError("No signal selected for import")
    multi = len(indices) > 1
    oids: list[str] = []
    for n, idx in enumerate(indices, start=1):
        spec = candidates[idx]
        sig_title = spec["title"] or f"col{idx}"
        if title:
            sig_title = f"{title} - {sig_title}" if multi else title
        elif multi:
            sig_title = f"{sig_title} {n:02d}"
        obj = sigima.create_signal(
            title=sig_title,
            x=np.asarray(spec["x"], dtype=np.dtype(dtype_str)),
            y=np.asarray(spec["y"], dtype=np.dtype(dtype_str)),
        )
        # Default labels/units inferred from the column header; user
        # overrides take precedence (mirrors datalab.widgets.textimport).
        obj.xlabel = xlabel or spec["xlabel"] or obj.xlabel
        obj.ylabel = ylabel or spec["ylabel"] or obj.ylabel
        if xunit:
            obj.xunit = xunit
        if yunit:
            obj.yunit = yunit
        oids.append(_MODEL.add_object("signal", obj, group_id=group_id))
    return oids


# ---------------------------------------------------------------------------
# Feature catalogue & processing
# ---------------------------------------------------------------------------


def list_features() -> list[dict[str, Any]]:
    """Return the full feature catalogue (signals + images + plugins)."""
    return _proc.serialize_catalog(_full_catalog_with_plugins())


def get_feature_schema(feature_id: str) -> dict[str, Any] | None:
    """Return ``{schema, values}`` for *feature_id* or ``None`` if it is
    parameterless."""
    return _proc.get_schema(_full_catalog_with_plugins(), feature_id)


def resolve_feature_choices(
    feature_id: str, item_name: str, values: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """Resolve a dynamic ChoiceItem for *feature_id*."""
    return _proc.resolve_choices(
        _full_catalog_with_plugins(), feature_id, item_name, values
    )


def patch_title_with_ids(dst: Any, src_oids: list[str]) -> None:
    """Substitute placeholders in ``dst.title`` with source short IDs.

    Mirrors :func:`datalab.objectmodel.patch_title_with_ids` (Qt desktop):
    Sigima's ``PlaceholderTitleFormatter`` (installed by
    :mod:`dlw_title_format`) leaves titles like ``"normalize({0})"`` or
    ``"{0}+{1}"``; this helper resolves the ``{n}`` placeholders with the
    source objects' hex ``oid`` strings.

    Best-effort: a missing placeholder (``IndexError``), an unrelated
    ``KeyError`` (custom ``{name}`` tokens in user-written Sigima
    functions), or a non-string title is silently left untouched so a
    formatter quirk never crashes the computation pipeline.
    """
    title = getattr(dst, "title", None)
    if not isinstance(title, str):
        return
    try:
        dst.title = title.format(*src_oids)
    except (IndexError, KeyError):
        # Leave the raw placeholder in the title rather than failing.
        pass


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
    catalog = _full_catalog_with_plugins()
    spec = catalog.get(feature_id)
    if spec is None:
        raise ValueError(f"Unknown feature: {feature_id!r}")
    if not source_ids:
        raise ValueError("apply_feature requires at least one source")
    if hasattr(params, "to_py"):
        params = params.to_py()
    sources = [_MODEL.get(oid) for oid in source_ids]
    operand = _MODEL.get(operand_id) if operand_id else None
    src_panel = _MODEL.panel(spec.object_kind)
    cross_kind = spec.output_kind != spec.object_kind
    dst_panel = _MODEL.panel(spec.output_kind) if cross_kind else src_panel
    # Snapshot the source ID list *before* running the computation so
    # title patching is robust against any concurrent model mutation.
    src_ids_snapshot = list(source_ids)
    ctx = _proc.ApplyContext(
        feature=spec, sources=sources, operand=operand, params=params
    )
    result = _PROCESSOR.apply(ctx, source_ids)
    new_ids: list[str] = []
    for source_oid, dst in result.items:
        # Resolve the placeholder-based title produced by Sigima
        # (``PlaceholderTitleFormatter``) using the source short IDs.
        # Patterns expose different source sets:
        #   * 1_to_1 → ``[source_oid]``
        #   * 2_to_1 → ``[source_oid, operand_id]``
        #   * n_to_1 → ``src_ids_snapshot`` (source_oid is ``None``)
        if source_oid is None:
            patch_oids = src_ids_snapshot
        elif spec.pattern == "2_to_1" and operand_id is not None:
            patch_oids = [source_oid, operand_id]
        else:
            patch_oids = [source_oid]
        patch_title_with_ids(dst, patch_oids)
        if cross_kind:
            # No meaningful "source group" mapping across panels — drop
            # results into the destination panel's default (first) group.
            group = dst_panel.ensure_default_group()
        else:
            anchor = source_oid or source_ids[0]
            group = src_panel.find_group_of(anchor)
        new_oid = _MODEL.add_object(spec.output_kind, dst, group_id=group.gid)
        new_ids.append(new_oid)
        # Record the originating processing so the "Processing" side panel
        # tab can re-edit its parameters and re-apply it on the same source(s).
        _LAST_PROCESSING[new_oid] = {
            "feature_id": feature_id,
            "source_ids": list(source_ids),
            "operand_id": operand_id,
            "params": dict(params) if params else {},
        }
    return new_ids


# Per-object record of the last processing that produced it.  Keyed by the
# *result* oid; consumed by :func:`get_last_processing` and
# :func:`reapply_last_processing` to power the "Processing" side panel tab.
_LAST_PROCESSING: dict[str, dict[str, Any]] = globals().get("_LAST_PROCESSING", {})


def get_last_processing(oid: str) -> dict[str, Any] | None:
    """Return the last processing applied to produce *oid*, or ``None``.

    Payload: ``{"feature_id", "label", "menu_path", "schema", "values",
    "source_ids", "operand_id", "has_params"}``.  ``schema`` / ``values``
    are absent (set to ``None``) when the feature is parameterless.
    """
    from guidata.dataset import dataset_to_schema_with_values, update_dataset

    record = _LAST_PROCESSING.get(oid)
    if record is None:
        return None
    catalog = _full_catalog_with_plugins()
    spec = catalog.get(record["feature_id"])
    if spec is None:
        return None
    payload: dict[str, Any] = {
        "feature_id": spec.feature_id,
        "label": spec.label,
        "menu_path": spec.menu_path,
        "source_ids": list(record["source_ids"]),
        "operand_id": record["operand_id"],
        "has_params": spec.paramclass is not None,
        "schema": None,
        "values": None,
    }
    if spec.paramclass is not None:
        instance = spec.paramclass()
        if record["params"]:
            try:
                update_dataset(instance, record["params"])
            except Exception:  # pylint: disable=broad-except
                pass
        sw = dataset_to_schema_with_values(instance)
        payload["schema"] = sw["schema"]
        payload["values"] = sw["values"]
    return payload


def reapply_last_processing(oid: str, values: dict[str, Any] | None = None) -> str:
    """Re-run the last processing that produced *oid* with *values*.

    The result replaces *oid* in place: same id, same group position,
    so plots and tree selection stay anchored.  Source / operand objects
    are looked up by their original ids; if any of them no longer exists,
    a :class:`ValueError` is raised.
    """
    if hasattr(values, "to_py"):
        values = values.to_py()
    record = _LAST_PROCESSING.get(oid)
    if record is None:
        raise ValueError(f"Object {oid!r} has no recorded processing.")
    catalog = _full_catalog_with_plugins()
    spec = catalog.get(record["feature_id"])
    if spec is None:
        raise ValueError(f"Processing {record['feature_id']!r} is no longer available.")
    source_ids = record["source_ids"]
    missing = [sid for sid in source_ids if not _MODEL.has(sid)]
    if missing:
        raise ValueError("Source object(s) no longer exist: " + ", ".join(missing))
    operand_id = record["operand_id"]
    if operand_id is not None and not _MODEL.has(operand_id):
        raise ValueError(f"Operand object {operand_id!r} no longer exists.")
    sources = [_MODEL.get(sid) for sid in source_ids]
    operand = _MODEL.get(operand_id) if operand_id else None
    ctx = _proc.ApplyContext(
        feature=spec,
        sources=sources,
        operand=operand,
        params=dict(values) if values else None,
    )
    result = _PROCESSOR.apply(ctx, source_ids)
    if not result.items:
        raise ValueError("Processing produced no result.")
    # Take the first (and for 1_to_1/2_to_1 only) result and swap it into
    # the existing entry.  This preserves the oid, group position and any
    # downstream references the UI may hold.
    _, new_obj = result.items[0]
    _MODEL._objects[oid].obj = new_obj  # noqa: SLF001
    # Update the recorded params so subsequent edits start from the new
    # baseline (mirrors how DataLab desktop persists the edited DataSet).
    _LAST_PROCESSING[oid] = {
        "feature_id": spec.feature_id,
        "source_ids": list(source_ids),
        "operand_id": operand_id,
        "params": dict(values) if values else {},
    }
    return oid


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
    """Backwards-compatible alias for :func:`get_feature_schema`."""
    return get_feature_schema(processing_id)


def resolve_processing_choices(
    processing_id: str, item_name: str, values: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """Backwards-compatible alias for :func:`resolve_feature_choices`."""
    return resolve_feature_choices(processing_id, item_name, values)


def apply_processing(
    oid: str, processing_id: str, params: dict[str, Any] | None = None
) -> str:
    """Legacy single-source helper."""
    return apply_feature(processing_id, [oid], params=params)[0]


# ---------------------------------------------------------------------------
# Image-only panel operations (modify selected images in place).
# Mirrors DataLab desktop's "Processing > Geometry > Distribute on a grid"
# and "Reset image positions" entries.
# ---------------------------------------------------------------------------


def get_image_grid_param_schema() -> dict[str, Any]:
    """Return the JSON schema + default values for ``GridParam``.

    Mirrors :func:`get_feature_schema` but for the panel-level
    distribute-on-a-grid operation, which is *not* a Sigima
    ``@computation_function``.
    """
    from guidata.dataset import dataset_to_schema_with_values
    from sigima.proc.image import GridParam

    return dataset_to_schema_with_values(GridParam())


def _image_extent(obj: Any) -> tuple[float, float, float, float]:
    """Return ``(x_left, y_top, width, height)`` of *obj* in physical units."""
    if getattr(obj, "is_uniform_coords", True):
        return float(obj.x0), float(obj.y0), float(obj.width), float(obj.height)
    xc = obj.xcoords
    yc = obj.ycoords
    return (
        float(xc[0]),
        float(yc[0]),
        float(xc[-1] - xc[0]),
        float(yc[-1] - yc[0]),
    )


def _translate_image(obj: Any, dx: float, dy: float) -> None:
    """Translate image *obj* by ``(dx, dy)`` in physical units (in place).

    Updates ``x0``/``y0`` (or ``xcoords``/``ycoords`` for non-uniform
    grids) and shifts attached ROIs accordingly.
    """
    if dx == 0.0 and dy == 0.0:
        return
    if getattr(obj, "is_uniform_coords", True):
        obj.x0 = float(obj.x0) + dx
        obj.y0 = float(obj.y0) + dy
    else:
        obj.xcoords = obj.xcoords + dx
        obj.ycoords = obj.ycoords + dy
    try:
        from sigima.proc.image import transformer  # type: ignore

        transformer.transform_roi(obj, "translate", dx=dx, dy=dy)
    except Exception:  # pylint: disable=broad-except
        # ROI translation is best-effort; ignore if the helper changed.
        pass


def distribute_images_on_grid(
    source_ids: list[str], params: dict[str, Any] | None = None
) -> None:
    """Lay out every image of *source_ids* on a grid (in place).

    Mirrors DataLab desktop's
    :meth:`datalab.gui.processor.image.ImageProcessor.distribute_on_grid`.
    Modifies each image's origin so the images sit side-by-side without
    creating new objects.
    """
    from sigima.proc.image import GridParam

    if hasattr(params, "to_py"):
        params = params.to_py()
    grid = GridParam()
    if params:
        from guidata.dataset import update_dataset

        update_dataset(grid, params)
    objs = [_MODEL.get(oid) for oid in source_ids]
    if not objs:
        return
    g_row = g_col = 0
    x0_anchor, y0_anchor = _image_extent(objs[0])[:2]
    x_cursor, y_cursor = x0_anchor, y0_anchor
    for i, obj in enumerate(objs):
        x_left, y_top, width, height = _image_extent(obj)
        if i == 0:
            # First image stays in place; cursor is anchored to its origin.
            pass
        else:
            dx = x_cursor - x_left
            dy = y_cursor - y_top
            _translate_image(obj, dx, dy)
        # Advance the cursor for the *next* image, mirroring DataLab desktop.
        if grid.direction == "row":
            sign = int(np.sign(grid.rows) or 1)
            g_row = (g_row + sign) % max(int(grid.rows or 1), 1)
            y_cursor += (height + float(grid.rowspac)) * sign
            if g_row == 0:
                g_col += 1
                x_cursor += width + float(grid.colspac)
                y_cursor = y0_anchor
        else:
            sign = int(np.sign(grid.cols) or 1)
            g_col = (g_col + sign) % max(int(grid.cols or 1), 1)
            x_cursor += (width + float(grid.colspac)) * sign
            if g_col == 0:
                g_row += 1
                x_cursor = x0_anchor
                y_cursor += height + float(grid.rowspac)


def reset_image_positions(source_ids: list[str]) -> None:
    """Re-anchor every image of *source_ids* on the first image's origin.

    Mirrors DataLab desktop's
    :meth:`datalab.gui.processor.image.ImageProcessor.reset_positions`.
    """
    objs = [_MODEL.get(oid) for oid in source_ids]
    if not objs:
        return
    x0_anchor, y0_anchor = _image_extent(objs[0])[:2]
    for obj in objs[1:]:
        x_left, y_top, _w, _h = _image_extent(obj)
        _translate_image(obj, x0_anchor - x_left, y0_anchor - y_top)


# ---------------------------------------------------------------------------
# Image ROI grid generation (mirrors DataLab desktop's
# "ROI > Create ROI grid…" entry).
# ---------------------------------------------------------------------------


def get_roi_grid_param_schema() -> dict[str, Any]:
    """Return the JSON schema + default values for ``ROIGridParam``."""
    from guidata.dataset import dataset_to_schema_with_values
    from sigima.proc.image import ROIGridParam

    return dataset_to_schema_with_values(ROIGridParam())


def create_image_roi_grid(
    oid: str, params: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """Replace the ROI of image *oid* with a generated grid of rectangles.

    Mirrors DataLab desktop's
    :meth:`datalab.gui.processor.image.ImageProcessor.create_roi_grid`,
    delegating the geometry to
    :func:`sigima.proc.image.generate_image_grid_roi`.

    Returns the refreshed ROI segments so the front-end can update its
    overlay in a single round-trip.
    """
    from guidata.dataset import update_dataset
    from sigima.proc.image import ROIGridParam, generate_image_grid_roi

    if hasattr(params, "to_py"):
        params = params.to_py()
    p = ROIGridParam()
    if params:
        update_dataset(p, params)
    obj = _MODEL.get(oid)
    obj.roi = generate_image_grid_roi(obj, p)
    return get_image_roi(oid)


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
        {
            "id": "blob_opencv",
            "label": "Blob detection (OpenCV)",
            "icon": "",
            "func": sipi.blob_opencv,
            "paramclass": sipi.BlobOpenCVParam,
            "separator_before": False,
            # ``cv2`` is not loaded by the bootstrap; ``_run_analysis``
            # micropip-installs ``opencv-python`` lazily on first use so
            # the cold-start cost (~12 MB) only hits users who actually
            # try OpenCV-based detection.
            "requires_pkg": "opencv-python",
        },
    ]


# Per-kind analysis catalog: {"signal": {func_id: entry}, "image": {...}}.
# Preserved across HMR so cached parameter values keep pointing at the
# right entries.
_ANALYSIS_CATALOG: dict[str, dict[str, dict[str, Any]]] = globals().get(
    "_ANALYSIS_CATALOG", {}
)
if not _ANALYSIS_CATALOG:
    _ANALYSIS_CATALOG["signal"] = {e["id"]: e for e in _build_signal_analysis_catalog()}
    _ANALYSIS_CATALOG["image"] = {e["id"]: e for e in _build_image_analysis_catalog()}


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


def get_signal_analysis_param_schema(oid: str, func_id: str) -> dict[str, Any] | None:
    """Return the JSON schema for *func_id*'s parameter set, with the
    cached values for *oid* pre-filled.  Returns ``None`` for parameter-
    less analyses."""
    return _get_analysis_param_schema("signal", oid, func_id)


def get_image_analysis_param_schema(oid: str, func_id: str) -> dict[str, Any] | None:
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
                # Canonical NaN check for plain Python floats.
                # pylint: disable-next=comparison-with-itself
                if isinstance(v, float) and (v != v):
                    return False
            except Exception:
                return False
        return True

    def _push_segment(x0: float, y0: float, x1: float, y1: float, label: str) -> None:
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


def _serialize_result(result: Any, key: str, obj: Any | None = None) -> dict[str, Any]:
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


async def run_signal_analysis(
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

    Note:
        This coroutine is awaited transparently by the JS bridge
        (``DataLabRuntime.callPy``).  It is async because some image
        analyses (e.g. ``blob_opencv``) micropip-install heavy
        dependencies on first use; signal analyses never await but the
        signature matches for symmetry with :func:`run_image_analysis`.
    """
    return await _run_analysis("signal", oid, func_id, params)


async def run_image_analysis(
    oid: str, func_id: str, params: Any = None
) -> dict[str, Any] | None:
    """Image-side counterpart of :func:`run_signal_analysis`."""
    return await _run_analysis("image", oid, func_id, params)


async def _ensure_pyodide_pkg(name: str) -> None:
    """Lazy-install a Pyodide-built package via micropip.

    No-op if the package is already installed.  Used by analyses that
    pull in heavy optional deps (currently only ``opencv-python`` for
    :func:`sigima.proc.image.blob_opencv`) so the cold-start cost is
    only paid by users who actually invoke them.
    """
    import importlib

    # Map PyPI dist name → top-level import name.
    import_name = {"opencv-python": "cv2"}.get(name, name)
    try:
        importlib.import_module(import_name)
        return
    except ImportError:
        pass
    import micropip  # type: ignore[import-not-found]

    await micropip.install(name)


async def _run_analysis(
    kind: str, oid: str, func_id: str, params: Any = None
) -> dict[str, Any] | None:
    catalog = _ANALYSIS_CATALOG.get(kind, {})
    if func_id not in catalog:
        raise KeyError(f"Unknown {kind} analysis function: {func_id!r}")
    entry = catalog[func_id]
    obj = _MODEL.get(oid)

    requires_pkg = entry.get("requires_pkg")
    if requires_pkg:
        await _ensure_pyodide_pkg(requires_pkg)

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
    payload = _serialize_result(result, key, obj)
    # For image analyses returning a GeometryResult, apply ROI creation
    # metadata if the parameter requested it (mirrors DataLab desktop's
    # ``ImageProcessor.handle_results`` override).  Sigima stores the
    # ``create_rois`` flag as a geometry attribute; ``apply_detection_rois``
    # reads it back and populates ``obj.roi`` accordingly.
    if kind == "image":
        from sigima.objects.scalar import GeometryResult

        if isinstance(result, GeometryResult):
            from sigima.proc.image import apply_detection_rois

            if apply_detection_rois(obj, result):
                payload["roi_modified"] = True
    return payload


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
        if (k.startswith("Geometry_") or k.startswith("Table_")) and k.endswith("_dict")
    ]
    for k in to_drop:
        obj.metadata.pop(k, None)
    return len(to_drop)


# The result-storage mechanism is metadata-based and therefore identical
# for signals and images.  Aliases keep the JS bridge symmetric.
list_image_results = list_signal_results
clear_image_results = clear_signal_results


# ---------------------------------------------------------------------------
# Plugin loader (browser counterpart of ``datalab.plugins`` discovery).
# ---------------------------------------------------------------------------


def _plugins_module() -> Any:
    """Return the live :mod:`dlw_plugins` module (raises if missing)."""
    import dlw_plugins  # noqa: WPS433 - intentionally lazy

    return dlw_plugins


def load_plugin_source(filename: str, source: str) -> dict[str, Any]:
    """Persist *source* under :data:`dlw_plugins.PLUGINS_ROOT` and load it.

    Returns a JSON-friendly snapshot for the new plugin record.
    """
    return _plugins_module().load_plugin_source(filename, source)


def load_plugin_file(path: str) -> dict[str, Any]:
    """Load (or reload) the plugin at *path*."""
    return _plugins_module().load_plugin_file(path)


def unload_plugin(name: str) -> dict[str, Any]:
    """Unregister and forget the plugin *name*."""
    return _plugins_module().unload_plugin(name)


def reload_plugins() -> list[dict[str, Any]]:
    """Hot-reload every currently-loaded plugin (Qt-style sequence)."""
    return _plugins_module().reload_plugins()


def discover_plugins_in_dir(directory: str) -> list[dict[str, Any]]:
    """Load every ``*.py`` file in *directory* (non-recursive)."""
    return _plugins_module().discover_plugins_in_dir(directory)


def list_plugins() -> list[dict[str, Any]]:
    """Return a JSON-friendly snapshot of every registered plugin."""
    return _plugins_module().list_plugins()


# ---------------------------------------------------------------------------
# Native HDF5 workspace I/O (DataLab-compatible)
# ---------------------------------------------------------------------------
#
# Mirrors Qt DataLab's "Open/Save HDF5 workspace" feature.  The on-disk
# layout is bit-compatible with ``datalab/h5/native.py`` +
# ``datalab/gui/panel/base.py::serialize_to_hdf5`` so files round-trip
# between desktop and web.  Each panel writes its objects under a fixed
# prefix (``DataLab_Sig`` for signals, ``DataLab_Ima`` for images); each
# group is a sub-group with a ``title`` sub-group holding its name; each
# object is a sub-group named ``"<short_id>: <sanitized_title>"`` whose
# content is produced by the standard ``SignalObj.serialize`` /
# ``ImageObj.serialize`` (powered by ``guidata.io.HDF5Writer``).

_H5_DATALAB_VERSION_KEY = "DataLab_Version"
_H5_PANEL_PREFIXES: dict[str, str] = {
    "signal": "DataLab_Sig",
    "image": "DataLab_Ima",
}
_H5_MACRO_PREFIX = "DataLab_Mac"
# DataLab-Web specific: notebooks have no equivalent in Qt DataLab so we
# pick a fresh prefix (Qt readers will simply ignore the unknown group).
_H5_NOTEBOOK_PREFIX = "DataLab_Nb"


def _h5_sanitize_name(short_id: str, title: str) -> str:
    """Return ``"<short_id>: <safe_title>"`` (mirrors Qt panel naming)."""
    import re

    safe = re.sub("[^-a-zA-Z0-9_.() ]+", "", (title or "").replace("/", "_"))
    return f"{short_id}: {safe}".rstrip(": ").rstrip()


def save_workspace_to_bytes() -> bytes:
    """Serialise the full object model to a DataLab-compatible HDF5 file.

    Returns the raw file bytes, ready to hand to a browser ``Blob`` for
    download.  Layout matches Qt DataLab's "Save HDF5 workspace" so the
    resulting ``.h5`` file is also openable from the desktop application.
    """
    import os
    import tempfile

    from guidata.io import HDF5Writer

    tmpdir = tempfile.mkdtemp(prefix="dlw_h5save_")
    path = os.path.join(tmpdir, "workspace.h5")
    try:
        writer = HDF5Writer(path)
        try:
            writer.h5[_H5_DATALAB_VERSION_KEY] = sigima.__version__
            for kind, prefix in _H5_PANEL_PREFIXES.items():
                if kind not in _MODEL._panels:  # noqa: SLF001 (intentional)
                    continue
                panel = _MODEL._panels[kind]  # noqa: SLF001
                if not panel.groups:
                    continue
                with writer.group(prefix):
                    for group in panel.groups:
                        group_name = _h5_sanitize_name(group.gid, group.name)
                        with writer.group(group_name):
                            with writer.group("title"):
                                writer.write_str(group.name)
                            for oid in group.object_ids:
                                if oid not in _MODEL._objects:  # noqa: SLF001
                                    continue
                                entry = _MODEL._objects[oid]  # noqa: SLF001
                                obj_name = _h5_sanitize_name(
                                    oid, getattr(entry.obj, "title", "") or ""
                                )
                                with writer.group(obj_name):
                                    entry.obj.serialize(writer)
            # Macros — mirror Qt MacroPanel.serialize_to_hdf5 layout
            # (group ``DataLab_Mac``; one subgroup per macro named
            # ``"m<idx:03d>: <safe_title>"`` containing ``title`` &
            # ``contents`` string sub-groups).
            if _MACROS:
                import re as _re

                with writer.group(_H5_MACRO_PREFIX):
                    for idx, mac in enumerate(_MACROS):
                        safe = _re.sub(
                            "[^-a-zA-Z0-9_.() ]+",
                            "",
                            (mac["title"] or "").replace("/", "_"),
                        )
                        name = f"m{idx + 1:03d}: {safe}".rstrip(": ").rstrip()
                        with writer.group(name):
                            with writer.group("title"):
                                writer.write_str(mac["title"])
                            with writer.group("contents"):
                                writer.write_str(mac["code"])
            # Notebooks — symmetric to macros: one subgroup per notebook
            # named ``"n<idx:03d>: <safe_title>"`` containing ``title`` &
            # ``contents`` string sub-groups (``contents`` holds the raw
            # nbformat v4.5 JSON).
            if _NOTEBOOKS:
                import re as _re

                with writer.group(_H5_NOTEBOOK_PREFIX):
                    for idx, ntb in enumerate(_NOTEBOOKS):
                        safe = _re.sub(
                            "[^-a-zA-Z0-9_.() ]+",
                            "",
                            (ntb["title"] or "").replace("/", "_"),
                        )
                        name = f"n{idx + 1:03d}: {safe}".rstrip(": ").rstrip()
                        with writer.group(name):
                            with writer.group("title"):
                                writer.write_str(ntb["title"])
                            with writer.group("contents"):
                                writer.write_str(ntb["content"])
        finally:
            writer.close()
        with open(path, "rb") as fh:
            return fh.read()
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass


def open_workspace_from_bytes(
    filename: str, data: Any, *, replace: bool = True
) -> dict[str, int]:
    """Load *data* (HDF5 bytes) into the model.

    Args:
        filename: Original file name (used only for the temporary file).
        data: Raw bytes from the browser ``File`` object.
        replace: When True (default), wipe the current model first; mirrors
            Qt DataLab's "Open HDF5 workspace" behaviour.

    Returns:
        ``{"signals": n, "images": n, "groups": n}`` for diagnostics.

    Raises:
        ValueError: when *data* is not a DataLab-compatible HDF5 workspace.
    """
    import os
    import tempfile

    from guidata.io import HDF5Reader
    from sigima.objects import ImageObj as _ImageObj

    if hasattr(data, "to_py"):
        data = data.to_py()
    if not isinstance(data, (bytes, bytearray, memoryview)):
        data = bytes(data)
    base = os.path.basename(filename) or "workspace.h5"
    tmpdir = tempfile.mkdtemp(prefix="dlw_h5open_")
    path = os.path.join(tmpdir, base)
    with open(path, "wb") as fh:
        fh.write(bytes(data))
    counts = {"signals": 0, "images": 0, "groups": 0}
    try:
        try:
            reader = HDF5Reader(path)
        except OSError as exc:
            raise ValueError(f"Not a valid HDF5 file: {exc}") from exc
        try:
            if _H5_DATALAB_VERSION_KEY not in reader.h5:
                raise ValueError(
                    "Not a DataLab HDF5 workspace "
                    f"(missing {_H5_DATALAB_VERSION_KEY!r} root attribute)"
                )
            if replace:
                _MODEL._panels.clear()  # noqa: SLF001
                _MODEL._objects.clear()  # noqa: SLF001
                _MACROS.clear()
                _NOTEBOOKS.clear()
            klass_for_kind = {"signal": SignalObj, "image": _ImageObj}
            for kind, prefix in _H5_PANEL_PREFIXES.items():
                if prefix not in reader.h5:
                    continue
                klass = klass_for_kind[kind]
                with reader.group(prefix):
                    for group_name in list(reader.h5[prefix]):
                        with reader.group(group_name):
                            try:
                                with reader.group("title"):
                                    grp_title = reader.read_str() or group_name
                            except Exception:  # noqa: BLE001
                                grp_title = group_name
                            gid = _MODEL.create_group(kind, name=grp_title)
                            counts["groups"] += 1
                            for obj_name in list(reader.h5[f"{prefix}/{group_name}"]):
                                if obj_name == "title":
                                    continue
                                with reader.group(obj_name):
                                    obj = klass()
                                    obj.deserialize(reader)
                                _MODEL.add_object(kind, obj, group_id=gid)
                                if kind == "signal":
                                    counts["signals"] += 1
                                else:
                                    counts["images"] += 1
            # Macros (mirror Qt layout — see ``save_workspace_to_bytes``).
            if _H5_MACRO_PREFIX in reader.h5:
                if replace:
                    _MACROS.clear()
                with reader.group(_H5_MACRO_PREFIX):
                    for name in list(reader.h5[_H5_MACRO_PREFIX]):
                        with reader.group(name):
                            try:
                                with reader.group("title"):
                                    title = reader.read_str() or name
                            except Exception:  # noqa: BLE001
                                title = name
                            try:
                                with reader.group("contents"):
                                    code = reader.read_str() or ""
                            except Exception:  # noqa: BLE001
                                code = ""
                        _MACROS.append(
                            {
                                "id": _new_id("m"),
                                "title": title,
                                "code": code,
                            }
                        )
            # Notebooks — symmetric to macros.
            if _H5_NOTEBOOK_PREFIX in reader.h5:
                if replace:
                    _NOTEBOOKS.clear()
                with reader.group(_H5_NOTEBOOK_PREFIX):
                    for name in list(reader.h5[_H5_NOTEBOOK_PREFIX]):
                        with reader.group(name):
                            try:
                                with reader.group("title"):
                                    title = reader.read_str() or name
                            except Exception:  # noqa: BLE001
                                title = name
                            try:
                                with reader.group("contents"):
                                    content = reader.read_str() or ""
                            except Exception:  # noqa: BLE001
                                content = ""
                        _NOTEBOOKS.append(
                            {
                                "id": _new_id("n"),
                                "title": title,
                                "content": content,
                            }
                        )
        finally:
            reader.close()
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass
    return counts


# ---------------------------------------------------------------------------
# Foreign HDF5 browser (Phase 2 — port of Qt H5BrowserDialog)
# ---------------------------------------------------------------------------
#
# Stateful: each ``h5_browser_open`` call returns a ``file_id`` that maps
# to an open ``h5py.File`` instance kept alive in
# :mod:`dlw_h5browser`.  The React UI walks the JSON tree returned here,
# requests previews on demand, then ``h5_browser_import`` injects the
# selected nodes into the live :data:`_MODEL`.

import dlw_h5browser as _h5br  # noqa: E402  pylint: disable=wrong-import-position


def h5_browser_open(filename: str, data: Any) -> dict[str, Any]:
    """Open *filename* (raw bytes) and return ``{file_id, root}``."""
    return _h5br.open_file(filename, data)


def h5_browser_close(file_id: str) -> None:
    """Close the HDF5 browser file *file_id*."""
    _h5br.close_file(file_id)


def h5_browser_close_all() -> None:
    """Close every open HDF5 browser file."""
    _h5br.close_all()


def h5_browser_node_attrs(file_id: str, node_id: str) -> dict[str, Any]:
    """Return data for the bottom "Group / Attributes" preview tabs."""
    return _h5br.node_attrs(file_id, node_id)


def h5_browser_preview(file_id: str, node_id: str) -> dict[str, Any]:
    """Return preview-ready Plotly data for the right-side preview pane."""
    return _h5br.preview(file_id, node_id)


def h5_browser_array(file_id: str, node_id: str) -> dict[str, Any]:
    """Return raw data for the "Show array" spreadsheet view."""
    return _h5br.array_data(file_id, node_id)


def h5_browser_import(
    file_id: str, node_ids: Any, group_id: str | None = None
) -> dict[str, Any]:
    """Import every node in *node_ids* into the live model.

    Returns ``{"oids": [...], "uint32_clipped": bool}``.
    """
    result = _h5br.import_nodes(file_id, node_ids, group_id=group_id)
    oids: list[str] = []
    for kind, obj in result["objects"]:
        oids.append(_MODEL.add_object(kind, obj, group_id=result["group_id"]))
    return {"oids": oids, "uint32_clipped": bool(result["uint32_clipped"])}


__all__ = [
    "ObjectModel",
    "create_signal",
    "add_signal_from_arrays",
    "add_image_from_array",
    "add_object_pickled",
    "set_object_pickled",
    "get_group_titles_with_object_info",
    "resolve_group_oids",
    "reset_all",
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
    "list_image_io_formats",
    "open_image_from_bytes",
    "save_image_to_bytes",
    "open_from_directory_chunk",
    "format_signal_basenames",
    "list_signals",
    "list_images",
    "get_object",
    "get_object_uuids",
    "get_signal_xy",
    "get_signals_xy",
    "set_signal_style",
    "create_image",
    "create_image_typed",
    "list_image_creation_types",
    "update_image_creation_params",
    "get_image_data",
    "get_images_data",
    "get_image_roi",
    "set_image_roi",
    "delete_image_roi_at",
    "extract_image_rois",
    "erase_image_area",
    "get_panel_tree",
    "create_group",
    "rename_group",
    "delete_group",
    "rename_object",
    "move_object",
    "move_objects",
    "delete_object",
    "get_object_meta",
    "set_object_meta",
    "get_plotly_annotations",
    "set_plotly_annotations",
    "get_signal_roi",
    "set_signal_roi",
    "delete_signal_roi_at",
    "extract_signal_rois",
    "save_workspace_to_bytes",
    "open_workspace_from_bytes",
    "list_macros",
    "get_macro",
    "create_macro",
    "set_macro_code",
    "rename_macro",
    "delete_macro",
    "duplicate_macro",
    "reorder_macros",
    "replace_macros",
    "lint_macro",
    "list_notebooks",
    "get_notebook",
    "create_notebook",
    "set_notebook_content",
    "rename_notebook",
    "delete_notebook",
    "duplicate_notebook",
    "reorder_notebooks",
    "replace_notebooks",
    "h5_browser_open",
    "h5_browser_close",
    "h5_browser_close_all",
    "h5_browser_node_attrs",
    "h5_browser_preview",
    "h5_browser_array",
    "h5_browser_import",
    "export_signal_csv",
    "import_signal_csv",
    "parse_text_import",
    "build_text_import_signals",
    "commit_text_import",
    "list_features",
    "get_feature_schema",
    "resolve_feature_choices",
    "apply_feature",
    "list_processings",
    "get_processing_schema",
    "resolve_processing_choices",
    "apply_processing",
    "get_last_processing",
    "reapply_last_processing",
    "get_image_grid_param_schema",
    "distribute_images_on_grid",
    "reset_image_positions",
    "get_roi_grid_param_schema",
    "create_image_roi_grid",
    "list_interactive_fits",
    "init_interactive_fit",
    "evaluate_interactive_fit",
    "auto_fit_interactive",
    "commit_interactive_fit",
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
    "set_dialog_bridge",
    "load_plugin_source",
    "load_plugin_file",
    "unload_plugin",
    "reload_plugins",
    "discover_plugins_in_dir",
    "list_plugins",
]
