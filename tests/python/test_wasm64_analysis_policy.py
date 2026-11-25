"""WASM64 must not list or try to resolve Pyodide-only analysis packages."""

import asyncio

import bootstrap
import pytest


def test_lazy_packages_are_not_offered_or_installed(monkeypatch):
    def listed():
        return {entry["id"] for entry in bootstrap.list_image_analysis()}

    monkeypatch.setattr(bootstrap, "_wasm64_analysis_runtime", lambda: False)
    stable = listed()
    assert "blob_opencv" in stable
    monkeypatch.setattr(bootstrap, "_wasm64_analysis_runtime", lambda: True)
    assert listed() == stable - {"blob_opencv"}
    with pytest.raises(RuntimeError, match="Unavailable in WASM64"):
        asyncio.run(bootstrap._ensure_pyodide_pkg("opencv-python"))
