# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Inspect DataLab-Web plugin wheels without importing their Python code.

The rules live in :mod:`datalab.plugins.wheels`, a verbatim copy of the DataLab
Desktop module shared with the plugin catalog: this module only binds them to the
Web entry-point group.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from datalab.plugins import wheels as _wheels
from datalab.plugins.wheels import (
    MAX_ARCHIVE_ENTRIES,
    MAX_UNCOMPRESSED_BYTES,
    MAX_WHEEL_BYTES,
    WEB_ENTRY_POINT_GROUP,
    WheelInspectionError,
)

WEB_PLUGIN_ENTRY_POINT = WEB_ENTRY_POINT_GROUP


def inspect_wheel(
    path_or_bytes: str | bytes | bytearray | memoryview,
    *,
    filename: str,
    available_distributions: Mapping[str, str],
    python_version: str | None = None,
    marker_environment: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Return a JSON-friendly Web plugin manifest without importing code."""
    return _wheels.inspect_wheel(
        path_or_bytes,
        filename=filename,
        entry_point_group=WEB_ENTRY_POINT_GROUP,
        available_distributions=available_distributions,
        host_name="DataLab-Web",
        python_version=python_version,
        marker_environment=marker_environment,
    )


__all__ = [
    "MAX_ARCHIVE_ENTRIES",
    "MAX_UNCOMPRESSED_BYTES",
    "MAX_WHEEL_BYTES",
    "WEB_PLUGIN_ENTRY_POINT",
    "WheelInspectionError",
    "inspect_wheel",
]
