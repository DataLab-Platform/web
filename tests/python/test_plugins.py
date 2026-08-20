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

import hashlib
import io
import sys
import zipfile

import dlw_plugins
import dlw_processor
import pytest
from datalab import registries
from datalab.gui.processor.base import BaseProcessor
from datalab.plugins import (
    PluginBase,
    PluginCapability,
    PluginInfo,
    PluginRegistry,
)

VALID_PLUGIN = '''
from datalab.plugins import PluginBase, PluginInfo


class MyTestPlugin(PluginBase):
    """A minimal valid plugin."""

    PLUGIN_INFO = PluginInfo(
        id="org.example.my-test-plugin",
        name="My Test Plugin",
        version="1.2.3",
        description="A test plugin.",
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
    saved_plugin_classes = list(PluginRegistry.get_plugin_classes())
    saved_plugin_instances = list(PluginRegistry.get_plugins())
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
        PluginRegistry.get_plugin_classes()[:] = saved_plugin_classes
        PluginRegistry.get_plugins()[:] = saved_plugin_instances


def _make_entry_point_wheel() -> bytes:
    """Build a wheel whose Desktop target must never be imported by Web."""
    dist_info = "portable_plugin-1.0.0.dist-info"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("portable_plugin/__init__.py", "")
        archive.writestr(
            "portable_plugin/web.py",
            """
from datalab.plugins import PluginBase, PluginCapability, PluginInfo


class PortableWheelPlugin(PluginBase):
    PLUGIN_INFO = PluginInfo(
        id="org.example.portable-wheel",
        name="Portable Wheel Plugin",
        version="1.0.0",
        capabilities=(PluginCapability.APPLICATION,),
        documentation_url="https://example.org/portable-wheel",
    )

    def create_actions(self):
        pass
""",
        )
        archive.writestr(
            "portable_plugin/desktop.py",
            "import sys\n"
            "sys.modules['desktop_entry_point_imported'] = object()\n"
            "raise RuntimeError('Desktop target imported')\n",
        )
        archive.writestr(
            f"{dist_info}/METADATA",
            "Metadata-Version: 2.3\n"
            "Name: portable-plugin\n"
            "Version: 1.0.0\n"
            "Requires-Python: >=3.11\n",
        )
        archive.writestr(
            f"{dist_info}/WHEEL",
            "Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
        )
        archive.writestr(
            f"{dist_info}/entry_points.txt",
            "[datalab.web_plugins]\n"
            "portable = portable_plugin.web:PortableWheelPlugin\n"
            "[datalab.plugins]\n"
            "portable = portable_plugin.desktop:DesktopPlugin\n",
        )
        archive.writestr(f"{dist_info}/top_level.txt", "portable_plugin\n")
    return buffer.getvalue()


def test_load_valid_plugin_source(plugins_env):
    payload = plugins_env.load_plugin_source("mytest.py", VALID_PLUGIN)
    assert payload["loaded"] is True
    assert payload["enabled"] is True
    assert payload["error"] is None
    assert payload["info"]["id"] == "org.example.my-test-plugin"
    assert payload["info"]["name"] == "My Test Plugin"
    assert payload["info"]["version"] == "1.2.3"


def test_load_wheel_uses_only_web_entry_point(plugins_env, tmp_path):
    sys.modules.pop("desktop_entry_point_imported", None)
    wheel_bytes = _make_entry_point_wheel()
    sha256 = hashlib.sha256(wheel_bytes).hexdigest()
    filename = "portable_plugin-1.0.0-py3-none-any.whl"
    path = tmp_path / sha256 / filename
    path.parent.mkdir()
    path.write_bytes(wheel_bytes)

    payloads = plugins_env.load_plugin_wheel(
        str(path),
        filename=filename,
        source="user-wheel",
        sha256=sha256,
        trust="unverified",
        available_distributions={},
    )

    assert len(payloads) == 1
    payload = payloads[0]
    assert payload["loaded"] is True
    assert payload["plugin_id"] == "org.example.portable-wheel"
    assert payload["source"] == "user-wheel"
    assert payload["artifact_id"] == f"sha256:{sha256}"
    assert payload["entry_point"] == ("portable_plugin.web:PortableWheelPlugin")
    assert payload["info"]["capabilities"] == ["application"]
    assert payload["info"]["documentation_url"] == (
        "https://example.org/portable-wheel"
    )
    assert "desktop_entry_point_imported" not in sys.modules

    disabled = plugins_env.set_plugin_enabled(payload["record_id"], False)
    assert disabled["enabled"] is False
    assert disabled["loaded"] is False
    assert disabled["operations"]["can_enable"] is True
    assert disabled["operations"]["can_remove"] is True
    assert len(plugins_env.list_plugins()) == 1

    enabled = plugins_env.set_plugin_enabled(payload["record_id"], True)
    assert enabled["enabled"] is True
    assert enabled["loaded"] is True

    reloaded = plugins_env.reload_plugins()
    assert len(reloaded) == 1
    assert reloaded[0]["loaded"] is True
    assert reloaded[0]["plugin_id"] == "org.example.portable-wheel"
    assert reloaded[0]["artifact_filename"] == filename
    assert "desktop_entry_point_imported" not in sys.modules

    plugins_env.unload_plugin(payload["record_id"])
    assert str(path) not in sys.path
    assert "portable_plugin.web" not in sys.modules


def test_bundled_wheel_unload_disables_without_removing(plugins_env, tmp_path):
    wheel_bytes = _make_entry_point_wheel()
    sha256 = hashlib.sha256(wheel_bytes).hexdigest()
    filename = "portable_plugin-1.0.0-py3-none-any.whl"
    path = tmp_path / sha256 / filename
    path.parent.mkdir()
    path.write_bytes(wheel_bytes)
    payload = plugins_env.load_plugin_wheel(
        str(path),
        filename=filename,
        source="bundled-wheel",
        sha256=sha256,
        trust="verified",
        available_distributions={},
    )[0]

    result = plugins_env.unload_plugin(payload["record_id"])

    assert result == {"name": payload["record_id"], "removed": False}
    listing = plugins_env.list_plugins()
    assert len(listing) == 1
    assert listing[0]["enabled"] is False
    assert listing[0]["operations"]["can_remove"] is False


def test_stable_ids_own_web_plugin_contributions():
    """Display-name changes do not affect lookup or contribution cleanup."""

    def portable_processing(source):
        return source

    class PortablePlugin(PluginBase):
        PLUGIN_INFO = PluginInfo(
            id="org.example.portable",
            name="Portable Plugin",
        )

        def create_actions(self):
            pass

    class DuplicatePlugin(PluginBase):
        PLUGIN_INFO = PluginInfo(
            id="org.example.portable",
            name="Duplicate Plugin",
        )

        def create_actions(self):
            pass

    plugin = PortablePlugin()
    feature_id = "org.example.portable:normalize"
    try:
        PluginRegistry.register_plugin(plugin)
        with pytest.raises(ValueError, match="already registered"):
            PluginRegistry.register_plugin(DuplicatePlugin())
        registries.push_origin(plugin.plugin_id)
        try:
            processor = BaseProcessor("signal")
            processor.register_1_to_1(
                portable_processing,
                "Portable processing",
                feature_id=feature_id,
                owner_plugin_id=plugin.plugin_id,
            )
            with pytest.raises(ValueError, match="already registered"):
                processor.register_1_to_1(
                    portable_processing,
                    "Duplicate processing",
                    feature_id=feature_id,
                    owner_plugin_id=plugin.plugin_id,
                )
        finally:
            registries.pop_origin()

        feature = registries.EXTRA_FEATURES["signal"][0]
        assert feature.feature_id == feature_id
        assert feature.origin == plugin.plugin_id
        merged = dlw_processor.merge_plugin_features({}, "signal")
        assert list(merged) == [feature_id]
        assert merged[feature_id].feature_id == feature_id
        with pytest.raises(ValueError, match="already registered"):
            dlw_processor.merge_plugin_features(merged, "signal")

        plugin.info.name = "Renamed Portable Plugin"
        assert PluginRegistry.get_plugin("org.example.portable") is plugin
        assert PluginRegistry.get_plugin("Renamed Portable Plugin") is plugin

        registries.clear_origin(plugin.plugin_id)
        assert registries.EXTRA_FEATURES["signal"] == []
    finally:
        registries.clear_all()
        if plugin in PluginRegistry.get_plugins():
            PluginRegistry.unregister_plugin(plugin)
        if PortablePlugin in PluginRegistry.get_plugin_classes():
            PluginRegistry.get_plugin_classes().remove(PortablePlugin)
        if DuplicatePlugin in PluginRegistry.get_plugin_classes():
            PluginRegistry.get_plugin_classes().remove(DuplicatePlugin)


def test_plugin_info_exposes_portable_application_metadata():
    info = PluginInfo(
        id="org.example.application",
        name="Portable Application",
        capabilities=(PluginCapability.APPLICATION, PluginCapability.PROCESSING),
        documentation_url="https://example.org/docs",
    )

    assert info.capabilities == frozenset(
        {PluginCapability.APPLICATION, PluginCapability.PROCESSING}
    )
    assert info.documentation_url == "https://example.org/docs"

    with pytest.raises(ValueError, match="HTTP or HTTPS"):
        PluginInfo(name="Invalid docs", documentation_url="file:///tmp/docs")


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
