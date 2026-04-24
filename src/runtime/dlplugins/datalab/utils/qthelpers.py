# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Browser-friendly stand-in for :mod:`datalab.utils.qthelpers`.

The desktop module is full of Qt-specific helpers. The shim only
re-exports the ones used by the bundled stock plugins, routed through
:mod:`datalab.helpers` so they can be backed by React dialogs.
"""

from __future__ import annotations

from datalab import helpers


def create_progress_bar(parent, label, max_=0):
    """Return a context-managed progress bar (browser implementation)."""
    return helpers.create_progress_bar(parent, label, max_=max_)


__all__ = ["create_progress_bar"]
