# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Minimal :mod:`datalab.env` shim — exposes a no-op ``execenv`` logger."""

from __future__ import annotations

from typing import Any


class _ExecEnv:
    """Stand-in for ``datalab.env.execenv``; Qt-free.

    The desktop implementation logs to an internal console widget and to
    standard streams. In the browser we just print, so messages end up
    in the JavaScript console (Pyodide forwards Python ``stdout``).
    """

    unattended = False

    def log(self, src: Any, message: str) -> None:
        try:
            name = getattr(src, "__name__", None) or src.__class__.__name__
        except Exception:  # pylint: disable=broad-except
            name = "datalab"
        print(f"[{name}] {message}")

    def print(self, message: str) -> None:
        print(message)


execenv = _ExecEnv()


__all__ = ["execenv"]
