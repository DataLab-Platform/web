# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Contract tests for guidata's native asynchronous DataSet backend."""

from __future__ import annotations

import asyncio

import guidata.dataset as gds
from guidata.dataset import backends


def test_bootstrap_registers_native_async_backend(fresh_bootstrap):
    """Bootstrap installs its dialog bridge in guidata's native registry."""
    assert (
        backends.get_handler("edit_dataset_async")
        is fresh_bootstrap._async_edit_dataset
    )


def test_native_edit_async_round_trips_through_dialog_bridge(fresh_bootstrap):
    """Native ``DataSet.edit_async`` sends and applies bridge values."""

    class DemoParam(gds.DataSet):
        value = gds.IntItem("Value", default=1)

    received: dict[str, object] = {}

    async def bridge(kind: str, payload: dict) -> dict[str, int]:
        received["kind"] = kind
        received["payload"] = payload
        return {"value": 7}

    fresh_bootstrap.set_dialog_bridge(bridge)
    param = DemoParam()
    try:
        accepted = asyncio.run(param.edit_async())
    finally:
        fresh_bootstrap.set_dialog_bridge(None)

    assert accepted is True
    assert param.value == 7
    assert received["kind"] == "edit_dataset"
    payload = received["payload"]
    assert isinstance(payload, dict)
    assert payload["values"]["value"] == 1
    assert payload["schema"]["properties"]["value"]["type"] == "integer"
