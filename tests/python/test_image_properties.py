# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""Tests for the ImageObj property schema bridge.

Covers the cross-section of guidata features that ``ImageObj`` exercises
beyond plain editable items:

* ``set_computed(...)`` items (``xmin``/``xmax``/``ymin``/``ymax``) must be
  surfaced as ``readOnly`` so the auto-generated form disables them.
* The ``is_uniform_coords`` toggle must drive ``switch_coords_to`` on
  :func:`bootstrap.set_object_property_values` so flipping the bit from the
  Properties side panel keeps the underlying ``ImageObj`` consistent
  (extent fields stop returning ``NaN``, ``xcoords``/``ycoords`` get
  populated/cleared).
"""

from __future__ import annotations

import numpy as np
import pytest


def _create_image(bs, shape=(4, 5)):
    """Create a tiny image and return its oid."""
    data = np.arange(shape[0] * shape[1], dtype=float).reshape(shape)
    return bs.add_image_from_array("img", data)


def test_computed_extent_items_are_readonly(fresh_bootstrap):
    """``xmin``/``xmax``/``ymin``/``ymax`` carry ``ComputedProp`` and must
    appear as read-only in the JSON schema so the form disables them."""
    bs = fresh_bootstrap
    oid = _create_image(bs)
    payload = bs.get_object_property_schema(oid)
    props = payload["schema"]["properties"]
    for name in ("xmin", "xmax", "ymin", "ymax"):
        assert name in props, f"{name!r} missing from schema"
        assert props[name].get("readOnly") is True, (
            f"{name!r} should be marked readOnly (computed item)"
        )
        assert props[name].get("x-guidata-computed") is True


def test_computed_extent_values_are_present(fresh_bootstrap):
    """The values dict must contain the *computed* current value, not the
    item default (the form preview relies on it)."""
    bs = fresh_bootstrap
    oid = _create_image(bs, shape=(3, 7))
    payload = bs.get_object_property_schema(oid)
    values = payload["values"]
    # Uniform coords: xmax = x0 + width - dx = 0 + 7 - 1 = 6 ; ymax = 3 - 1 = 2
    assert values["xmin"] == pytest.approx(0.0)
    assert values["xmax"] == pytest.approx(6.0)
    assert values["ymin"] == pytest.approx(0.0)
    assert values["ymax"] == pytest.approx(2.0)


def _apply(bs, oid, **updates):
    """Round-trip the current schema values through the Apply path with
    the requested overrides, mirroring how the side panel submits its
    form (full ``values`` dict, partial user edits)."""
    payload = bs.get_object_property_schema(oid)
    values = dict(payload["values"])
    values.update(updates)
    bs.set_object_property_values(oid, values)


def test_uniform_to_non_uniform_populates_coords(fresh_bootstrap):
    """Toggling ``is_uniform_coords`` off must populate ``xcoords`` and
    ``ycoords`` from the previous ``x0``/``y0``/``dx``/``dy`` instead of
    leaving them empty."""
    bs = fresh_bootstrap
    oid = _create_image(bs, shape=(3, 4))
    # Start from a non-trivial uniform grid so the generated coords are
    # easy to assert against.
    _apply(bs, oid, x0=10.0, y0=20.0, dx=2.0, dy=5.0)
    _apply(bs, oid, is_uniform_coords=False)

    payload = bs.get_object_property_schema(oid)
    values = payload["values"]
    assert values["is_uniform_coords"] is False
    np.testing.assert_allclose(values["xcoords"], [10.0, 12.0, 14.0, 16.0])
    np.testing.assert_allclose(values["ycoords"], [20.0, 25.0, 30.0])
    # Extent must agree with the freshly-generated coordinate arrays.
    assert values["xmin"] == pytest.approx(10.0)
    assert values["xmax"] == pytest.approx(16.0)
    assert values["ymin"] == pytest.approx(20.0)
    assert values["ymax"] == pytest.approx(30.0)


def test_non_uniform_to_uniform_recomputes_origin_and_spacing(fresh_bootstrap):
    """Toggling ``is_uniform_coords`` back on must recompute ``x0``/``dx``
    (and Y counterparts) from the non-uniform arrays and clear them."""
    bs = fresh_bootstrap
    oid = _create_image(bs, shape=(3, 4))
    _apply(bs, oid, x0=10.0, y0=20.0, dx=2.0, dy=5.0)
    _apply(bs, oid, is_uniform_coords=False)
    _apply(bs, oid, is_uniform_coords=True)

    payload = bs.get_object_property_schema(oid)
    values = payload["values"]
    assert values["is_uniform_coords"] is True
    assert values["x0"] == pytest.approx(10.0)
    assert values["y0"] == pytest.approx(20.0)
    assert values["dx"] == pytest.approx(2.0)
    assert values["dy"] == pytest.approx(5.0)
    # ``set_uniform_coords`` clears the non-uniform arrays.
    assert len(values["xcoords"]) == 0
    assert len(values["ycoords"]) == 0


# ---------------------------------------------------------------------------
# Phase C — dynamic ``display.active`` propagation
# ---------------------------------------------------------------------------


def test_active_dynamic_flag_in_schema(fresh_bootstrap):
    """Items whose ``display.active`` is a callable / ItemProperty must
    carry ``x-guidata-active-dynamic`` so the form knows to re-evaluate
    the state on every value change."""
    bs = fresh_bootstrap
    oid = _create_image(bs)
    props = bs.get_object_property_schema(oid)["schema"]["properties"]
    for name in ("x0", "y0", "dx", "dy", "xcoords", "ycoords"):
        assert props[name].get("x-guidata-active-dynamic") is True, (
            f"{name!r} should be flagged as dynamically active"
        )
    # ``is_uniform_coords`` is statically ``active=False`` in Sigima
    # because the desktop UI drives the uniform/non-uniform switch via
    # a dedicated action (context menu).  DataLab-Web follows the same
    # convention — the checkbox is informative and the toggle will be
    # exposed by the future ``CoordsEditor`` button (Phase D).
    assert props["is_uniform_coords"].get("x-guidata-active") is False


def test_resolve_active_uniform_image(fresh_bootstrap):
    """Uniform image: ``x0/y0/dx/dy`` active, ``xcoords/ycoords`` not."""
    bs = fresh_bootstrap
    oid = _create_image(bs)
    state = bs.resolve_object_property_active(oid)
    if hasattr(state, "to_py"):
        state = state.to_py()
    assert state["x0"] is True
    assert state["y0"] is True
    assert state["dx"] is True
    assert state["dy"] is True
    assert state["xcoords"] is False
    assert state["ycoords"] is False


def test_resolve_active_follows_pending_edits(fresh_bootstrap):
    """Passing ``values`` must drive the resolution off the *pending*
    edits, not the persisted state, so the form can react in real-time
    when the user toggles ``is_uniform_coords``."""
    bs = fresh_bootstrap
    oid = _create_image(bs)
    state = bs.resolve_object_property_active(oid, {"is_uniform_coords": False})
    if hasattr(state, "to_py"):
        state = state.to_py()
    assert state["x0"] is False
    assert state["y0"] is False
    assert state["dx"] is False
    assert state["dy"] is False
    assert state["xcoords"] is True
    assert state["ycoords"] is True

