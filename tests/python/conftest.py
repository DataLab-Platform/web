# Copyright (c) DataLab Platform Developers, BSD 3-Clause License
# See LICENSE file for details
"""
Pytest configuration for DataLab-Web's headless Python tests.

The Python source code under :mod:`src/sigima` is normally loaded into
Pyodide via :mod:`runtime.ts`. To exercise it under CPython we replicate
the runtime's setup steps:

* prepend ``src/sigima`` and ``src/sigima/dlplugins`` to :data:`sys.path`,
* stub the Pyodide-only modules (:mod:`js`, :mod:`pyodide.ffi`) so that
  modules like :mod:`macro_proxy` import cleanly,
* alias :mod:`processor` to :mod:`dlw_processor` (the runtime writes the
  bundled file under that name in Pyodide's filesystem).

Common fixtures are also defined here.
"""

from __future__ import annotations

import importlib
import sys
import types
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Path setup — must run *before* any ``import bootstrap``.
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
SIGIMA_SRC = REPO_ROOT / "src" / "sigima"
DLPLUGINS_DIR = SIGIMA_SRC / "dlplugins"

for path in (SIGIMA_SRC, DLPLUGINS_DIR):
    str_path = str(path)
    if str_path not in sys.path:
        sys.path.insert(0, str_path)


# ---------------------------------------------------------------------------
# Stub Pyodide-only modules (only needed when ``macro_proxy`` is imported).
# ---------------------------------------------------------------------------

if "js" not in sys.modules:
    js_stub = types.ModuleType("js")
    # Placeholder bridge — tests that exercise macros must replace this.
    js_stub._dlw_bridge_call = None  # type: ignore[attr-defined]
    js_stub.Object = types.SimpleNamespace(  # type: ignore[attr-defined]
        fromEntries=lambda items: dict(items)
    )
    sys.modules["js"] = js_stub

if "pyodide" not in sys.modules:
    pyodide_stub = types.ModuleType("pyodide")
    ffi_stub = types.ModuleType("pyodide.ffi")
    ffi_stub.to_js = lambda value, **_kwargs: value  # type: ignore[attr-defined]
    pyodide_stub.ffi = ffi_stub  # type: ignore[attr-defined]
    sys.modules["pyodide"] = pyodide_stub
    sys.modules["pyodide.ffi"] = ffi_stub


# ---------------------------------------------------------------------------
# Alias ``processor`` -> ``dlw_processor`` (mirrors the FS write in runtime.ts).
# ---------------------------------------------------------------------------

if "dlw_processor" not in sys.modules:
    sys.modules["dlw_processor"] = importlib.import_module("processor")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def fresh_bootstrap():
    """Return a freshly-reloaded :mod:`bootstrap` module.

    Bootstrap holds module-level state (``_MODEL``, ``_MACROS`` ...). To
    isolate tests we re-import it with the live globals dropped. Sigima's
    catalogue introspection is expensive, so we keep the existing
    ``_CATALOG`` if it was already populated.
    """
    # Drop the cached module if present, then re-import. To preserve the
    # catalogue (heavy to rebuild), capture it first.
    cached = sys.modules.get("bootstrap")
    catalog = getattr(cached, "_CATALOG", None) if cached is not None else None
    sys.modules.pop("bootstrap", None)
    bootstrap = importlib.import_module("bootstrap")
    if catalog is not None:
        bootstrap._CATALOG = catalog  # type: ignore[attr-defined]
    return bootstrap


@pytest.fixture
def bootstrap_module():
    """Return the (cached) bootstrap module without resetting state.

    Use for read-only tests that don't mutate the in-memory model.
    """
    return importlib.import_module("bootstrap")
