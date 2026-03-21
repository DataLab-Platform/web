# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Browser-specific exception types used by the DataLab shim."""

from __future__ import annotations


class BrowserNotSupportedError(NotImplementedError):
    """Raised when a plugin calls a desktop-only API in the browser.

    The error message should explicitly mention the unsupported method
    and (when applicable) point to the asynchronous variant — for
    example, ``DataSet.edit_async()`` instead of ``DataSet.edit()``.
    """


__all__ = ["BrowserNotSupportedError"]
