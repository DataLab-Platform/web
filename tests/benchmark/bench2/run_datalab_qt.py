"""Bench #2 — DataLab Qt driver (in-process, processing + visualization).

Boots a real ``DLMainWindow`` via :func:`datalab_test_app_context`, then for
each image of the shared chain:

  1. adds the source image to the panel (counts toward render time of input),
  2. for each step, invokes :meth:`proc.run_feature` so the full app stack
     (processor → ``add_object`` → plot redraw) is exercised, and times the
     end-to-end round-trip.

Run with::

    python ../DataLab/scripts/run_with_env.py python tests/benchmark/bench2/run_datalab_qt.py

Optional flags::

    --runs N         override measured_runs from chain.json
    --warmup N       override warmup_runs from chain.json

The script writes one JSON file per measured run to
``tests/benchmark/results/`` with per-step processing+render time. Cold-start
covers the time from process launch to the moment ``DLMainWindow`` is shown.
"""

# guitest: show — DataLab's pytest harness picks this up automatically when
# the script is launched directly.

from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SHARED = HERE.parent / "shared"
RESULTS = HERE.parent / "results"
sys.path.insert(0, str(SHARED))

# pylint: disable=wrong-import-position
import sigima.proc.image as sipi  # noqa: E402
from chain_runner import generate_images  # noqa: E402
from datalab.tests import datalab_test_app_context  # noqa: E402
from qtpy import QtCore as QC  # noqa: E402

_BENCH_T0 = time.perf_counter()  # process-level cold-start anchor


def _flush_qt(max_ms: int = 500) -> None:
    """Process Qt events until idle or *max_ms* elapsed.

    Used after each ``run_feature`` call to ensure the plot redraw has been
    flushed before the timer is stopped. Not perfect (Qt may post deferred
    paint events slightly later) but sufficient for benchmarking purposes.
    """
    deadline = time.perf_counter() + max_ms / 1000.0
    while time.perf_counter() < deadline:
        QC.QCoreApplication.processEvents(QC.QEventLoop.AllEvents, 5)
        QC.QCoreApplication.sendPostedEvents()
        # No reliable "is idle" predicate; bail out after a short slice
        # so we're not spinning for the full deadline on every step.
        time.sleep(0.001)
        # Heuristic: 50 ms is well above typical plot redraw latency.
        if time.perf_counter() > deadline - (max_ms - 50) / 1000.0:
            break


_STEP_FUNC_BY_NAME = {
    "gaussian_filter": sipi.gaussian_filter,
    "moving_median": sipi.moving_median,
    "magnitude_spectrum": sipi.magnitude_spectrum,
    "opening": sipi.opening,
    "threshold": sipi.threshold,
    "blob_log": sipi.blob_log,
}


def _run_one_iteration(win, chain: dict) -> dict:
    """Run the chain end-to-end through the application stack.

    For each (image, step) pair we measure two numbers:

      * ``process_ms`` — time spent in the raw Sigima call,
      * ``render_ms`` — time spent in ``panel.add_object`` + Qt event
        flush (PlotPy redraw).

    These map 1:1 to the ``per_step_ms`` / ``render_ms_per_step`` fields
    produced by the Web bench so the report can compare the splits.
    """
    panel = win.imagepanel

    n = int(chain["n_images"])
    size = int(chain["image_size"])
    seed = int(chain["seed"])
    noise = float(chain.get("noise_amplitude", 0.05))
    steps = chain["steps"]

    images = generate_images(n, size, seed, noise_amplitude=noise)

    per_step_ms = {step["name"]: 0.0 for step in steps}
    render_ms_per_step = {step["name"]: 0.0 for step in steps}
    blob_checksum = 0

    t_total_start = time.perf_counter()
    for img in images:
        # Add and render the source image (initial draw, not measured per
        # step but folded into the wall-clock total).
        panel.add_object(img)
        _flush_qt()
        src_oid = panel.objmodel.get_object_ids()[-1]

        for step in steps:
            name = step["name"]
            kwargs = step.get("kwargs", {}) or {}
            func = _STEP_FUNC_BY_NAME[name]
            renders_image = bool(step.get("renders_image", True))

            # ── Process (raw Sigima call) ──
            t0 = time.perf_counter()
            result = func(img, **kwargs)
            per_step_ms[name] += (time.perf_counter() - t0) * 1000.0

            if name == "blob_log":
                # Detection result; count detected blobs.
                coords = getattr(result, "coords", None)
                if coords is not None:
                    blob_checksum += int(coords.shape[0])

            # ── Render (add to panel + flush Qt) ──
            if renders_image and result is not None:
                t1 = time.perf_counter()
                panel.add_object(result)
                _flush_qt()
                render_ms_per_step[name] += (time.perf_counter() - t1) * 1000.0

                # Drop the intermediate to bound peak memory and keep the
                # tree small.
                try:
                    new_oid = panel.objmodel.get_object_ids()[-1]
                    panel.remove_object(new_oid)
                except Exception:
                    pass
                _flush_qt(50)

        # Drop the source before moving on.
        try:
            panel.remove_object(src_oid)
        except Exception:
            pass
        _flush_qt(50)

    total_ms = (time.perf_counter() - t_total_start) * 1000.0
    return {
        "n_images": n,
        "image_size": size,
        "seed": seed,
        "per_step_ms": per_step_ms,
        "render_ms_per_step": render_ms_per_step,
        "total_ms": total_ms,
        "blob_checksum": blob_checksum,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Bench #2 — DataLab Qt")
    parser.add_argument("--runs", type=int, default=None)
    parser.add_argument("--warmup", type=int, default=None)
    parser.add_argument("--tag", type=str, default="")
    args = parser.parse_args()

    with (SHARED / "chain.json").open("r", encoding="utf-8") as fp:
        chain = json.load(fp)

    n_warmup = args.warmup if args.warmup is not None else int(chain["warmup_runs"])
    n_runs = args.runs if args.runs is not None else int(chain["measured_runs"])

    RESULTS.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    pyver = platform.python_version()
    plat = f"{platform.system()}-{platform.machine()}"

    print(
        f"[bench2/datalab_qt] Python {pyver} on {plat} | "
        f"warmup={n_warmup} measured={n_runs} | "
        f"N={chain['n_images']} size={chain['image_size']}²"
    )

    # Use the shared test harness so everything matches a normal app test.
    # exec_loop=False prevents the context manager from blocking on qApp.exec_().
    with datalab_test_app_context(maximized=True, exec_loop=False) as win:
        cold_start_ms = (time.perf_counter() - _BENCH_T0) * 1000.0
        print(f"  cold-start (process → window shown): {cold_start_ms:.0f} ms")

        try:
            import datalab  # type: ignore

            datalab_version = getattr(datalab, "__version__", "unknown")
        except Exception:
            datalab_version = "unknown"
        try:
            import sigima  # type: ignore

            sigima_version = getattr(sigima, "__version__", "unknown")
        except Exception:
            sigima_version = "unknown"

        for run_idx in range(n_warmup + n_runs):
            is_warmup = run_idx < n_warmup
            label = "warmup" if is_warmup else f"run {run_idx - n_warmup + 1}/{n_runs}"

            # Reset panel between runs to avoid cumulative slowdown.
            try:
                win.imagepanel.remove_all_objects()
            except Exception:
                pass
            _flush_qt(100)

            t0 = time.perf_counter()
            result = _run_one_iteration(win, chain)
            wall_ms = (time.perf_counter() - t0) * 1000.0

            payload = {
                "bench": "bench2",
                "backend": "datalab_qt",
                "warmup": is_warmup,
                "run_index": run_idx,
                "wall_ms": wall_ms,
                "cold_start_ms": cold_start_ms
                if (is_warmup and run_idx == 0)
                else None,
                "python_version": pyver,
                "platform": plat,
                "datalab_version": datalab_version,
                "sigima_version": sigima_version,
                "timestamp_utc": timestamp,
                **result,
            }

            suffix = f"_{args.tag}" if args.tag else ""
            out = (
                RESULTS
                / f"bench2_datalab_qt_{timestamp}_r{run_idx:02d}{'_warmup' if is_warmup else ''}{suffix}.json"
            )
            out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            print(
                f"  {label:>14}: total={result['total_ms']:>8.0f} ms  "
                f"(wall={wall_ms:>8.0f} ms)  blobs={result['blob_checksum']}  → {out.name}"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
