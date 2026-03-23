# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""HDF5 browser backend for DataLab-Web.

Headless port of Qt DataLab's :mod:`datalab.h5.common` /
:mod:`datalab.h5.generic` / :mod:`datalab.widgets.h5browser` system.

Exposes one stateful object — :data:`STATE` — that maps a JS-visible
``file_id`` (uuid hex) to an opened :class:`H5Importer` plus its
temporary file path.  The five top-level helpers (``open_file``,
``close_file``, ``node_attrs``, ``preview``, ``import_nodes``,
``array_data``) are the public surface called from
:mod:`bootstrap`.

Differences with the Qt code:

* No ``datalab.config`` dependency — we always use ``node.name`` for the
  imported object title (Qt's "full path in title" / "file name in
  title" preferences are dropped: they belong in user settings, which
  DataLab-Web does not yet have).
* No external ``NodeFactory`` registration mechanism — the four
  generic node classes are matched in a fixed order inside
  :func:`_build_node`.
* Children are walked once at open time and the full tree is returned
  to JavaScript as a JSON-friendly dict (mirrors Qt's
  ``H5TreeWidget`` population pass).
"""

from __future__ import annotations

import os
import os.path as osp
import tempfile
import uuid
from dataclasses import dataclass
from typing import Any

import h5py
import numpy as np


# ---------------------------------------------------------------------------
# Encoding / read helpers (ported from datalab/h5/generic.py)
# ---------------------------------------------------------------------------


def _safe_decode_bytes(data: Any, fallback: str = "<binary data>") -> str:
    """Decode *data* using a sequence of common encodings."""
    if isinstance(data, str):
        return data
    if not isinstance(data, bytes):
        return str(data)
    for encoding in ("utf-8", "latin1", "cp1252", "iso-8859-1", "ascii"):
        try:
            decoded = data.decode(encoding)
            if encoding in ("latin1", "cp1252", "iso-8859-1"):
                printable = sum(1 for c in decoded if c.isprintable() or c.isspace())
                if not decoded or printable / len(decoded) >= 0.8 or len(decoded) < 20:
                    return decoded
            else:
                return decoded
        except (UnicodeDecodeError, UnicodeError):
            continue
    try:
        return data.decode("utf-8", errors="replace")
    except Exception:  # pylint: disable=broad-except  # noqa: BLE001
        return fallback


def _safe_read(dset: Any) -> Any:
    """Read *dset* with encoding fallbacks; return ``None`` on failure."""
    try:
        return dset[()]
    except UnicodeDecodeError:
        for strat in (lambda d: d.asstr()[()], lambda d: d.astype("S")[()]):
            try:
                return strat(dset)
            except Exception:  # noqa: BLE001
                continue
        return None
    except (TypeError, ValueError, OSError):
        return None


def _is_supported_num_dtype(arr: Any) -> bool:
    try:
        return arr.dtype.name.startswith(("int", "uint", "float", "complex"))
    except AttributeError:
        return False


def _is_supported_str_dtype(arr: Any) -> bool:
    try:
        return arr.dtype.name.startswith("string")
    except AttributeError:
        return False


def _format_text(data: Any) -> str:
    """Best-effort textual representation of *data*."""
    if data is None:
        return "<unreadable data>"
    if isinstance(data, bytes):
        return _safe_decode_bytes(data)
    if isinstance(data, np.ndarray):
        if data.dtype.kind in ("S", "a", "U"):
            try:
                if data.size == 1:
                    item = data.item()
                    return _safe_decode_bytes(item) if isinstance(item, bytes) else str(item)
                items = []
                for i, item in enumerate(data.flat):
                    if i >= 5:
                        items.append("...")
                        break
                    items.append(
                        _safe_decode_bytes(item) if isinstance(item, bytes) else str(item)
                    )
                return f"[{', '.join(items)}]"
            except Exception:  # noqa: BLE001
                return f"<string array: {data.shape} {data.dtype}>"
        if data.dtype.names:
            try:
                if data.size == 1:
                    parts = []
                    for fname in data.dtype.names:
                        v = data[fname].item()
                        if isinstance(v, bytes):
                            v = _safe_decode_bytes(v)
                        parts.append(f"{fname}: {v}")
                    return f"({', '.join(parts)})"
                records = []
                for i, rec in enumerate(data.flat):
                    if i >= 3:
                        records.append("...")
                        break
                    parts = []
                    for fname in data.dtype.names:
                        v = rec[fname]
                        if isinstance(v, bytes):
                            v = _safe_decode_bytes(v)
                        parts.append(f"{fname}: {v}")
                    records.append(f"({', '.join(parts)})")
                return f"[{', '.join(records)}]"
            except Exception:  # noqa: BLE001
                return f"<compound data: {data.dtype}>"
        return str(data)
    try:
        return str(data)
    except Exception:  # noqa: BLE001
        return "<unprintable data>"


# ---------------------------------------------------------------------------
# Compound -> numeric extraction (ported from GenericArrayNode)
# ---------------------------------------------------------------------------


def _extract_numeric_from_compound(data: np.ndarray) -> np.ndarray | None:
    """Return a pure-numeric array built from a structured one, or ``None``."""
    if not (hasattr(data.dtype, "names") and data.dtype.names):
        return None
    all_fields = list(data.dtype.names)
    numeric_fields = [
        n for n in all_fields if np.issubdtype(data.dtype.fields[n][0], np.number)
    ]
    if not numeric_fields:
        return None
    if len(numeric_fields) != len(all_fields):
        for n in all_fields:
            if n in numeric_fields:
                continue
            field = data[n]
            try:
                non_empty = 0
                for item in field.flat:
                    if isinstance(item, bytes):
                        if item.decode("utf-8", errors="ignore").strip():
                            non_empty += 1
                    elif isinstance(item, str) and item.strip():
                        non_empty += 1
                if non_empty / max(field.size, 1) > 0.5:
                    return None
            except Exception:  # noqa: BLE001
                return None
    try:
        if len(numeric_fields) == 1:
            return data[numeric_fields[0]]
        arrays = [data[n] for n in numeric_fields]
        if len({a.shape for a in arrays}) == 1:
            return np.stack(arrays, axis=-1)
    except Exception:  # noqa: BLE001
        pass
    return None


# ---------------------------------------------------------------------------
# Node taxonomy
# ---------------------------------------------------------------------------


@dataclass
class _NodeInfo:
    """Cached metadata for one HDF5 node, ready to ship to the UI."""

    node_id: str
    name: str
    icon_name: str
    shape_str: str
    dtype_str: str
    text: str
    description: str
    is_supported: bool
    is_array: bool
    is_group: bool
    metadata: dict[str, Any]
    children: list["_NodeInfo"]
    # Cached reference for native-object construction.
    h5path: str
    kind: str  # "group" | "scalar" | "text" | "array" | "compound" | "image" | "signal"


def _classify_dataset(dset: Any) -> tuple[str, np.ndarray | Any]:
    """Return ``(kind, data)`` for a non-Group dataset.

    ``kind`` is one of ``"scalar"``, ``"text"``, ``"array"``, ``"compound"``
    or ``"unknown"`` (matches Qt's GenericScalarNode / GenericTextNode /
    GenericArrayNode / GenericCompoundNode taxonomy).
    """
    data = _safe_read(dset)
    if data is None:
        try:
            if dset.dtype.names is not None:
                return "compound", None
            if dset.dtype.kind in ("S", "a", "U"):
                return "text", None
        except Exception:  # noqa: BLE001
            return "unknown", None
        return "unknown", None

    if isinstance(data, np.generic) and _is_supported_num_dtype(data):
        return "scalar", data
    if isinstance(data, bytes) or _is_supported_str_dtype(data):
        return "text", data

    if isinstance(data, np.ndarray):
        if data.dtype.names is not None:
            numeric = _extract_numeric_from_compound(data)
            if (
                numeric is not None
                and _is_supported_num_dtype(numeric)
                and numeric.ndim in (1, 2)
            ):
                return "array", numeric
            return "compound", data
        if data.dtype.kind in ("S", "a", "U"):
            return "text", data
        if _is_supported_num_dtype(data) and data.ndim in (1, 2):
            return "array", data

    return "unknown", data


def _shape_str(arr: Any) -> str:
    try:
        return " x ".join(str(s) for s in arr.shape)
    except Exception:  # noqa: BLE001
        return ""


def _dtype_str(dset: Any, kind: str, data: Any) -> str:
    if kind == "text":
        return "string"
    if kind == "compound":
        try:
            dtype = dset.dtype
            if dtype.names:
                fields = ", ".join(
                    f"{n}: {dtype.fields[n][0]}" for n in dtype.names
                )
                return f"compound({fields})"
        except Exception:  # noqa: BLE001
            pass
    try:
        return str(dset.dtype)
    except Exception:  # noqa: BLE001
        if data is not None and hasattr(data, "dtype"):
            return str(data.dtype)
        return "unknown"


def _truncate(text: str, n: int = 40) -> str:
    if len(text) <= n:
        return text
    return text[: n - 1] + "…"


def _array_is_signal(shape: tuple[int, ...]) -> bool:
    """Mirror Qt :py:meth:`GenericArrayNode.__is_signal`."""
    return len(shape) == 1 or shape[0] in (1, 2) or shape[1] in (1, 2)


def _build_node(file_id: str, h5path: str, dset: Any) -> _NodeInfo:
    """Recursively build one :class:`_NodeInfo`."""
    metadata = _collect_attrs(dset)

    if isinstance(dset, h5py.Group):
        name = osp.basename(h5path) or osp.basename(dset.file.filename)
        icon = "h5group.svg"
        info = _NodeInfo(
            node_id=h5path,
            name=name,
            icon_name=icon,
            shape_str="",
            dtype_str="",
            text="",
            description="",
            is_supported=False,
            is_array=False,
            is_group=True,
            metadata=metadata,
            children=[],
            h5path=h5path,
            kind="group",
        )
        for child_dset in dset.values():
            try:
                info.children.append(
                    _build_node(file_id, child_dset.name, child_dset)
                )
            except (UnicodeDecodeError, TypeError, ValueError, KeyError) as exc:
                print(
                    f"[h5browser] skip {child_dset.name!r}: {type(exc).__name__}: {exc}"
                )
        return info

    kind, data = _classify_dataset(dset)
    name = osp.basename(h5path)

    shape = ""
    icon = "h5scalar.svg"
    is_array = False
    is_supported = False

    if kind == "array":
        is_array = True
        shape = _shape_str(data)
        supported = data is not None and data.size > 1
        is_supported = bool(supported)
        if supported and _array_is_signal(data.shape):
            icon = "signal.svg"
            kind = "signal"
        elif supported:
            icon = "image.svg"
            kind = "image"
        else:
            icon = "h5array.svg"
    elif kind == "compound":
        is_array = True
        if data is not None:
            shape = _shape_str(data)
        icon = "h5array.svg"
    elif kind == "scalar":
        icon = "h5scalar.svg"
    elif kind == "text":
        icon = "h5scalar.svg"
    else:
        icon = "h5scalar.svg"

    text = _truncate(_format_text(data))
    dtype_str = _dtype_str(dset, kind, data)

    return _NodeInfo(
        node_id=h5path,
        name=name,
        icon_name=icon,
        shape_str=shape,
        dtype_str=dtype_str,
        text=text,
        description="",
        is_supported=is_supported,
        is_array=is_array,
        is_group=False,
        metadata=metadata,
        children=[],
        h5path=h5path,
        kind=kind,
    )


def _collect_attrs(dset: Any) -> dict[str, Any]:
    """Return a JSON-friendly copy of *dset*'s attributes."""
    out: dict[str, Any] = {}
    try:
        items = list(dset.attrs.items())
    except Exception:  # noqa: BLE001
        return out
    for key, value in items:
        if isinstance(value, bytes):
            value = _safe_decode_bytes(value)
        if isinstance(value, np.ndarray):
            try:
                value = value.tolist()
            except Exception:  # noqa: BLE001
                value = repr(value)
        elif isinstance(value, (np.integer,)):
            value = int(value)
        elif isinstance(value, (np.floating,)):
            value = float(value)
        elif isinstance(value, (np.bool_,)):
            value = bool(value)
        elif not isinstance(value, (str, int, float, bool, list)):
            value = repr(value)
        out[str(key)] = value
    return out


# ---------------------------------------------------------------------------
# Native object construction (signal / image)
# ---------------------------------------------------------------------------


def _data_to_xy(data: np.ndarray):
    """Port of ``datalab.h5.common.data_to_xy``."""
    if len(data.ravel()) == len(data):
        return np.arange(len(data)), data.ravel(), None, None
    rows, cols = data.shape
    for colnb in (2, 3, 4):
        if cols == colnb and rows > colnb:
            data = data.T
            break
    if len(data) == 1:
        data = data.T
    if len(data) not in (2, 3, 4):
        raise ValueError(f"Invalid data: len(data)={len(data)} (expected 2, 3 or 4)")
    x, y = data[:2]
    dx, dy = None, None
    if len(data) == 3:
        dy = data[2]
    if len(data) == 4:
        dx, dy = data[2:]
    return x, y, dx, dy


def _build_native_signal(node_data: np.ndarray, title: str):
    """Convert *node_data* into a :class:`SignalObj` (or ``None``)."""
    from sigima.objects import create_signal

    obj = create_signal(title)
    data = node_data
    if data.dtype not in (float, np.complex128):
        data = np.asarray(data, dtype=float)
    if data.ndim == 1:
        obj.set_xydata(np.arange(data.size), data)
    else:
        x, y, dx, dy = _data_to_xy(data)
        obj.set_xydata(x, y, dx, dy)
    return obj


def _build_native_image(node_data: np.ndarray, title: str) -> tuple[Any, bool]:
    """Convert *node_data* into a :class:`ImageObj`.

    Returns ``(image_obj, uint32_clipped)``.
    """
    from sigima.objects import create_image

    uint32_clipped = False
    data = node_data
    if data.dtype == np.uint32:
        uint32_clipped = bool(data.max() > np.iinfo(np.int32).max)
        data = np.asarray(data.clip(0, np.iinfo(np.int32).max), dtype=np.int32)
    obj = create_image(title)
    obj.data = data
    return obj, uint32_clipped


# ---------------------------------------------------------------------------
# Public state + helpers
# ---------------------------------------------------------------------------


@dataclass
class _OpenFile:
    """One open HDF5 file."""

    file_id: str
    filename: str
    temp_path: str
    h5: Any
    tree: _NodeInfo
    nodes_by_path: dict[str, _NodeInfo]


# Preserved across HMR re-execution.
STATE: dict[str, _OpenFile] = globals().get("_DLW_H5_STATE", {})  # type: ignore[assignment]
globals()["_DLW_H5_STATE"] = STATE


def _info_to_dict(info: _NodeInfo) -> dict[str, Any]:
    return {
        "id": info.node_id,
        "name": info.name,
        "icon_name": info.icon_name,
        "shape_str": info.shape_str,
        "dtype_str": info.dtype_str,
        "text": info.text,
        "description": info.description,
        "is_supported": info.is_supported,
        "is_array": info.is_array,
        "is_group": info.is_group,
        "kind": info.kind,
        "children": [_info_to_dict(c) for c in info.children],
    }


def _flatten(info: _NodeInfo, out: dict[str, _NodeInfo]) -> None:
    out[info.node_id] = info
    for child in info.children:
        _flatten(child, out)


def open_file(filename: str, data: Any) -> dict[str, Any]:
    """Open an HDF5 file from raw *data* and return ``{file_id, root}``."""
    if hasattr(data, "to_py"):
        data = data.to_py()
    if not isinstance(data, (bytes, bytearray, memoryview)):
        data = bytes(data)
    base = osp.basename(filename) or "browse.h5"
    tmpdir = tempfile.mkdtemp(prefix="dlw_h5br_")
    path = osp.join(tmpdir, base)
    with open(path, "wb") as fh:
        fh.write(bytes(data))
    try:
        h5 = h5py.File(path, "r")
    except Exception as exc:  # noqa: BLE001
        try:
            os.remove(path)
            os.rmdir(tmpdir)
        except OSError:
            pass
        raise ValueError(f"Cannot open {base!r} as an HDF5 file: {exc}") from exc
    file_id = uuid.uuid4().hex[:8]
    root_info = _build_node(file_id, "/", h5)
    # Override root display name to file basename (mirrors Qt RootNode).
    root_info.name = osp.basename(filename) or osp.basename(path)
    root_info.icon_name = "h5file.svg"
    root_info.description = filename
    nodes_by_path: dict[str, _NodeInfo] = {}
    _flatten(root_info, nodes_by_path)
    STATE[file_id] = _OpenFile(
        file_id=file_id,
        filename=filename,
        temp_path=path,
        h5=h5,
        tree=root_info,
        nodes_by_path=nodes_by_path,
    )
    return {"file_id": file_id, "filename": filename, "root": _info_to_dict(root_info)}


def close_file(file_id: str) -> None:
    """Close *file_id* and free its resources."""
    entry = STATE.pop(file_id, None)
    if entry is None:
        return
    try:
        entry.h5.close()
    except Exception:  # noqa: BLE001
        pass
    try:
        os.remove(entry.temp_path)
    except OSError:
        pass
    try:
        os.rmdir(osp.dirname(entry.temp_path))
    except OSError:
        pass


def close_all() -> None:
    """Close every open file."""
    for fid in list(STATE.keys()):
        close_file(fid)


def _require_node(file_id: str, node_id: str) -> tuple[_OpenFile, _NodeInfo]:
    if file_id not in STATE:
        raise KeyError(f"Unknown HDF5 browser file: {file_id!r}")
    entry = STATE[file_id]
    if node_id not in entry.nodes_by_path:
        raise KeyError(f"Unknown HDF5 node: {node_id!r}")
    return entry, entry.nodes_by_path[node_id]


def node_attrs(file_id: str, node_id: str) -> dict[str, Any]:
    """Return data for the bottom "Group / Attributes" preview tabs."""
    entry, info = _require_node(file_id, node_id)
    text_preview = info.text
    # Show the first 5 lines for groups/text (mirrors Qt GroupAndAttributes).
    if text_preview:
        lines = text_preview.splitlines()[:5]
        if len(lines) == 5:
            lines.append("[...]")
        text_preview = "\n".join(lines)
    return {
        "path": info.node_id,
        "name": info.name,
        "description": info.description or entry.filename,
        "text_preview": text_preview,
        "attributes": info.metadata,
    }


def preview(file_id: str, node_id: str) -> dict[str, Any]:
    """Return preview-ready data for the right-side Plotly view."""
    entry, info = _require_node(file_id, node_id)
    if not info.is_supported or info.kind not in ("signal", "image"):
        return {"kind": "unsupported"}
    dset = entry.h5[info.h5path]
    raw = _safe_read(dset)
    if raw is None:
        return {"kind": "unsupported"}
    if isinstance(raw, np.ndarray) and raw.dtype.names is not None:
        numeric = _extract_numeric_from_compound(raw)
        if numeric is None:
            return {"kind": "unsupported"}
        raw = numeric
    try:
        if info.kind == "signal":
            obj = _build_native_signal(raw, info.name)
            return {
                "kind": "signal",
                "title": obj.title,
                "x": obj.x.tolist(),
                "y": obj.y.tolist(),
            }
        # image
        img, _u32 = _build_native_image(raw, info.name)
        return {
            "kind": "image",
            "title": img.title,
            "data": img.data.tolist(),
            "width": int(img.data.shape[1]),
            "height": int(img.data.shape[0]),
        }
    except Exception as exc:  # noqa: BLE001
        return {"kind": "unsupported", "error": str(exc)}


def array_data(file_id: str, node_id: str) -> dict[str, Any]:
    """Return raw data for the "Show array" spreadsheet view."""
    entry, info = _require_node(file_id, node_id)
    if not info.is_array:
        raise ValueError(f"Node {node_id!r} is not array-like")
    dset = entry.h5[info.h5path]
    raw = _safe_read(dset)
    if raw is None:
        raise ValueError(f"Cannot read data from {node_id!r}")
    if isinstance(raw, np.ndarray) and raw.dtype.names is not None:
        numeric = _extract_numeric_from_compound(raw)
        if numeric is not None:
            raw = numeric
    arr = np.asarray(raw)
    return {
        "shape": list(arr.shape),
        "dtype": str(arr.dtype),
        "data": arr.tolist(),
    }


def import_nodes(file_id: str, node_ids: Any, group_id: str | None = None):
    """Import every node id in *node_ids* into the live model.

    Returns a dict ``{"oids": [...], "uint32_clipped": bool}``.  Caller
    (``bootstrap.py``) is responsible for actually attaching the objects
    to the live :data:`_MODEL`; this function returns the constructed
    native objects, paired with their target panel kind, so we do not
    introduce a circular import here.
    """
    if hasattr(node_ids, "to_py"):
        node_ids = node_ids.to_py()
    node_ids = list(node_ids or [])
    if file_id not in STATE:
        raise KeyError(f"Unknown HDF5 browser file: {file_id!r}")
    entry = STATE[file_id]
    built: list[tuple[str, Any]] = []
    uint32_clipped = False
    for nid in node_ids:
        if nid not in entry.nodes_by_path:
            raise KeyError(f"Unknown HDF5 node: {nid!r}")
        info = entry.nodes_by_path[nid]
        if not info.is_supported or info.kind not in ("signal", "image"):
            continue
        dset = entry.h5[info.h5path]
        raw = _safe_read(dset)
        if raw is None:
            continue
        if isinstance(raw, np.ndarray) and raw.dtype.names is not None:
            numeric = _extract_numeric_from_compound(raw)
            if numeric is None:
                continue
            raw = numeric
        try:
            if info.kind == "signal":
                obj = _build_native_signal(raw, info.name)
                kind = "signal"
            else:
                obj, clipped = _build_native_image(raw, info.name)
                if clipped:
                    uint32_clipped = True
                kind = "image"
        except Exception as exc:  # noqa: BLE001
            print(f"[h5browser] failed to build object for {nid!r}: {exc}")
            continue
        # Attach origin metadata (mirrors Qt BaseNode.__process_metadata).
        try:
            obj.set_metadata_option("HDF5Path", entry.filename)
            obj.set_metadata_option("HDF5Dataset", info.node_id)
            obj.metadata.update(info.metadata)
        except Exception:  # noqa: BLE001
            pass
        built.append((kind, obj))
    return {"objects": built, "uint32_clipped": uint32_clipped, "group_id": group_id}
