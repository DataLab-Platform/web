"""The demo refuses large HDF5 operations before touching data buffers."""

from __future__ import annotations

import io

import h5py
import numpy as np
import pytest


def test_large_logical_dataset_does_not_replace_workspace(fresh_bootstrap, monkeypatch):
    bs = fresh_bootstrap
    oid = bs.add_image_from_array("Keep me", np.ones((4, 5)))
    monkeypatch.setattr(bs, "_WASM64_VIEW", True)
    buf = io.BytesIO()
    with h5py.File(buf, "w") as h5:
        h5["DataLab_Version"] = "1.4.1"
        h5.create_dataset("sparse", shape=(9000, 9000), dtype="u1", chunks=True)
    assert len(buf.getvalue()) < 65536
    with pytest.raises(ValueError, match="budget"):
        bs.open_workspace_from_bytes("large.h5", buf.getvalue())
    np.testing.assert_equal(bs._MODEL.get(oid).data, np.ones((4, 5)))
    monkeypatch.setattr(bs, "_WASM64_H5_BUDGET", 100)
    with pytest.raises(ValueError, match="budget"):
        bs.save_workspace_to_bytes()
