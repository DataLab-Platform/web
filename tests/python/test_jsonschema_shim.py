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


def test_display_callback_flag_and_resolution():
    """A ``display`` callback is flagged and re-runnable off-GUI.

    Mirrors ``ArithmeticParam.operation``: editing operator/factor/constant
    must recompute the read-only ``operation`` preview through
    ``resolve_dataset_callbacks`` (the browser equivalent of the Qt
    ``update_widgets`` cascade).
    """

    def _update(instance, _item, _value):
        instance.operation = f"{instance.a} + {instance.b}"

    class _DS(gds.DataSet):
        a = gds.IntItem("A", default=1).set_prop("display", callback=_update)
        b = gds.IntItem("B", default=2).set_prop("display", callback=_update)
        operation = gds.StringItem("Operation", default="").set_prop(
            "display", active=False
        )

    payload = gds.dataset_to_schema_with_values(_DS())
    props = payload["schema"]["properties"]
    assert props["a"]["x-guidata-has-callback"] is True
    assert props["b"]["x-guidata-has-callback"] is True
    assert "x-guidata-has-callback" not in props["operation"]
    # The preview is non-editable in the form (``active=False``).
    assert props["operation"]["x-guidata-active"] is False
    # ...and is already populated on open (initial callback pass).
    assert payload["values"]["operation"] == "1 + 2"

    instance = _DS()
    gds.update_dataset(instance, {"a": 4, "b": 7, "operation": ""})
    values = gds.resolve_dataset_callbacks(instance, "a")
    assert values["operation"] == "4 + 7"
    assert values["a"] == 4
    assert values["b"] == 7

    # An item without a callback is a no-op (empty mapping).
    assert gds.resolve_dataset_callbacks(_DS(), "operation") == {}
