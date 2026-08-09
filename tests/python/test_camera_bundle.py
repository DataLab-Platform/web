# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Contracts for the explicitly bundled Camera plugin wheel."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
CAMERA_WHEEL = (
    REPO_ROOT
    / "src"
    / "runtime"
    / "builtin_wheels"
    / "datalab_camera_characterization-0.1.0-py3-none-any.whl"
)


@pytest.fixture
def camera_bridge(monkeypatch):
    """Import the Web bridge with the bundled wheel on ``sys.path``."""
    assert CAMERA_WHEEL.is_file()
    monkeypatch.syspath_prepend(str(CAMERA_WHEEL))
    for name in tuple(sys.modules):
        if name == "dlw_camera" or name.startswith("datalab_camera_characterization"):
            sys.modules.pop(name, None)
    yield importlib.import_module("dlw_camera")
    for name in tuple(sys.modules):
        if name == "dlw_camera" or name.startswith("datalab_camera_characterization"):
            sys.modules.pop(name, None)


def test_bundled_camera_manifest_matches_runtime_matrix(camera_bridge) -> None:
    """The wheel exposes the exact unverified browser compatibility target."""
    assert camera_bridge.get_bundled_camera_manifest() == {
        "plugin_id": "org.datalab.camera-characterization",
        "plugin_version": "0.1.0",
        "web_status": "untested",
        "datalab_web_version": "0.8.0",
        "pyodide_version": "0.26.4",
        "recipe_id": (
            "org.datalab.camera-characterization:relative-dn-characterization"
        ),
        "recipe_version": "1.1.0",
        "quickstart_filename": "camera_quickstart.h5",
    }


def test_bundled_camera_quickstart_uses_workspace_byte_loader(camera_bridge) -> None:
    """Browser I/O reuses the existing byte-based HDF5 workspace loader."""
    calls: list[tuple[str, bytes, bool]] = []

    def load_workspace(filename: str, data: bytes, *, replace: bool = True):
        calls.append((filename, data, replace))
        return {"signal_count": 0, "image_count": 20}

    camera_bridge.install_workspace_loader(load_workspace)

    result = camera_bridge.open_bundled_camera_quickstart(replace=False)

    assert result == {"signal_count": 0, "image_count": 20}
    assert calls[0][0] == "camera_quickstart.h5"
    assert calls[0][1].startswith(b"\x89HDF\r\n\x1a\n")
    assert calls[0][2] is False
