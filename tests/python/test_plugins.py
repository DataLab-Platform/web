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
from pathlib import Path

import dlw_plugins
import dlw_processor
import pytest
from datalab import registries
from datalab.errors import BrowserNotSupportedError
from datalab.gui.processor.base import BaseProcessor
from datalab.plugins import (
    PluginBase,
    PluginCapability,
    PluginInfo,
    PluginRegistry,
)
from dlw_wheels import WheelInspectionError

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


@pytest.fixture
def live_plugins_env(fresh_bootstrap, plugins_env, monkeypatch):
    """Exercise plugin registration with the real browser main-window facade."""
    from datalab.gui.main import DLMainWindow
    from dlw_main import WebMainBridge

    monkeypatch.setattr(registries, "EXTRA_FEATURES", {"signal": [], "image": []})
    monkeypatch.setattr(registries, "EXTRA_MENU_ACTIONS", {"signal": [], "image": []})
    monkeypatch.setattr(dlw_plugins, "_MAIN", DLMainWindow(WebMainBridge()))
    yield plugins_env, fresh_bootstrap
    for record_id in list(plugins_env._RECORDS):
        plugins_env.unload_plugin(record_id, force=True)


def test_generated_desktop_plugin_registers_runs_and_reloads(live_plugins_env):
    """Exercise actual generator output, including the facade and proxy."""
    import numpy as np

    loader, bs = live_plugins_env
    fixture = Path(__file__).resolve().parents[1] / "fixtures" / "datalab_issue94.py"
    payload = loader.load_plugin_source(fixture.name, fixture.read_text("utf-8"))
    assert payload["loaded"], payload["error"]
    feature_id = "org.example.issue94:sample-processing"
    (feature,) = registries.EXTRA_FEATURES["signal"]
    (action,) = registries.EXTRA_MENU_ACTIONS["signal"]
    assert feature.feature_id == feature_id
    assert action.feature_id == feature_id
    assert action.menu_path == ["Generated & portable/demo"]
    assert action.title == "Sample processing"

    bs.add_signal_from_arrays("source", np.arange(3.0), np.array([-1.0, 0.0, 2.0]))
    (result_id,) = loader._RECORDS[payload["record_id"]].instance.proxy.calc(feature_id)
    np.testing.assert_array_equal(bs._MODEL.get(result_id).y, [0.0, 0.0, 2.0])

    loader.reload_plugins()
    assert len(registries.EXTRA_FEATURES["signal"]) == 1
    assert len(registries.EXTRA_MENU_ACTIONS["signal"]) == 1
    disabled = loader.set_plugin_enabled(payload["record_id"], False)
    assert not disabled["loaded"]
    assert registries.EXTRA_FEATURES["signal"] == []
    assert registries.EXTRA_MENU_ACTIONS["signal"] == []
    enabled = loader.set_plugin_enabled(payload["record_id"], True)
    assert enabled["loaded"], enabled["error"]
    assert len(registries.EXTRA_FEATURES["signal"]) == 1
    assert len(registries.EXTRA_MENU_ACTIONS["signal"]) == 1


@pytest.mark.parametrize(
    ("name", "args"),
    [
        ("assess_recipe", ("recipe",)),
        ("launch_recipe", ("recipe",)),
        ("start_recipe", ("recipe",)),
        ("try_example", ("example", "recipe")),
        ("launch_example", ("example",)),
        ("open_example", ("example",)),
    ],
)
def test_desktop_recipe_helpers_report_unsupported(live_plugins_env, name, args):
    loader, _bs = live_plugins_env
    payload = loader.load_plugin_source("recipe_helpers.py", VALID_PLUGIN)
    assert payload["loaded"], payload["error"]
    plugin = loader._RECORDS[payload["record_id"]].instance
    with pytest.raises(BrowserNotSupportedError, match="Applications"):
        getattr(plugin, name)(*args)


def test_legacy_web_plugin_registers_wrapped_function(live_plugins_env):
    """Plugins registering wrapped functions in create_actions keep their menu."""
    import numpy as np

    loader, bs = live_plugins_env
    source = """
import sigima.proc.image as sipi
from datalab.plugins import PluginBase, PluginInfo

def double(data):
    return data * 2

class LegacyPlugin(PluginBase):
    PLUGIN_INFO = PluginInfo(id="org.example.legacy", name="Legacy")
    def create_actions(self):
        self.imagepanel.processor.register_1_to_1(sipi.Wrap1to1Func(double), "Double")
"""
    payload = loader.load_plugin_source("legacy.py", source)
    assert payload["loaded"], payload["error"]
    (feature,) = registries.EXTRA_FEATURES["image"]
    assert feature.menu_path == "Plugins/Double"
    assert registries.EXTRA_MENU_ACTIONS["image"] == []
    data = np.arange(100.0).reshape(10, 10)
    source_id = bs.add_image_from_array("source", data)
    (result_id,) = bs.apply_feature(feature.feature_id, [source_id])
    np.testing.assert_array_equal(bs._MODEL.get(result_id).data, data * 2)


def test_bundled_custom_filter_uses_desktop_registration(live_plugins_env):
    import numpy as np

    loader, bs = live_plugins_env
    example = (
        Path(__file__).resolve().parents[2]
        / "plugins"
        / "examples"
        / "datalab_custom_func.py"
    )
    payload = loader.load_plugin_source(example.name, example.read_text("utf-8"))
    assert payload["loaded"], payload["error"]
    (feature,) = registries.EXTRA_FEATURES["image"]
    (action,) = registries.EXTRA_MENU_ACTIONS["image"]
    assert action.feature_id == feature.feature_id
    assert action.menu_path == ["My custom filters"]
    source_id = bs.add_image_from_array("source", np.arange(100.0).reshape(10, 10))
    (result_id,) = bs.apply_feature(feature.feature_id, [source_id])
    assert np.isfinite(bs._MODEL.get(result_id).data).all()


def test_action_for_resolves_callable_and_legacy_name(live_plugins_env):
    loader, _bs = live_plugins_env
    source = """
from datalab.plugins import PluginBase, PluginInfo

def transform(obj):
    return obj.copy()

class AliasPlugin(PluginBase):
    PLUGIN_INFO = PluginInfo(id="org.example.alias", name="Aliases")
    def register_computations(self):
        self.signalpanel.processor.register_1_to_1(
            transform, "Transform", feature_id="org.example.alias:transform"
        )
    def create_actions(self):
        handler = self.signalpanel.acthandler
        with handler.new_menu("First"):
            handler.action_for(transform)
        with handler.new_menu("Second"):
            handler.action_for("transform")
"""
    payload = loader.load_plugin_source("alias_plugin.py", source)
    assert payload["loaded"], payload["error"]
    actions = registries.EXTRA_MENU_ACTIONS["signal"]
    assert [action.menu_path for action in actions] == [["First"], ["Second"]]
    assert {action.feature_id for action in actions} == {"org.example.alias:transform"}


def test_action_for_keeps_builtins_and_other_plugins_implicit_entries(live_plugins_env):
    loader, bs = live_plugins_env
    owner = """
from datalab.plugins import PluginBase, PluginInfo

def transform(obj):
    return obj.copy()

class OwnerPlugin(PluginBase):
    PLUGIN_INFO = PluginInfo(id="org.example.owner", name="Owner")
    def create_actions(self):
        self.signalpanel.processor.register_1_to_1(
            transform, "Transform", feature_id="org.example.owner:transform"
        )
"""
    visitor = """
from datalab.plugins import PluginBase, PluginInfo

class VisitorPlugin(PluginBase):
    PLUGIN_INFO = PluginInfo(id="org.example.visitor", name="Visitor")
    def create_actions(self):
        self.signalpanel.acthandler.action_for("org.example.owner:transform")
        self.signalpanel.acthandler.action_for("normalize")
"""
    for filename, source in (("owner.py", owner), ("visitor.py", visitor)):
        payload = loader.load_plugin_source(filename, source)
        assert payload["loaded"], payload["error"]
    actions = registries.EXTRA_MENU_ACTIONS["signal"]
    assert [action.feature_id for action in actions] == [
        "org.example.owner:transform",
        "normalize",
    ]
    assert all(not action.replace_implicit for action in actions)
    assert "normalize" in bs._CATALOG
    loader.unload_plugin("org.example.visitor")
    assert registries.EXTRA_FEATURES["signal"][0].feature_id == (
        "org.example.owner:transform"
    )


def test_proxy_calc_preserves_plugin_parameter_values(live_plugins_env):
    import numpy as np

    loader, bs = live_plugins_env
    source = """
import guidata.dataset as gds
from datalab.plugins import PluginBase, PluginInfo

class Parameters(gds.DataSet):
    factor = gds.FloatItem("Factor", default=1.0)

def scale(obj, param):
    result = obj.copy()
    result.y = obj.y * param.factor
    return result

class ParameterPlugin(PluginBase):
    PLUGIN_INFO = PluginInfo(id="org.example.params", name="Parameters")
    def register_computations(self):
        self.signalpanel.processor.register_1_to_1(
            scale, "Scale", paramclass=Parameters, feature_id="org.example.params:scale"
        )
    def create_actions(self):
        self.signalpanel.acthandler.action_for("org.example.params:scale")
"""
    payload = loader.load_plugin_source("param_plugin.py", source)
    assert payload["loaded"], payload["error"]
    param = sys.modules["param_plugin"].Parameters.create(factor=3.0)
    bs.add_signal_from_arrays("source", np.arange(2.0), np.array([1.0, 2.0]))
    (result_id,) = loader._RECORDS[payload["record_id"]].instance.proxy.calc(
        "org.example.params:scale", param
    )
    np.testing.assert_array_equal(bs._MODEL.get(result_id).y, [3.0, 6.0])


def test_action_for_routes_registered_analysis(live_plugins_env):
    import asyncio

    import numpy as np

    loader, bs = live_plugins_env
    source = """
import numpy as np
from datalab.plugins import PluginBase, PluginInfo
from sigima.objects import TableResult

def mean(obj):
    return TableResult.from_rows("Mean", ["Mean"], [[float(np.mean(obj.y))]], [-1])

class AnalysisPlugin(PluginBase):
    PLUGIN_INFO = PluginInfo(id="org.example.analysis", name="Analysis")
    def register_computations(self):
        self.signalpanel.processor.register_1_to_0(
            mean, "Mean", feature_id="org.example.analysis:mean"
        )
    def create_actions(self):
        with self.signalpanel.acthandler.new_menu("Analysis plugin"):
            self.signalpanel.acthandler.action_for("org.example.analysis:mean")
"""
    payload = loader.load_plugin_source("analysis_plugin.py", source)
    assert payload["loaded"], payload["error"]
    (action,) = registries.EXTRA_MENU_ACTIONS["signal"]
    assert action.pattern == "1_to_0"
    assert action.feature_id == "org.example.analysis:mean"
    source_id = bs.add_signal_from_arrays("source", np.arange(3.0), np.ones(3))
    result = asyncio.run(bs.run_signal_analysis(source_id, action.feature_id))
    assert result["title"] == "Mean"


def test_action_for_rejects_ambiguous_legacy_names(live_plugins_env):
    loader, _bs = live_plugins_env
    source = """
from datalab.plugins import PluginBase, PluginInfo

def first(obj):
    return obj

def second(obj):
    return obj

first.__name__ = second.__name__ = "ambiguous"

class AmbiguousPlugin(PluginBase):
    PLUGIN_INFO = PluginInfo(id="org.example.ambiguous", name="Ambiguous")
    def register_computations(self):
        processor = self.signalpanel.processor
        processor.register_1_to_1(first, "First", feature_id="org.example.ambiguous:a")
        processor.register_1_to_1(second, "Second", feature_id="org.example.ambiguous:b")
    def create_actions(self):
        self.signalpanel.acthandler.action_for("ambiguous")
"""
    payload = loader.load_plugin_source("ambiguous_plugin.py", source)
    assert not payload["loaded"]
    assert "Ambiguous" in payload["error"]
    assert registries.EXTRA_FEATURES["signal"] == []


@pytest.mark.parametrize(
    ("kind", "method", "feature_id"),
    [
        ("signal", "register_1_to_1", "arithmetic"),
        ("signal", "register_1_to_0", "stats"),
    ],
)
def test_builtin_feature_collisions_reject_plugin_atomically(
    live_plugins_env, kind, method, feature_id
):
    loader, bs = live_plugins_env
    source = f"""
from datalab.plugins import PluginBase, PluginInfo

def transform(obj):
    return obj

class CollisionPlugin(PluginBase):
    PLUGIN_INFO = PluginInfo(id="org.example.collision", name="Collision")
    def create_actions(self):
        self.{kind}panel.processor.{method}(
            transform, "Collision", feature_id={feature_id!r}
        )
        self.{kind}panel.acthandler.new_action("Temporary", triggered=lambda: None)
"""
    payload = loader.load_plugin_source("collision_plugin.py", source)
    assert not payload["loaded"]
    assert feature_id in payload["error"]
    assert registries.EXTRA_FEATURES[kind] == []
    assert registries.EXTRA_MENU_ACTIONS[kind] == []
    assert PluginRegistry.get_plugin("org.example.collision") is None
    assert bs._full_catalog_with_plugins()["arithmetic"] is bs._CATALOG["arithmetic"]


def test_failed_registration_hook_rolls_back_contributions(live_plugins_env):
    loader, _bs = live_plugins_env
    source = """
from datalab.plugins import PluginBase, PluginInfo

def transform(obj):
    return obj

class BrokenPlugin(PluginBase):
    PLUGIN_INFO = PluginInfo(id="org.example.broken", name="Broken")
    def register_computations(self):
        self.signalpanel.processor.register_1_to_1(transform, "Temporary")
        raise RuntimeError("registration failed")
    def create_actions(self):
        pass
"""
    payload = loader.load_plugin_source("broken_registration.py", source)
    assert not payload["loaded"]
    assert "registration failed" in payload["error"]
    assert registries.EXTRA_FEATURES["signal"] == []
    assert PluginRegistry.get_plugin("org.example.broken") is None
    assert registries.current_origin() is None


def test_unknown_action_reference_rejects_plugin(live_plugins_env):
    loader, _bs = live_plugins_env
    source = """
from datalab.plugins import PluginBase, PluginInfo

class BrokenPlugin(PluginBase):
    PLUGIN_INFO = PluginInfo(id="org.example.missing", name="Missing")
    def create_actions(self):
        self.signalpanel.acthandler.action_for("missing-feature")
"""
    payload = loader.load_plugin_source("missing_feature.py", source)
    assert not payload["loaded"]
    assert "missing-feature" in payload["error"]
    assert registries.EXTRA_MENU_ACTIONS["signal"] == []


def test_desktop_recipe_launchers_are_rejected(live_plugins_env):
    loader, _bs = live_plugins_env
    source = """
from datalab.plugins import PluginBase, PluginInfo

class LauncherPlugin(PluginBase):
    PLUGIN_INFO = PluginInfo(id="org.example.launcher", name="Launcher")
    RECIPE_LAUNCHERS = {"org.example.launcher:recipe": "custom_launcher"}
    def create_actions(self):
        pass
"""
    payload = loader.load_plugin_source("recipe_launcher.py", source)
    assert not payload["loaded"]
    assert "RECIPE_LAUNCHERS" in payload["error"]


def test_desktop_welcome_tiles_are_reported_without_rejecting_plugin(live_plugins_env):
    loader, _bs = live_plugins_env
    source = """
from datalab.plugins import PluginBase, PluginCapability, PluginInfo
from datalab.plugins.tiles import WelcomeTile

class TilesPlugin(PluginBase):
    PLUGIN_INFO = PluginInfo(
        id="org.example.tiles", name="Tiles",
        capabilities=(PluginCapability.APPLICATION,),
    )
    WELCOME_TILES = (WelcomeTile(id="hello", title="Hello"),)
    def create_actions(self):
        pass
"""
    payload = loader.load_plugin_source("welcome_tiles.py", source)
    assert payload["loaded"], payload["error"]
    assert payload["warnings"] == ["desktop_welcome_tiles"]


def _make_entry_point_wheel(requirement: str | None = None) -> bytes:
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
            "Requires-Python: >=3.11\n"
            + (f"Requires-Dist: {requirement}\n" if requirement else ""),
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


@pytest.mark.parametrize(
    ("requirement", "accepted"),
    [
        ("datalab-platform>=1.3", True),
        ("datalab-platform>=1.4", True),
        ("datalab-platform>=1.5", False),
        ("datalab-platform<1.4", False),
    ],
)
def test_wheel_host_version_uses_the_portable_runtime(
    plugins_env, tmp_path, requirement: str, accepted: bool
) -> None:
    """Inspection and loading use the shim version, not CPython's distribution."""
    data = _make_entry_point_wheel(requirement)
    filename = "portable_plugin-1.0.0-py3-none-any.whl"
    path = tmp_path / filename
    path.write_bytes(data)
    if accepted:
        manifest = plugins_env.inspect_plugin_wheel(str(path), filename)
        assert manifest["distribution"] == "portable-plugin"
    else:
        with pytest.raises(WheelInspectionError, match="datalab-platform"):
            plugins_env.inspect_plugin_wheel(str(path), filename)
    (record,) = plugins_env.load_plugin_wheel(
        str(path),
        filename=filename,
        source="user-wheel",
        sha256=hashlib.sha256(data).hexdigest(),
        trust="unverified",
    )
    assert record["loaded"] is accepted
    if not accepted:
        assert "datalab-platform" in record["error"]


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


def test_plugin_analyses_are_listed_and_run_at_their_menu_path(fresh_bootstrap):
    """1→0 plugin features join the analyses, at the plugin menu path."""
    import asyncio

    import numpy as np
    from sigima.objects import TableResult

    def portable_mean(source):
        return TableResult.from_rows(
            "Portable mean", ["Mean"], [[float(np.mean(source.data))]], [-1]
        )

    feature_id = "org.example.analysis:mean"
    registries.push_origin("org.example.analysis")
    try:
        BaseProcessor("image").register_1_to_0(
            portable_mean,
            "Mean",
            menu_path="Plugins/Example/Mean",
            feature_id=feature_id,
            owner_plugin_id="org.example.analysis",
        )
    finally:
        registries.pop_origin()
    try:
        assert registries.EXTRA_FEATURES["image"][0].pattern == "1_to_0"
        assert dlw_processor.merge_plugin_features({}, "image") == {}
        bs = fresh_bootstrap
        entry = {e["id"]: e for e in bs.list_image_analysis()}[feature_id]
        assert entry["menu_path"] == "Plugins/Example/Mean"
        assert entry["has_params"] is False
        oid = bs.add_image_from_array("I", np.full((4, 4), 3.0))
        result = asyncio.run(bs.run_image_analysis(oid, feature_id))
        assert result["title"] == "Portable mean"
        builtin = {e["id"]: e for e in bs.list_image_analysis()}["stats"]
        assert builtin["menu_path"] is None
    finally:
        registries.clear_origin("org.example.analysis")
    assert feature_id not in {e["id"] for e in fresh_bootstrap.list_image_analysis()}


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
