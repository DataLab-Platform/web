# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
# @shim-registry: guidata-jsonschema
"""Add browser-specific FloatArrayItem hints missing from guidata 3.15.

Guidata provides the JSON Schema exporter natively from version 3.15.0.
DataLab-Web additionally needs the ``variable_size`` and ``minmax`` item
properties to configure its array editor. This patch augments only guidata's
native FloatArrayItem converter and leaves the public exporter untouched.
"""

from __future__ import annotations

from typing import Any

import guidata.dataset.dataitems as gdi
import guidata.dataset.jsonschema as gdjson


def _install_float_array_hints() -> None:
    """Augment guidata's native FloatArrayItem schema converter once."""
    if getattr(gdjson, "_dlw_float_array_hints_installed", False):
        return

    native_converter = gdjson._float_array_to_property  # pylint: disable=protected-access

    def convert(item: gdi.FloatArrayItem) -> dict[str, Any]:
        prop = native_converter(item)
        if item.get_prop("edit", "variable_size", False):
            prop["x-guidata-variable-size"] = True
        minmax = item.get_prop("display", "minmax", None)
        if minmax:
            prop["x-guidata-minmax"] = minmax
        return prop

    gdjson._float_array_to_property = convert  # pylint: disable=protected-access
    gdjson._dlw_float_array_hints_installed = True  # pylint: disable=protected-access


_install_float_array_hints()
