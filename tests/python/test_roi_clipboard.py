"""Tests for the ROI clipboard and ROI import/export bridge.

Exercises the ``bootstrap`` helpers behind DataLab-Web's "Copy ROI",
"Paste ROI", "Import ROI" and "Export ROI" actions, so the Python side
stays green when refactoring.  These mirror DataLab desktop's ROI menu.
"""

from __future__ import annotations

import numpy as np


def _add_signal_with_roi(bs, title="Sig"):
    x = np.linspace(0, 10, 256, dtype=np.float64)
    y = np.sin(x).astype(np.float64)
    oid = bs.add_signal_from_arrays(title, x, y)
    bs.set_signal_roi(oid, [{"xmin": 1.0, "xmax": 3.0, "title": "A"}])
    return oid


def _add_image_with_roi(bs, title="Img"):
    data = np.arange(64, dtype=np.float64).reshape((8, 8))
    oid = bs.add_image_from_array(title, data)
    bs.set_image_roi(
        oid,
        [
            {
                "geometry": "rectangle",
                "title": "R",
                "inverse": False,
                "x0": 1.0,
                "y0": 1.0,
                "dx": 3.0,
                "dy": 2.0,
            }
        ],
    )
    return oid


def test_copy_paste_signal_roi(fresh_bootstrap):
    bs = fresh_bootstrap
    src = _add_signal_with_roi(bs)
    dst = bs.add_signal_from_arrays("Empty", [0.0, 1.0], [0.0, 1.0])

    assert bs.copy_object_roi(src) is True
    assert bs.has_roi_in_clipboard("signal") is True
    assert bs.has_roi_in_clipboard("image") is False

    assert bs.paste_object_roi([dst]) == 1
    pasted = bs.get_signal_roi(dst)
    assert len(pasted) == 1
    assert pasted[0]["xmin"] == 1.0
    assert pasted[0]["xmax"] == 3.0


def test_paste_merges_with_existing_roi(fresh_bootstrap):
    bs = fresh_bootstrap
    src = _add_signal_with_roi(bs)
    dst = bs.add_signal_from_arrays("Other", np.linspace(0, 10, 8), np.zeros(8))
    bs.set_signal_roi(dst, [{"xmin": 5.0, "xmax": 6.0, "title": "B"}])

    bs.copy_object_roi(src)
    bs.paste_object_roi([dst])
    merged = bs.get_signal_roi(dst)
    assert len(merged) == 2  # existing + pasted


def test_copy_object_with_no_roi_is_noop(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("Bare", [0.0, 1.0], [0.0, 1.0])
    assert bs.copy_object_roi(oid) is False
    assert bs.has_roi_in_clipboard("signal") is False


def test_export_import_signal_roi_round_trip(fresh_bootstrap):
    bs = fresh_bootstrap
    src = _add_signal_with_roi(bs)
    blob = bs.export_object_roi_bytes(src)
    assert isinstance(blob, (bytes, bytearray))

    dst = bs.add_signal_from_arrays("Target", [0.0, 1.0], [0.0, 1.0])
    bs.import_object_roi_bytes(dst, blob)
    imported = bs.get_signal_roi(dst)
    assert len(imported) == 1
    assert imported[0]["xmin"] == 1.0
    assert imported[0]["xmax"] == 3.0


def test_export_import_image_roi_round_trip(fresh_bootstrap):
    bs = fresh_bootstrap
    src = _add_image_with_roi(bs)
    blob = bs.export_object_roi_bytes(src)

    data = np.zeros((8, 8), dtype=np.float64)
    dst = bs.add_image_from_array("Target", data)
    bs.import_object_roi_bytes(dst, blob)
    imported = bs.get_image_roi(dst)
    assert len(imported) == 1
    assert imported[0]["geometry"] == "rectangle"


def test_import_wrong_type_rejected(fresh_bootstrap):
    bs = fresh_bootstrap
    sig = _add_signal_with_roi(bs)
    blob = bs.export_object_roi_bytes(sig)

    img = bs.add_image_from_array("Img", np.zeros((4, 4), dtype=np.float64))
    try:
        bs.import_object_roi_bytes(img, blob)
    except ValueError:
        pass
    else:  # pragma: no cover - defensive
        raise AssertionError("expected ValueError for signal ROI on image")


def test_export_without_roi_raises(fresh_bootstrap):
    bs = fresh_bootstrap
    oid = bs.add_signal_from_arrays("Bare", [0.0, 1.0], [0.0, 1.0])
    try:
        bs.export_object_roi_bytes(oid)
    except ValueError:
        pass
    else:  # pragma: no cover - defensive
        raise AssertionError("expected ValueError when exporting object with no ROI")
