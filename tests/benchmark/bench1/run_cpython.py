"""Bench #1 — CPython baseline driver.

Runs the shared image-processing chain in plain CPython (no Pyodide, no UI),
performs *warmup_runs* + *measured_runs* iterations, writes one JSON file per
measured run to ``tests/benchmark/results/``.

Run with the local Sigima resolved through ``.env``::

    python ../Sigima/scripts/run_with_env.py python tests/benchmark/bench1/run_cpython.py

Optional flags::

    --runs N         override measured_runs from chain.json
    --warmup N       override warmup_runs from chain.json
    --tag SUFFIX     append a custom suffix to the result filename
"""

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

# Measure CPython "cold start" as the pure import time of Sigima + chain
# helpers, separate from the first chain run (which would otherwise drown
# the import time in workload time).
_T_COLD_START = time.perf_counter()
from chain_runner import run_chain  # noqa: E402

_COLD_START_MS = (time.perf_counter() - _T_COLD_START) * 1000.0


def _load_chain() -> dict:
    with (SHARED / "chain.json").open("r", encoding="utf-8") as fp:
        return json.load(fp)


def _sigima_version() -> str:
    try:
        import sigima  # type: ignore

        return getattr(sigima, "__version__", "unknown")
    except Exception:  # pragma: no cover - defensive
        return "unknown"


def main() -> int:
    parser = argparse.ArgumentParser(description="Bench #1 — CPython baseline")
    parser.add_argument("--runs", type=int, default=None)
    parser.add_argument("--warmup", type=int, default=None)
    parser.add_argument("--tag", type=str, default="")
    args = parser.parse_args()

    chain = _load_chain()
    n_warmup = args.warmup if args.warmup is not None else int(chain["warmup_runs"])
    n_runs = args.runs if args.runs is not None else int(chain["measured_runs"])

    RESULTS.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    sigver = _sigima_version()
    pyver = platform.python_version()
    plat = f"{platform.system()}-{platform.machine()}"

    print(
        f"[bench1/cpython] Python {pyver} on {plat} | sigima={sigver} | "
        f"warmup={n_warmup} measured={n_runs} | "
        f"N={chain['n_images']} size={chain['image_size']}²"
    )

    # Cold-start: import time + first chain execution time. We approximate it
    # by measuring the first run separately (which includes any lazy import in
    # Sigima) and reporting it on the warmup record.
    for run_idx in range(n_warmup + n_runs):
        is_warmup = run_idx < n_warmup
        label = "warmup" if is_warmup else f"run {run_idx - n_warmup + 1}/{n_runs}"
        t0 = time.perf_counter()
        result = run_chain(chain)
        wall_ms = (time.perf_counter() - t0) * 1000.0

        payload = {
            "bench": "bench1",
            "backend": "cpython",
            "warmup": is_warmup,
            "run_index": run_idx,
            "wall_ms": wall_ms,
            "cold_start_ms": _COLD_START_MS if (is_warmup and run_idx == 0) else None,
            "python_version": pyver,
            "platform": plat,
            "sigima_version": sigver,
            "timestamp_utc": timestamp,
            **result,
        }

        suffix = f"_{args.tag}" if args.tag else ""
        out = (
            RESULTS
            / f"bench1_cpython_{timestamp}_r{run_idx:02d}{'_warmup' if is_warmup else ''}{suffix}.json"
        )
        out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(
            f"  {label:>14}: total={result['total_ms']:>8.0f} ms  "
            f"(wall={wall_ms:>8.0f} ms)  blobs={result['blob_checksum']}  → {out.name}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
