"""Temporary resolver exception for the Emscripten Forge artifact tracked in web#139."""

from __future__ import annotations

import warnings
from collections.abc import Mapping

KIWI_SHA256 = "1515fc7ff9637422d222eb2ae2c4eb91dfc3b6e598a894ad7e9d210ec73ceac8"


def distribution_version(
    record: Mapping[str, object], name: str, version: str, enabled: bool
) -> str:
    """Use the conda version for this verified artifact only, never edit its bytes."""
    if (
        enabled
        and name == "kiwisolver"
        and version == "0.0.0"
        and record["name"] == name
        and record["version"] == "1.5.1"
        and record["build"] == "py314hd0a4d62_0"
        and record["subdir"] == "emscripten-wasm64"
        and record["sha256"] == KIWI_SHA256
    ):
        warnings.warn(
            "web#139: checking requirements against conda kiwisolver 1.5.1; "
            "the original Python distribution metadata still says 0.0.0",
            stacklevel=2,
        )
        return "1.5.1"
    return version
