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
    top_level: str = "example_datalab_plugin\n",
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
        archive.writestr(
            "example_datalab_plugin/__init__.py",
            "import sys\nsys.modules['wheel_import_sentinel'] = object()\n",
        )
        archive.writestr("example_datalab_plugin/web.py", "class ExamplePlugin: pass\n")
        archive.writestr(f"{DIST_INFO}/METADATA", "\n".join(metadata) + "\n")
        archive.writestr(
            f"{DIST_INFO}/WHEEL",
            "Wheel-Version: 1.0\n"
            "Generator: DataLab-Web tests\n"
            "Root-Is-Purelib: true\n"
            "Tag: py3-none-any\n",
        )
        archive.writestr(f"{DIST_INFO}/entry_points.txt", entry_points)
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
