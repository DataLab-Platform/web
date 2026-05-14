"""
DataLab-Web notebook display helpers.

Loaded once into the notebook Pyodide worker (alongside ``macro_proxy``).
Owns:

* the persistent **user namespace** (``_USER_NS``) — survives across
  cells, the equivalent of an IPython user namespace;
* the **execution counter** (``_EXEC_COUNT``) bumped by the worker on
  every ``exec_cell`` request;
* the **cell executor** (``_exec_cell``) — uses
  :func:`pyodide.code.eval_code_async` so user code may freely use
  ``await`` (in particular ``await proxy.add_signal(...)``) at the top
  level, and so the **last expression** of the cell is captured and
  emitted as an ``execute_result`` MIME bundle (just like Jupyter);
* the public Python helpers exposed in the user namespace:
  ``display(obj, mime=None)``, ``show_signal(...)``, ``show_image(...)``.

The JS side (``notebookWorker.ts``) is intentionally agnostic: it just
forwards the MIME bundles to the main thread which routes them to the
appropriate React renderer in ``OutputArea.tsx``.
"""

# ``js._dlw_*`` globals are installed by ``notebookWorker.ts``; that's
# the documented contract between the two layers.
# pylint: disable=protected-access

from __future__ import annotations

import base64
import io
import sys
import traceback
from typing import Any

import js  # type: ignore[import-not-found]
import numpy as np
from pyodide.code import eval_code_async  # type: ignore[import-not-found]
from pyodide.ffi import to_js  # type: ignore[import-not-found]

# ---------------------------------------------------------------------------
# Persistent user namespace + execution counter
# ---------------------------------------------------------------------------

# Built lazily on first access so we can inject ``proxy``, ``np``,
# ``display``, ``show_signal``, ``show_image`` at the right moment.
_USER_NS: dict[str, Any] | None = None
_EXEC_COUNT = 0


def _get_user_ns() -> dict[str, Any]:
    """Return the persistent user namespace, building it on first call."""
    global _USER_NS  # pylint: disable=global-statement
    if _USER_NS is None:
        # ``proxy`` was injected by ``macro_proxy.py`` running just before us.
        proxy = sys.modules["__main__"].__dict__.get("proxy")
        if proxy is None:  # pragma: no cover — defensive
            try:
                # pylint: disable=import-outside-toplevel
                from macro_proxy import proxy as _p  # type: ignore[import-not-found]

                proxy = _p
            except Exception:  # pylint: disable=broad-exception-caught
                proxy = None
        _USER_NS = {
            "__name__": "__main__",
            "__doc__": None,
            "__builtins__": __builtins__,
            "np": np,
            "proxy": proxy,
            "display": display,
            "show_signal": show_signal,
            "show_image": show_image,
        }
    return _USER_NS


def _bump_exec_count() -> int:
    """Increment and return the global cell execution counter."""
    global _EXEC_COUNT  # pylint: disable=global-statement
    _EXEC_COUNT += 1
    return _EXEC_COUNT


# ---------------------------------------------------------------------------
# MIME serialisation
# ---------------------------------------------------------------------------

# Try to import sigima's shared result-display wrappers. When they are not
# available (older Sigima releases — the extraction PR is in flight), fall
# back to the lightweight vendored copies further down so notebooks still
# render TableResult / GeometryResult prettily.
try:  # pragma: no cover — exercised in Pyodide
    from sigima.viz.results_display import (
        GeometryResultDisplay as _GeometryResultDisplay,
    )
    from sigima.viz.results_display import (  # type: ignore[import-not-found]
        TableResultDisplay as _TableResultDisplay,
    )
except ImportError:
    _TableResultDisplay = None
    _GeometryResultDisplay = None


def _is_plotly_figure(obj: Any) -> bool:
    """Best-effort detection without importing plotly at module load time."""
    cls = type(obj)
    return cls.__module__.startswith("plotly.") and cls.__name__ in {
        "Figure",
        "FigureWidget",
    }


def _wrap_result(obj: Any) -> Any:
    """Wrap raw Sigima results in their HTML display shim, if available."""
    if obj is None:
        return None
    cls_name = type(obj).__name__
    if _TableResultDisplay is not None and cls_name == "TableResult":
        return _TableResultDisplay(obj)
    if _GeometryResultDisplay is not None and cls_name == "GeometryResult":
        return _GeometryResultDisplay(obj)
    if _TableResultDisplay is None and cls_name == "TableResult":
        return _VendoredTableDisplay(obj)
    if _GeometryResultDisplay is None and cls_name == "GeometryResult":
        return _VendoredGeometryDisplay(obj)
    return obj


def _to_mime_bundle(obj: Any) -> dict[str, Any] | None:
    """Convert a Python object to a Jupyter-style MIME bundle.

    Returns ``None`` for ``None`` (so the displayhook can stay silent on
    statements that produce no value, mirroring Python's REPL).
    """
    if obj is None:
        return None
    obj = _wrap_result(obj)

    # Plotly figures → ``application/vnd.plotly.v1+json``.
    if _is_plotly_figure(obj):
        try:
            fig_dict = obj.to_dict()
            return {
                "application/vnd.plotly.v1+json": {
                    "data": fig_dict.get("data", []),
                    "layout": fig_dict.get("layout", {}),
                    "config": fig_dict.get("config", {"responsive": True}),
                },
                "text/plain": f"<plotly.{type(obj).__name__}>",
            }
        except Exception:  # pylint: disable=broad-exception-caught
            pass  # Fall through to repr.

    # Raw PNG bytes (e.g. matplotlib's ``fig.canvas.tostring_rgb`` or any
    # in-memory PNG file) → ``image/png`` (base64-encoded data URL).
    if isinstance(obj, (bytes, bytearray)) and obj[:8] == b"\x89PNG\r\n\x1a\n":
        return {"image/png": base64.b64encode(bytes(obj)).decode("ascii")}

    bundle: dict[str, Any] = {}

    # Honour Jupyter-style ``_repr_*_`` mimebundle protocol.
    repr_methods = (
        ("text/html", "_repr_html_"),
        ("image/svg+xml", "_repr_svg_"),
        ("image/png", "_repr_png_"),
        ("application/json", "_repr_json_"),
        ("text/markdown", "_repr_markdown_"),
        ("text/latex", "_repr_latex_"),
    )
    for mime, attr in repr_methods:
        meth = getattr(obj, attr, None)
        if callable(meth):
            try:
                value = meth()  # pylint: disable=not-callable
            except Exception:  # pylint: disable=broad-exception-caught
                continue
            if value is None:
                continue
            if mime == "image/png" and isinstance(value, (bytes, bytearray)):
                value = base64.b64encode(bytes(value)).decode("ascii")
            bundle[mime] = value

    # Always provide a text/plain fallback (Jupyter convention).
    try:
        bundle.setdefault("text/plain", repr(obj))
    except Exception:  # pylint: disable=broad-exception-caught
        bundle.setdefault("text/plain", f"<{type(obj).__name__}>")

    return bundle


def _post(mime: dict[str, Any], *, kind: str) -> None:
    """Hand a MIME bundle off to the JS side (display vs execute_result)."""
    payload = to_js(mime, dict_converter=js.Object.fromEntries)
    if kind == "execute_result":
        js._dlw_post_execute_result(payload)
    else:
        js._dlw_post_display(payload)


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def display(obj: Any, mime: str | None = None) -> None:
    """Force the display of *obj* (IPython-style helper).

    Args:
        obj: any Python object; auto-detection picks the best MIME type.
        mime: optional explicit MIME type ("text/html", "image/png",
            "text/plain"). When set, the value is wrapped as
            ``{mime: obj}`` after a minimal coercion (bytes → base64
            for images, ``str(obj)`` otherwise).
    """
    if mime is not None:
        if mime.startswith("image/") and isinstance(obj, (bytes, bytearray)):
            value = base64.b64encode(bytes(obj)).decode("ascii")
        elif mime.startswith("application/") and not isinstance(obj, str):
            value = obj  # JSON-like; let to_js handle it.
        else:
            value = obj if isinstance(obj, str) else str(obj)
        _post({mime: value}, kind="display")
        return
    bundle = _to_mime_bundle(obj)
    if bundle:
        _post(bundle, kind="display")


async def show_signal(uuid_or_title: str, *, title: str | None = None) -> None:
    """Render a workspace signal as a small Plotly curve, inline.

    Mini-view, *not* a replacement for the Signals panel — the intent is
    to embed a quick reference plot in a notebook narrative without
    leaving the cell flow.
    """
    proxy = _get_user_ns()["proxy"]
    oid = await _resolve_oid(proxy, uuid_or_title, panel="signal")
    xy = await proxy.get_signal_xy(oid)
    obj = await proxy.get_object(oid)
    plot_title = (
        title or obj.get("title", oid) if isinstance(obj, dict) else uuid_or_title
    )
    fig_dict = {
        "data": [
            {
                "type": "scattergl",
                "mode": "lines",
                "x": list(xy["x"]),
                "y": list(xy["y"]),
                "name": plot_title,
            }
        ],
        "layout": {
            "title": {"text": plot_title},
            "margin": {"l": 50, "r": 20, "t": 40, "b": 40},
            "height": 320,
        },
    }
    bundle = {
        "application/vnd.plotly.v1+json": {
            **fig_dict,
            "config": {"responsive": True},
        },
        "text/plain": f"<show_signal {plot_title!r}>",
    }
    _post(bundle, kind="display")


async def show_image(uuid_or_title: str, *, title: str | None = None) -> None:
    """Render a workspace image as a small Plotly heatmap, inline."""
    proxy = _get_user_ns()["proxy"]
    oid = await _resolve_oid(proxy, uuid_or_title, panel="image")
    data = await proxy.get_image_data(oid)
    obj = await proxy.get_object(oid)
    plot_title = (
        title or obj.get("title", oid) if isinstance(obj, dict) else uuid_or_title
    )
    fig_dict = {
        "data": [{"type": "heatmap", "z": data, "colorscale": "Viridis"}],
        "layout": {
            "title": {"text": plot_title},
            "margin": {"l": 50, "r": 20, "t": 40, "b": 40},
            "height": 360,
            "yaxis": {"autorange": "reversed", "scaleanchor": "x"},
        },
    }
    bundle = {
        "application/vnd.plotly.v1+json": {
            **fig_dict,
            "config": {"responsive": True},
        },
        "text/plain": f"<show_image {plot_title!r}>",
    }
    _post(bundle, kind="display")


async def _resolve_oid(proxy: Any, key: str, *, panel: str) -> str:
    """Resolve *key* as a UUID or as an object title in *panel*."""
    uuids = await proxy.get_object_uuids(panel=panel)
    uuids = list(uuids)
    if key in uuids:
        return key
    # Match by title (best effort — first match wins, like DataLab desktop).
    for oid in uuids:
        info = await proxy.get_object(oid)
        if isinstance(info, dict) and info.get("title") == key:
            return oid
    raise LookupError(f"No {panel} object matches {key!r}")


# ---------------------------------------------------------------------------
# Cell executor
# ---------------------------------------------------------------------------


async def _exec_cell(source: str) -> None:
    """Execute *source* in the persistent user namespace.

    * Top-level ``await`` is supported (we use ``eval_code_async``).
    * The **last expression** of the cell, if any, is auto-displayed via
      ``execute_result`` (Jupyter convention).
    * Exceptions are formatted with a Python traceback and emitted as an
      ``error`` message before being re-raised so the worker can also
      mark the cell as finished-with-error.
    """
    ns = _get_user_ns()
    try:
        result = await eval_code_async(
            source,
            globals=ns,
            return_mode="last_expr",
            quiet_trailing_semicolon=True,
            filename="<cell>",
        )
    except BaseException as exc:  # pylint: disable=broad-exception-caught
        # The traceback is the most useful artefact for the user — print
        # it to stderr (which already routes to the cell's output area).
        # The worker's catch path will additionally emit a structured
        # ``error`` message and ``cell_finished {ok: False}``.
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        js._dlw_post_stream("stderr", tb)
        raise
    bundle = _to_mime_bundle(result)
    if bundle is not None:
        _post(bundle, kind="execute_result")


# ---------------------------------------------------------------------------
# Vendored TableResult / GeometryResult display shims
# ---------------------------------------------------------------------------
# Trimmed-down copies of the wrappers that live in DataLab-Kernel's
# ``plotter.py``. Removed once Sigima ships ``sigima.viz.results_display``
# (PR in flight). Pure ``_repr_html_`` based; no Jupyter dependency.

_VENDORED_TABLE_STYLE = """
<style>
.sigima-table { border-collapse: collapse; font-family: -apple-system,
  BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px;
  margin: 10px 0; }
.sigima-table th { background-color: #f8f9fa; border: 1px solid #dee2e6;
  padding: 8px 12px; text-align: left; font-weight: 600; }
.sigima-table td { border: 1px solid #dee2e6; padding: 8px 12px;
  text-align: right; }
.sigima-table tr:nth-child(even) { background-color: #f8f9fa; }
.sigima-table-title { font-size: 14px; font-weight: 600;
  margin-bottom: 8px; color: #495057; }
</style>
"""


class _VendoredTableDisplay:  # pylint: disable=too-few-public-methods
    """Minimal HTML wrapper for ``sigima.objects.TableResult``."""

    def __init__(self, result: Any, title: str | None = None) -> None:
        self._result = result
        self._title = title

    def _repr_html_(self) -> str:
        try:
            title = self._title or getattr(self._result, "title", "Table")
            if hasattr(self._result, "to_html"):
                return f"{_VENDORED_TABLE_STYLE}<div>{self._result.to_html()}</div>"
            # Manual fallback via pandas if available.
            import pandas as pd  # pylint: disable=import-outside-toplevel

            df = pd.DataFrame(self._result.data, columns=list(self._result.headers))
            html = df.to_html(classes="sigima-table")
            return (
                f"{_VENDORED_TABLE_STYLE}"
                f'<div><div class="sigima-table-title">{title}</div>{html}</div>'
            )
        except Exception as exc:  # pylint: disable=broad-exception-caught
            return f"<div>Error rendering table: {exc}</div>"


class _VendoredGeometryDisplay:  # pylint: disable=too-few-public-methods
    """Minimal HTML wrapper for ``sigima.objects.GeometryResult``."""

    def __init__(self, result: Any, title: str | None = None) -> None:
        self._result = result
        self._title = title

    def _repr_html_(self) -> str:
        try:
            title = self._title or getattr(self._result, "title", "Geometry")
            if hasattr(self._result, "to_html"):
                return f"{_VENDORED_TABLE_STYLE}<div>{self._result.to_html()}</div>"
            buf = io.StringIO()
            buf.write(f'<div class="sigima-table-title">{title}</div>')
            buf.write('<table class="sigima-table"><tbody>')
            for row in getattr(self._result, "coords", []):
                buf.write("<tr>" + "".join(f"<td>{v:.6g}</td>" for v in row) + "</tr>")
            buf.write("</tbody></table>")
            return f"{_VENDORED_TABLE_STYLE}<div>{buf.getvalue()}</div>"
        except Exception as exc:  # pylint: disable=broad-exception-caught
            return f"<div>Error rendering geometry: {exc}</div>"
