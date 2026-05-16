# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""
Install Sigima's ``PlaceholderTitleFormatter`` as the process-wide default.

Mirrors :mod:`datalab.config` (Qt desktop) so titles produced by Sigima's
``@computation_function`` helpers carry positional placeholders
(``{0}``, ``{1}``, …) that DataLab-Web later substitutes with the source
objects' short IDs (the hex ``oid`` returned by ``_new_id()`` in
:mod:`bootstrap`). The companion helper :func:`bootstrap.patch_title_with_ids`
does the substitution after each ``apply_feature`` call.

The module is intentionally tiny so it can be pushed into every Pyodide
instance (main runtime + macro / notebook workers) and executed right
after Sigima is installed, ensuring all three environments agree on the
title format. It is idempotent: re-running it just re-installs the same
formatter.
"""

from __future__ import annotations

from sigima.proc.title_formatting import (
    PlaceholderTitleFormatter,
    set_default_title_formatter,
)

set_default_title_formatter(PlaceholderTitleFormatter())
