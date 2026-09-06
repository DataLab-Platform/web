# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
# @shim-registry: guidata-jsonschema
"""Add browser-specific schema hints missing from guidata 3.15.

Guidata provides the JSON Schema exporter natively from version 3.15.0.
DataLab-Web additionally needs the ``variable_size`` and ``minmax`` item
properties to configure its array editor and the ``even`` constraint to
validate integer controls. This patch augments only guidata's native item
converters and leaves the public exporter untouched.
"""

from __future__ import annotations

from typing import Any

import guidata.dataset.dataitems as gdi
import guidata.dataset.jsonschema as gdjson


def _install_schema_hints() -> None:
    """Augment guidata's native schema converters once."""
    if getattr(gdjson, "_dlw_schema_hints_installed", False):
        return

    native_array_converter = (  # pylint: disable=protected-access
        gdjson._float_array_to_property
    )
    native_numeric_converter = gdjson._numeric_to_property  # pylint: disable=protected-access

    def convert_array(item: gdi.FloatArrayItem) -> dict[str, Any]:
        prop = native_array_converter(item)
        if item.get_prop("edit", "variable_size", False):
            prop["x-guidata-variable-size"] = True
        minmax = item.get_prop("display", "minmax", None)
        if minmax:
            prop["x-guidata-minmax"] = minmax
        return prop

    def convert_numeric(item: gdi.NumericTypeItem, kind: str) -> dict[str, Any]:
        prop = native_numeric_converter(item, kind)
        if kind == "int":
            even = item.get_prop("data", "even", None)
            if even is not None:
                prop.setdefault("x-guidata-even", bool(even))
        return prop

    gdjson._float_array_to_property = convert_array  # pylint: disable=protected-access
    gdjson._numeric_to_property = convert_numeric  # pylint: disable=protected-access
    gdjson._dlw_schema_hints_installed = True  # pylint: disable=protected-access


_install_schema_hints()
