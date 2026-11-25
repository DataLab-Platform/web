"""Worker-local adapters for DataLab's existing scientific bootstrap."""

from __future__ import annotations

import inspect
import sys

import pyjs

sys.path.insert(0, "/home/pyodide")


def _dlw_binary(value):
    if isinstance(value, (bytes, bytearray, memoryview)):
        return pyjs.buffer_to_js_typed_array(memoryview(value).cast("B"), view=False)
    if isinstance(value, dict):
        return {key: _dlw_binary(val) for key, val in value.items()}
    if isinstance(value, (list, tuple)):
        return [_dlw_binary(val) for val in value]
    return value


async def _dlw_wasm_call(slot):
    request = pyjs.to_py(pyjs.js._dlwWasmArgs(slot))
    result = globals()[request["name"]](**request["kwargs"])
    if inspect.isawaitable(result):
        result = await result
    return pyjs.to_js(_dlw_binary(result), dict_converter=pyjs.js.Object.fromEntries)


async def _dlw_wasm_dialog(kind, payload):
    return pyjs.to_py(
        await pyjs.js._dlwWasmDialog(
            kind, pyjs.to_js(payload, dict_converter=pyjs.js.Object.fromEntries)
        )
    )
