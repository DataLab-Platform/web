# -*- coding: utf-8 -*-
#
# Licensed under the terms of the BSD 3-Clause
# (see datalab-web/LICENSE for details)

"""Tests for the FloatArrayItem JSON-schema export (graphical array editor).

The browser array editor relies on ``x-guidata-*`` hints emitted by
``_guidata_jsonschema_shim`` to decide which controls to show (variable
size, formatting, transpose). These tests lock in that contract.
"""

from __future__ import annotations

import guidata.dataset as gds


def _schema_for(item: gds.FloatArrayItem) -> dict:
    class _DS(gds.DataSet):
        arr = item

    payload = gds.dataset_to_schema_with_values(_DS())
    return payload["schema"]["properties"]["arr"]


def test_float_array_basic_kind():
    prop = _schema_for(gds.FloatArrayItem("A"))
    assert prop["x-guidata-kind"] == "float_array"
    assert prop["type"] == "array"


def test_float_array_format_and_transpose():
    prop = _schema_for(gds.FloatArrayItem("A", format="%.5f", transpose=True))
    assert prop["x-guidata-format"] == "%.5f"
    assert prop["x-guidata-transpose"] is True


def test_float_array_variable_size_and_minmax():
    prop = _schema_for(gds.FloatArrayItem("A", variable_size=True, minmax="columns"))
    assert prop["x-guidata-variable-size"] is True
    assert prop["x-guidata-minmax"] == "columns"


def test_float_array_fixed_size_omits_variable_flag():
    prop = _schema_for(gds.FloatArrayItem("A"))
    assert "x-guidata-variable-size" not in prop
