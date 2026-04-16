"""
DataLab-Web macro proxy (runs inside the Pyodide Web Worker).

Exposes a single ``proxy`` global whose methods mirror DataLab desktop's
:class:`datalab.control.proxy.RemoteProxy` API surface. Each method is
``async`` because it dispatches a JSON request to the main thread (which
owns the live :data:`bootstrap._MODEL`) and ``await`` s the response.

Macros must therefore use ``await proxy.add_signal(...)`` etc.
"""

from __future__ import annotations

import js  # type: ignore[import-not-found]
import numpy as np
from pyodide.ffi import to_js  # type: ignore[import-not-found]


# The JS side installs ``js._dlw_bridge_call(method: str, payload: any)``;
# it returns a Promise resolving to the deserialised JS reply.
def _bridge():
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
    payload = to_js(_to_jsable(kwargs), dict_converter=js.Object.fromEntries)
    result = await _bridge()(method, payload)
    if hasattr(result, "to_py"):
        return result.to_py()
    return result


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
        return await _call("list_signals")

    async def list_images(self):
        return await _call("list_images")

    async def get_object(self, oid: str):
        return await _call("get_object", oid=oid)

    async def get_object_uuids(self, panel: str = "signal"):
        return await _call("get_object_uuids", panel=panel)

    async def select_objects(self, oids, panel: str | None = None):
        return await _call("select_objects", oids=list(oids), panel=panel)

    async def delete_object(self, oid: str):
        return await _call("delete_object", oid=oid)

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
        return await _call("list_features")

    # -- Panel control -----------------------------------------------------

    async def get_current_panel(self) -> str:
        return await _call("get_current_panel")

    async def set_current_panel(self, panel: str) -> None:
        return await _call("set_current_panel", panel=panel)

    # -- Generic call (escape hatch) --------------------------------------

    async def call_method(self, name: str, *args, **kwargs):
        """Call any whitelisted runtime method by name.

        Mirrors :meth:`RemoteProxy.call_method` for parity with desktop
        macros that use ``proxy.call_method("delete_all_objects", ...)``.
        """
        return await _call("call_method", name=name, args=list(args), kwargs=kwargs)


proxy = _Proxy()
