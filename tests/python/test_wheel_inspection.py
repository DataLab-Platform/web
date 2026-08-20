from __future__ import annotations

import io
import sys
import zipfile

import pytest

from dlw_wheels import WheelInspectionError, inspect_wheel


FILENAME = "example_datalab_plugin-1.2.0-py3-none-any.whl"
DIST_INFO = "example_datalab_plugin-1.2.0.dist-info"


def make_wheel(
    *,
    entry_points: str = (
        "[datalab.web_plugins]\n"
        "example_plugin = example_datalab_plugin.web:ExamplePlugin\n"
    ),
    requires_dist: tuple[str, ...] = ("sigima>=1.1",),
    top_level: str | None = "example_datalab_plugin\n",
    include_package: bool = True,
    extra_files: dict[str, bytes] | None = None,
) -> bytes:
    metadata = [
        "Metadata-Version: 2.3",
        "Name: example-datalab-plugin",
        "Version: 1.2.0",
        "Requires-Python: >=3.11",
    ]
    metadata.extend(f"Requires-Dist: {requirement}" for requirement in requires_dist)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        if include_package:
            archive.writestr(
                "example_datalab_plugin/__init__.py",
                "import sys\nsys.modules['wheel_import_sentinel'] = object()\n",
            )
            archive.writestr(
                "example_datalab_plugin/web.py", "class ExamplePlugin: pass\n"
            )
        archive.writestr(f"{DIST_INFO}/METADATA", "\n".join(metadata) + "\n")
        archive.writestr(
            f"{DIST_INFO}/WHEEL",
            "Wheel-Version: 1.0\n"
            "Generator: DataLab-Web tests\n"
            "Root-Is-Purelib: true\n"
            "Tag: py3-none-any\n",
        )
        archive.writestr(f"{DIST_INFO}/entry_points.txt", entry_points)
        if top_level is not None:
            archive.writestr(f"{DIST_INFO}/top_level.txt", top_level)
        for name, data in (extra_files or {}).items():
            archive.writestr(name, data)
    return buffer.getvalue()


def inspect(data: bytes) -> dict[str, object]:
    return inspect_wheel(
        data,
        filename=FILENAME,
        available_distributions={"sigima": "1.2.0"},
        python_version="3.12",
    )


def test_inspection_reads_contract_without_importing_plugin() -> None:
    sys.modules.pop("wheel_import_sentinel", None)

    manifest = inspect(make_wheel())

    assert manifest["distribution"] == "example-datalab-plugin"
    assert manifest["version"] == "1.2.0"
    assert manifest["entry_points"] == [
        {
            "name": "example_plugin",
            "module": "example_datalab_plugin.web",
            "attribute": "ExamplePlugin",
        }
    ]
    assert manifest["top_level_packages"] == ["example_datalab_plugin"]
    assert "wheel_import_sentinel" not in sys.modules


def test_inspection_rejects_desktop_only_wheel() -> None:
    data = make_wheel(
        entry_points=(
            "[datalab.plugins]\n"
            "example_plugin = example_datalab_plugin.desktop:ExamplePlugin\n"
        )
    )

    with pytest.raises(WheelInspectionError, match="datalab.web_plugins"):
        inspect(data)


@pytest.mark.parametrize(
    ("extra_files", "message"),
    [
        ({"../escape.py": b""}, "Unsafe path"),
        ({"example_datalab_plugin/native.pyd": b"binary"}, "Native payload"),
        ({"datalab/__init__.py": b""}, "reserved package"),
    ],
)
def test_inspection_rejects_unsafe_payloads(
    extra_files: dict[str, bytes], message: str
) -> None:
    top_level = (
        "datalab\n"
        if "datalab/__init__.py" in extra_files
        else "example_datalab_plugin\n"
    )
    with pytest.raises(WheelInspectionError, match=message):
        inspect(make_wheel(top_level=top_level, extra_files=extra_files))


def test_inspection_rejects_missing_host_dependency() -> None:
    with pytest.raises(WheelInspectionError, match="not provided"):
        inspect_wheel(
            make_wheel(requires_dist=("unknown-science-package>=1",)),
            filename=FILENAME,
            available_distributions={"sigima": "1.2.0"},
            python_version="3.12",
        )


def test_inspection_skips_dependencies_with_inapplicable_markers() -> None:
    manifest = inspect_wheel(
        make_wheel(requires_dist=('pyqt5>=5 ; sys_platform == "win32"',)),
        filename=FILENAME,
        available_distributions={"sigima": "1.2.0"},
        python_version="3.12",
        marker_environment={"sys_platform": "emscripten"},
    )

    (dependency,) = manifest["dependencies"]
    assert dependency["applies"] is False
    assert dependency["compatible"] is True


def test_inspection_rejects_duplicate_dist_info_directories() -> None:
    data = make_wheel(
        extra_files={"other_plugin-1.0.dist-info/METADATA": b"Name: other\n"}
    )

    with pytest.raises(WheelInspectionError, match="exactly one .dist-info"):
        inspect(data)


def test_inspection_rejects_oversized_wheel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import dlw_wheels

    data = make_wheel()
    monkeypatch.setattr(dlw_wheels, "MAX_WHEEL_BYTES", len(data) - 1)

    with pytest.raises(WheelInspectionError, match="size limit"):
        inspect(data)


def test_inspection_derives_flat_module_layout_and_reserved_names() -> None:
    manifest = inspect(
        make_wheel(
            entry_points=(
                "[datalab.web_plugins]\nflat_plugin = flat_plugin:FlatPlugin\n"
            ),
            top_level=None,
            include_package=False,
            extra_files={"flat_plugin.py": b"class FlatPlugin: pass\n"},
        )
    )
    assert manifest["top_level_packages"] == ["flat_plugin"]

    with pytest.raises(WheelInspectionError, match="reserved package"):
        inspect(
            make_wheel(
                top_level=None,
                include_package=False,
                extra_files={"micropip.py": b"class Impostor: pass\n"},
            )
        )


def test_inspection_ignores_data_directories_without_top_level() -> None:
    manifest = inspect(
        make_wheel(
            top_level=None,
            extra_files={
                "example_datalab_plugin-1.2.0.data/scripts/run": b"#!/bin/sh\n"
            },
        )
    )

    assert manifest["top_level_packages"] == ["example_datalab_plugin"]


def test_inspection_treats_invalid_host_version_as_unavailable() -> None:
    with pytest.raises(WheelInspectionError, match="not provided"):
        inspect_wheel(
            make_wheel(),
            filename=FILENAME,
            available_distributions={"sigima": "not-a-version"},
            python_version="3.12",
        )
