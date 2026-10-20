# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for plugin menu actions run by :func:`bootstrap.trigger_plugin_action`."""

from __future__ import annotations

import asyncio

import numpy as np
import pytest
from datalab import registries


def _action(action_id: str, triggered) -> registries.ExtraMenuAction:
    return registries.ExtraMenuAction(
        action_id=action_id,
        title=action_id,
        menu_path=["Test"],
        triggered=triggered,
    )


@pytest.fixture
def menu_actions(monkeypatch):
    actions = {"signal": [], "image": []}
    monkeypatch.setattr(registries, "EXTRA_MENU_ACTIONS", actions)
    return actions


def test_reports_the_objects_added_by_an_action(fresh_bootstrap, menu_actions):
    bs = fresh_bootstrap
    existing = bs.add_signal_from_arrays("existing", np.arange(3.0), np.zeros(3))
    added: list[str] = []

    def triggered() -> None:
        added.append(bs.add_image_from_array("added", np.zeros((4, 4))))

    menu_actions["image"].append(_action("add-image", triggered))

    result = asyncio.run(bs.trigger_plugin_action("add-image"))

    assert result == {"signal": [], "image": added}
    assert existing not in result["signal"]


def test_awaits_an_asynchronous_action(fresh_bootstrap, menu_actions):
    bs = fresh_bootstrap

    async def triggered() -> None:
        bs.add_signal_from_arrays("added", np.arange(3.0), np.zeros(3))

    menu_actions["signal"].append(_action("add-signal", triggered))

    result = asyncio.run(bs.trigger_plugin_action("add-signal"))

    assert len(result["signal"]) == 1
    assert result["image"] == []


def test_refuses_an_unknown_action(fresh_bootstrap, menu_actions):
    with pytest.raises(KeyError, match="Unknown plugin action: missing"):
        asyncio.run(fresh_bootstrap.trigger_plugin_action("missing"))
