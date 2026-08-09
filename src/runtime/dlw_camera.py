# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Bridge to the explicitly bundled Camera characterization wheel."""

from __future__ import annotations

from typing import Any, Protocol

from datalab_camera_characterization.adapters.web import (
    get_web_manifest,
    read_quickstart_bytes,
)


class WorkspaceLoader(Protocol):
    """Byte-based workspace loader supplied by DataLab-Web bootstrap."""

    def __call__(
        self,
        filename: str,
        data: bytes,
        *,
        replace: bool = True,
    ) -> dict[str, Any]: ...


_WORKSPACE_LOADER: WorkspaceLoader | None = globals().get("_WORKSPACE_LOADER")


def install_workspace_loader(loader: WorkspaceLoader) -> None:
    """Install DataLab-Web's existing byte-based HDF5 workspace loader."""
    global _WORKSPACE_LOADER
    if not callable(loader):
        raise TypeError("Camera workspace loader must be callable")
    _WORKSPACE_LOADER = loader


def get_bundled_camera_manifest() -> dict[str, str]:
    """Return the bundled plugin's explicit browser compatibility manifest."""
    return get_web_manifest()


def open_bundled_camera_quickstart(replace: bool = True) -> dict[str, Any]:
    """Load the packaged Camera workspace through the browser byte I/O path."""
    if _WORKSPACE_LOADER is None:
        raise RuntimeError("Camera workspace loader is not installed")
    manifest = get_web_manifest()
    return _WORKSPACE_LOADER(
        manifest["quickstart_filename"],
        read_quickstart_bytes(),
        replace=replace,
    )


__all__ = [
    "get_bundled_camera_manifest",
    "install_workspace_loader",
    "open_bundled_camera_quickstart",
]
