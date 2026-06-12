# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the DataLab-Web plugin loader (``dlw_plugins``).

Exercises the file-system loader, error reporting, discovery loop,
change-listener fan-out and unload path without a live browser. The
module keeps process-global state (``_RECORDS``, ``sys.path`` /
``sys.modules`` entries, the plugin registry), so a fixture snapshots
and restores it around every test.
"""

from __future__ import annotations

import sys

import dlw_plugins
import pytest

VALID_PLUGIN = '''
from datalab.plugins import PluginBase, PluginInfo


class MyTestPlugin(PluginBase):
    """A minimal valid plugin."""

    PLUGIN_INFO = PluginInfo(
        name="My Test Plugin", version="1.2.3", description="A test plugin."
    )

    def create_actions(self):
        """No-op: this test plugin contributes no GUI actions."""
'''

NO_PLUGIN_CLASS = "x = 1\n"

SYNTAX_ERROR = "def broken(:\n    pass\n"


@pytest.fixture
def plugins_env(tmp_path, monkeypatch):
    """Isolate the loader's global state and stage plugins under tmp_path."""
    root = tmp_path / "dlw_plugins"
    monkeypatch.setattr(dlw_plugins, "PLUGINS_ROOT", str(root))
    # Force the main-window facade to ``None`` so loading never calls the
    # plugin's ``register()`` (which would mutate the process-global
    # ``PluginRegistry`` and make these tests order-dependent: another
    # test that boots bootstrap may have installed a live main window).
    monkeypatch.setattr(dlw_plugins, "_MAIN", None)
    saved_records = dict(dlw_plugins._RECORDS)
    saved_listeners = list(dlw_plugins._REGISTERED_LISTENERS)
    saved_modules = set(sys.modules)
    dlw_plugins._RECORDS.clear()
    dlw_plugins._REGISTERED_LISTENERS.clear()
    try:
        yield dlw_plugins
    finally:
        dlw_plugins._RECORDS.clear()
        dlw_plugins._RECORDS.update(saved_records)
        dlw_plugins._REGISTERED_LISTENERS.clear()
        dlw_plugins._REGISTERED_LISTENERS.extend(saved_listeners)
        # Drop any modules the loader imported during the test.
        for name in set(sys.modules) - saved_modules:
            sys.modules.pop(name, None)


def test_load_valid_plugin_source(plugins_env):
    payload = plugins_env.load_plugin_source("mytest.py", VALID_PLUGIN)
    assert payload["loaded"] is True
    assert payload["enabled"] is True
    assert payload["error"] is None
    assert payload["info"]["name"] == "My Test Plugin"
    assert payload["info"]["version"] == "1.2.3"


def test_load_syntax_error_reports_traceback(plugins_env):
    payload = plugins_env.load_plugin_source("broken.py", SYNTAX_ERROR)
    assert payload["loaded"] is False
    assert payload["enabled"] is False
    assert payload["error"] is not None


def test_load_without_pluginbase_subclass(plugins_env):
    payload = plugins_env.load_plugin_source("plain.py", NO_PLUGIN_CLASS)
    assert payload["loaded"] is False
    assert payload["enabled"] is False
    assert "No PluginBase subclass" in payload["error"]


def test_list_plugins_reflects_loaded_state(plugins_env):
    plugins_env.load_plugin_source("mytest.py", VALID_PLUGIN)
    listing = plugins_env.list_plugins()
    assert len(listing) == 1
    assert listing[0]["info"]["name"] == "My Test Plugin"


def test_unload_plugin_removes_record(plugins_env):
    payload = plugins_env.load_plugin_source("mytest.py", VALID_PLUGIN)
    name = payload["name"]
    result = plugins_env.unload_plugin(name)
    assert result == {"name": name, "removed": True}
    assert plugins_env.list_plugins() == []


def test_unload_unknown_plugin_is_noop(plugins_env):
    result = plugins_env.unload_plugin("does-not-exist")
    assert result == {"name": "does-not-exist", "removed": False}


def test_discover_plugins_in_dir(plugins_env, tmp_path):
    src_dir = tmp_path / "user_plugins"
    src_dir.mkdir()
    (src_dir / "good.py").write_text(VALID_PLUGIN, encoding="utf-8")
    # Files starting with an underscore are skipped by discovery.
    (src_dir / "_helper.py").write_text(VALID_PLUGIN, encoding="utf-8")
    results = plugins_env.discover_plugins_in_dir(str(src_dir))
    assert len(results) == 1
    assert results[0]["loaded"] is True


def test_discover_missing_dir_returns_empty(plugins_env, tmp_path):
    assert plugins_env.discover_plugins_in_dir(str(tmp_path / "nope")) == []


def test_change_listener_invoked_on_load(plugins_env):
    calls: list[int] = []
    plugins_env.add_change_listener(lambda: calls.append(1))
    plugins_env.load_plugin_source("mytest.py", VALID_PLUGIN)
    assert calls  # listener fired at least once on load
