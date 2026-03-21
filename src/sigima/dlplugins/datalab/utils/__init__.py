# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Compatibility shim for :mod:`datalab.utils` (browser flavour).

Only the subset of helpers actually imported by the bundled stock
plugins is exposed. Anything Qt-specific raises
:class:`BrowserNotSupportedError`.
"""

from __future__ import annotations

__all__: list[str] = []
