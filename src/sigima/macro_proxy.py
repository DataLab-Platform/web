"""
DataLab-Web macro proxy (runs inside the Pyodide Web Worker).

Exposes a single ``proxy`` global whose methods mirror DataLab desktop's
:class:`datalab.control.proxy.RemoteProxy` API surface. Each method is
``async`` because it dispatches a JSON request to the main thread (which
owns the live :data:`bootstrap._MODEL`) and ``await`` s the response.

Macros must therefore use ``await proxy.add_signal(...)`` etc.
"""

# ``js._dlw_bridge_call`` is the conventional name (with leading
# underscore) used on the JS side for the worker bridge entry point.
# It is part of the documented contract between this module and
# ``runtime.ts`` — not a private member of a Python class.
# pylint: disable=protected-access

from __future__ import annotations

import base64
import pickle

import js  # type: ignore[import-not-found]
import numpy as np
from pyodide.ffi import to_js  # type: ignore[import-not-found]


# The JS side installs ``js._dlw_bridge_call(method: str, payload: any)``;
# it returns a Promise resolving to the deserialised JS reply.
def _bridge():
    """Return the JS bridge function installed by ``runtime.ts``."""
    return js._dlw_bridge_call


def _to_jsable(value):
    """Convert a Python value into something safe to pass to JS.

    Numpy arrays become plain lists (``tolist`` recurses).  Everything
    else passes through and pyodide will handle the conversion.
    """
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (list, tuple)):
        return [_to_jsable(v) for v in value]
    if isinstance(value, dict):
        return {k: _to_jsable(v) for k, v in value.items()}
    return value


async def _call(method: str, **kwargs):
    """Issue one bridge call to the main thread and return the deserialised reply."""
    payload = to_js(_to_jsable(kwargs), dict_converter=js.Object.fromEntries)
    result = await _bridge()(method, payload)
    if hasattr(result, "to_py"):
        return result.to_py()
    return result


def _detect_kind(obj) -> str:
    """Return ``"signal"`` or ``"image"`` based on *obj* class name."""
    cls = type(obj).__name__
    if cls == "SignalObj":
        return "signal"
    if cls == "ImageObj":
        return "image"
    raise TypeError(f"Expected SignalObj or ImageObj, got {cls!r}")


class _Proxy:
    """Async mirror of :class:`datalab.control.proxy.RemoteProxy`.

    Every public method ``await`` s a single round-trip to the main
    thread.  Numpy arrays in arguments are auto-converted to lists.
    """

    # -- Object creation ---------------------------------------------------

    async def add_signal(
        self,
        title: str,
        xdata,
        ydata,
        xunit: str = "",
        yunit: str = "",
        xlabel: str = "",
        ylabel: str = "",
        group_id: str | None = None,
    ) -> str:
        """Create a 1D signal in the live workspace; return its UUID."""
        return await _call(
            "add_signal",
            title=title,
            xdata=xdata,
            ydata=ydata,
            xunit=xunit,
            yunit=yunit,
            xlabel=xlabel,
            ylabel=ylabel,
            group_id=group_id,
        )

    async def add_image(
        self,
        title: str,
        data,
        xunit: str = "",
        yunit: str = "",
        zunit: str = "",
        xlabel: str = "",
        ylabel: str = "",
        zlabel: str = "",
        group_id: str | None = None,
    ) -> str:
        """Create a 2D image in the live workspace; return its UUID."""
        return await _call(
            "add_image",
            title=title,
            data=data,
            xunit=xunit,
            yunit=yunit,
            zunit=zunit,
            xlabel=xlabel,
            ylabel=ylabel,
            zlabel=zlabel,
            group_id=group_id,
        )

    # -- Object access -----------------------------------------------------

    async def list_signals(self):
        """Return metadata for every signal in the workspace."""
        return await _call("list_signals")

    async def list_images(self):
        """Return metadata for every image in the workspace."""
        return await _call("list_images")

    async def get_object(self, oid: str):
        """Return the JSON-friendly representation of object *oid*."""
        return await _call("get_object", oid=oid)

    async def get_object_uuids(self, panel: str = "signal"):
        """Return every object UUID in *panel*."""
        return await _call("get_object_uuids", panel=panel)

    async def select_objects(self, oids, panel: str | None = None):
        """Select *oids* in *panel* (or in the current panel if ``None``)."""
        return await _call("select_objects", oids=list(oids), panel=panel)

    async def delete_object(self, oid: str):
        """Remove object *oid* from the workspace."""
        return await _call("delete_object", oid=oid)

    async def add_object(self, obj, group_id: str = "", set_current: bool = True):
        """Publish a fully-formed ``SignalObj`` / ``ImageObj`` to the workspace.

        Mirrors :meth:`RemoteProxy.add_object`. The object is pickled
        and shipped across the worker bridge; both runtimes share the
        same Sigima version so binary compatibility holds.
        """
        kind = _detect_kind(obj)
        return await _call(
            "add_object",
            pickled_b64=base64.b64encode(pickle.dumps(obj)).decode("ascii"),
            kind=kind,
            group_id=group_id or None,
            set_current=set_current,
        )

    async def set_object(self, obj):
        """Replace an existing object's data, matched by its UUID.

        The object must carry a UUID from a previous :meth:`get_object`
        call (or have been built locally with one). Raises ``KeyError``
        on the main side if no live object matches.
        """
        return await _call(
            "set_object",
            pickled_b64=base64.b64encode(pickle.dumps(obj)).decode("ascii"),
        )

    # -- Groups ------------------------------------------------------------

    async def add_group(
        self, title: str, panel: str | None = None, select: bool = False
    ) -> str:
        """Create a new group; return its id (mirrors :meth:`RemoteProxy.add_group`)."""
        return await _call("add_group", title=title, panel=panel, select=select)

    async def select_groups(self, selection=None, panel: str | None = None):
        """Select groups in *panel* (or in the current panel if ``None``).

        *selection* may be a list of group ids (str), 1-based indices
        (int), or ``None`` to select every group.
        """
        sel = None if selection is None else list(selection)
        return await _call("select_groups", selection=sel, panel=panel)

    async def get_group_titles_with_object_info(self, panel: str | None = None):
        """Return ``(group_titles, group_obj_uuids, group_obj_titles)`` for *panel*."""
        return await _call("get_group_titles_with_object_info", panel=panel)

    # -- Workspace ---------------------------------------------------------

    async def reset_all(self) -> None:
        """Clear every object and group in every panel."""
        return await _call("reset_all")

    # -- Raw data access (used by notebook ``show_signal`` / ``show_image``)

    async def get_signal_xy(self, oid: str):
        """Return ``{"x": [...], "y": [...]}`` for signal *oid*."""
        return await _call("get_signal_xy", oid=oid)

    async def get_image_data(self, oid: str):
        """Return the 2D pixel array (list of lists) for image *oid*."""
        return await _call("get_image_data", oid=oid)

    # -- Processing --------------------------------------------------------

    async def calc(
        self,
        feature_id: str,
        params=None,
        sources=None,
        operand=None,
    ):
        """Apply a registered processing.

        Args:
            feature_id: The id reported by ``list_features`` / ``calc``
                catalog (e.g. ``"normalize"`` or ``"image:fft"``).
            params: ``dict`` of parameter values, or ``None`` to use
                defaults.
            sources: List of source object ids; ``None`` ⇒ current
                selection on the source's panel.
            operand: Second operand id for binary operations.
        """
        return await _call(
            "apply_feature",
            feature_id=feature_id,
            params=params,
            sources=sources,
            operand=operand,
        )

    async def list_features(self):
        """Return the JSON-friendly catalogue of registered features."""
        return await _call("list_features")

    # -- Panel control -----------------------------------------------------

    async def get_current_panel(self) -> str:
        """Return the currently active panel kind."""
        return await _call("get_current_panel")

    async def set_current_panel(self, panel: str) -> None:
        """Switch the active panel kind."""
        return await _call("set_current_panel", panel=panel)

    # -- Generic call (escape hatch) --------------------------------------

    async def call_method(self, name: str, *args, **kwargs):
        """Call any whitelisted runtime method by name.

        Mirrors :meth:`RemoteProxy.call_method` for parity with desktop
        macros that use ``proxy.call_method("delete_all_objects", ...)``.
        """
        return await _call("call_method", name=name, args=list(args), kwargs=kwargs)


proxy = _Proxy()
