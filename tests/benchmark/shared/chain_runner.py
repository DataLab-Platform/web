"""Runtime-agnostic image-processing chain runner.

Same module runs in CPython AND inside Pyodide. It only depends on Sigima +
NumPy. **Do not import** matplotlib, Qt, multiprocessing, file watchers, or
anything else that would break in the browser sandbox.

Used by:
  * ``bench1/run_cpython.py``           (CPython)
  * ``bench1/run_pyodide_node.mjs``     (Pyodide under Node.js)
  * ``bench1/bench1_browser.spec.ts``   (Pyodide in headless browser)

Reads the chain definition from ``shared/chain.json`` (passed as a JSON
string when running inside Pyodide; loaded from disk in CPython).
"""

from __future__ import annotations

import json
import time
from typing import Any

import numpy as np
from sigima.objects.image.creation import (
    ImageTypes,
    create_image,
    create_image_parameters,
)
from sigima.proc.image.detection import blob_log
from sigima.proc.image.filtering import gaussian_filter, moving_median
from sigima.proc.image.fourier import magnitude_spectrum
from sigima.proc.image.morphology import opening
from sigima.proc.image.threshold import threshold


def _now() -> float:
    return time.perf_counter()


# Step name -> callable. Each step is invoked with the *original* image so
# per-step timings are independent and benchmarks remain comparable across
# runtimes regardless of intermediate dtype changes.
_STEP_FUNCS = {
    "gaussian_filter": gaussian_filter,
    "moving_median": moving_median,
    "magnitude_spectrum": magnitude_spectrum,
    "opening": opening,
    "threshold": threshold,
    "blob_log": blob_log,
}


def generate_images(
    n: int, size: int, seed: int, noise_amplitude: float = 0.05
) -> list:
    """Build *n* deterministic synthetic images of shape (size, size).

    Each image is a 2-D Gaussian (Sigima ``Gauss2DParam``) with a small layer
    of additive noise so blob detection has work to do. The noise is seeded
    so every backend produces identical data.
    """
    rng = np.random.default_rng(seed)
    images = []
    for i in range(n):
        gp = create_image_parameters(
            ImageTypes.GAUSS,
            height=size,
            width=size,
            title=f"img_{i:03d}",
        )
        data = gp.generate_2d_data((size, size))
        amplitude = float(np.max(np.abs(data))) or 1.0
        noise = (
            rng.standard_normal((size, size)).astype(data.dtype)
            * noise_amplitude
            * amplitude
        )
        images.append(
            create_image(f"img_{i:03d}", data=(data + noise).astype(data.dtype))
        )
    return images


def _checksum_blobs(result: Any) -> int:
    """Return number of detected blobs (0 if None / empty)."""
    if result is None:
        return 0
    coords = getattr(result, "coords", None)
    if coords is None:
        return 0
    return int(coords.shape[0])


def run_chain(definition: dict) -> dict:
    """Run the chain once and return per-step + total timings.

    Args:
        definition: parsed ``chain.json`` payload.

    Returns:
        A JSON-serialisable dict with per-step total time (ms across all
        images), wall-clock total, generation time, and a deterministic
        ``blob_checksum`` for cross-runtime numerical validation.
    """
    n = int(definition["n_images"])
    size = int(definition["image_size"])
    seed = int(definition["seed"])
    noise = float(definition.get("noise_amplitude", 0.05))
    steps = definition["steps"]

    t_gen0 = _now()
    images = generate_images(n, size, seed, noise_amplitude=noise)
    t_gen = _now() - t_gen0

    per_step_ms = {step["name"]: 0.0 for step in steps}
    blob_checksum = 0

    for img in images:
        for step in steps:
            name = step["name"]
            kwargs = step.get("kwargs", {}) or {}
            func = _STEP_FUNCS[name]
            t0 = _now()
            result = func(img, **kwargs)
            per_step_ms[name] += (_now() - t0) * 1000.0
            if name == "blob_log":
                blob_checksum += _checksum_blobs(result)

    total_ms = t_gen * 1000.0 + sum(per_step_ms.values())
    return {
        "n_images": n,
        "image_size": size,
        "seed": seed,
        "generate_ms": t_gen * 1000.0,
        "per_step_ms": per_step_ms,
        "total_ms": total_ms,
        "blob_checksum": blob_checksum,
    }


def run_chain_from_json_str(definition_json: str) -> str:
    """Pyodide-friendly entry point: takes/returns JSON strings.

    The Pyodide-Node and Pyodide-Browser backends call this from JS to
    avoid PyProxy round-trips for the chain definition and the result.
    """
    return json.dumps(run_chain(json.loads(definition_json)))


if __name__ == "__main__":
    import sys
    from pathlib import Path

    chain_path = Path(__file__).with_name("chain.json")
    if len(sys.argv) > 1:
        chain_path = Path(sys.argv[1])
    with chain_path.open("r", encoding="utf-8") as fp:
        defn = json.load(fp)
    print(json.dumps(run_chain(defn), indent=2))
