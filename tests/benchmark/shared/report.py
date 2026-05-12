"""Aggregate per-backend benchmark JSON files into a comparative report.

Reads every ``*.json`` in ``results/`` matching ``<bench>_<backend>_*.json``,
groups by ``(bench, backend)``, computes median ± stddev across measured runs
(skipping the first run flagged as ``warmup=True``), and emits
``results/report.md`` with two side-by-side tables (bench #1 and bench #2)
plus a separate cold-start row.

Run with:
    python tests/benchmark/shared/report.py [results_dir]
"""

from __future__ import annotations

import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

DEFAULT_RESULTS_DIR = Path(__file__).resolve().parents[1] / "results"

BENCH1_BACKENDS = ["cpython", "pyodide_node", "pyodide_browser"]
BENCH2_BACKENDS = ["datalab_qt", "datalab_web"]


def _median_std(values: list[float]) -> tuple[float, float]:
    if not values:
        return (math.nan, math.nan)
    if len(values) == 1:
        return (values[0], 0.0)
    return (statistics.median(values), statistics.pstdev(values))


def _fmt_ms(median: float, std: float) -> str:
    if math.isnan(median):
        return "—"
    if std == 0.0:
        return f"{median:,.0f}"
    return f"{median:,.0f} ± {std:,.0f}"


def _load_runs(
    results_dir: Path,
) -> tuple[
    dict[tuple[str, str], list[dict[str, Any]]],
    dict[tuple[str, str], list[dict[str, Any]]],
]:
    """Group result JSON files by (bench, backend).

    Returns a (measured, warmup) pair: measured runs feed timing aggregation,
    warmup runs feed cold-start aggregation only.
    """
    measured: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    warmup: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for path in sorted(results_dir.glob("*.json")):
        try:
            with path.open("r", encoding="utf-8") as fp:
                payload = json.load(fp)
        except (OSError, json.JSONDecodeError):
            continue
        bench = payload.get("bench")
        backend = payload.get("backend")
        if bench is None or backend is None:
            continue
        if payload.get("warmup", False):
            warmup[(bench, backend)].append(payload)
        else:
            measured[(bench, backend)].append(payload)
    return measured, warmup


def _aggregate_per_step(
    runs: list[dict[str, Any]], step_names: list[str]
) -> dict[str, tuple[float, float]]:
    out: dict[str, tuple[float, float]] = {}
    for step in step_names:
        values = [r["per_step_ms"].get(step, math.nan) for r in runs]
        values = [v for v in values if not math.isnan(v)]
        out[step] = _median_std(values)
    return out


def _aggregate_total(runs: list[dict[str, Any]]) -> tuple[float, float]:
    return _median_std([r["total_ms"] for r in runs])


def _aggregate_render(
    runs: list[dict[str, Any]], step_names: list[str]
) -> dict[str, tuple[float, float]]:
    out: dict[str, tuple[float, float]] = {}
    for step in step_names:
        values: list[float] = []
        for r in runs:
            render = r.get("render_ms_per_step", {})
            v = render.get(step)
            if v is not None:
                values.append(float(v))
        out[step] = _median_std(values)
    return out


def _aggregate_cold(runs: list[dict[str, Any]]) -> tuple[float, float]:
    values = [
        r.get("cold_start_ms") for r in runs if r.get("cold_start_ms") is not None
    ]
    return _median_std([float(v) for v in values])


def _bench1_table(grouped, chain: dict) -> str:
    step_names = [s["name"] for s in chain["steps"]]
    backends = [b for b in BENCH1_BACKENDS if ("bench1", b) in grouped]
    if not backends:
        return "_(no bench #1 results)_\n"

    header = "| Step | " + " | ".join(b for b in backends) + " |"
    sep = "|------|" + "|".join("------" for _ in backends) + "|"
    lines = [header, sep]
    for step in step_names:
        cells = []
        for b in backends:
            agg = _aggregate_per_step(grouped[("bench1", b)], [step])
            cells.append(_fmt_ms(*agg[step]))
        lines.append(f"| `{step}` | " + " | ".join(cells) + " |")

    # Total row
    cells = []
    for b in backends:
        cells.append(_fmt_ms(*_aggregate_total(grouped[("bench1", b)])))
    lines.append("| **total** | " + " | ".join(f"**{c}**" for c in cells) + " |")

    # Speed-down vs CPython baseline
    if "cpython" in backends:
        base_med, _std = _aggregate_total(grouped[("bench1", "cpython")])
        ratio_cells = []
        for b in backends:
            med, _ = _aggregate_total(grouped[("bench1", b)])
            if math.isnan(base_med) or math.isnan(med) or base_med == 0:
                ratio_cells.append("—")
            else:
                ratio_cells.append(f"×{med / base_med:.2f}")
        lines.append("| _vs CPython_ | " + " | ".join(ratio_cells) + " |")

    return "\n".join(lines) + "\n"


def _bench2_table(grouped, chain: dict) -> str:
    step_names = [s["name"] for s in chain["steps"]]
    backends = [b for b in BENCH2_BACKENDS if ("bench2", b) in grouped]
    if not backends:
        return "_(no bench #2 results)_\n"

    # One column pair (process | render) per backend.
    header_cells = ["Step"]
    for b in backends:
        header_cells += [f"{b} — process (ms)", f"{b} — render (ms)"]
    header = "| " + " | ".join(header_cells) + " |"
    sep = "|" + "|".join("------" for _ in header_cells) + "|"
    lines = [header, sep]

    for step in step_names:
        row = [f"`{step}`"]
        for b in backends:
            proc_agg = _aggregate_per_step(grouped[("bench2", b)], [step])[step]
            rend_agg = _aggregate_render(grouped[("bench2", b)], [step])[step]
            row += [_fmt_ms(*proc_agg), _fmt_ms(*rend_agg)]
        lines.append("| " + " | ".join(row) + " |")

    # Totals
    total_row = ["**total**"]
    for b in backends:
        total_row += [
            f"**{_fmt_ms(*_aggregate_total(grouped[('bench2', b)]))}**",
            "—",
        ]
    lines.append("| " + " | ".join(total_row) + " |")
    return "\n".join(lines) + "\n"


def _cold_start_table(warmup) -> str:
    rows = []
    for bench, backends in (("bench1", BENCH1_BACKENDS), ("bench2", BENCH2_BACKENDS)):
        for b in backends:
            key = (bench, b)
            if key not in warmup:
                continue
            med, std = _aggregate_cold(warmup[key])
            if math.isnan(med):
                continue
            rows.append(f"| {bench} | `{b}` | {_fmt_ms(med, std)} |")
    if not rows:
        return "_(no cold-start data)_\n"
    return (
        "| Bench | Backend | Cold-start (ms) |\n|-------|---------|----------------|\n"
        + "\n".join(rows)
        + "\n"
    )


def build_report(results_dir: Path) -> str:
    grouped, warmup = _load_runs(results_dir)
    chain_path = Path(__file__).with_name("chain.json")
    with chain_path.open("r", encoding="utf-8") as fp:
        chain = json.load(fp)

    n_per_backend = {
        f"{bench}/{backend}": len(runs)
        for (bench, backend), runs in sorted(grouped.items())
    }

    md = [
        "# DataLab Web vs DataLab Qt — Benchmark report\n",
        "_Auto-generated from `tests/benchmark/results/*.json`._\n",
        "## Configuration\n",
        f"- **Image size**: {chain['image_size']}×{chain['image_size']}",
        f"- **Number of images per run**: {chain['n_images']}",
        f"- **Seed**: {chain['seed']}",
        f"- **Measured runs (per backend)**: {chain['measured_runs']} (warm-up: {chain['warmup_runs']})",
        f"- **Sigima version pin**: `{chain.get('sigima_version') or 'local / latest available'}`",
        f"- **Runs collected**: "
        + ", ".join(f"{k}={v}" for k, v in n_per_backend.items())
        + "\n",
        "> **Note on single-iteration measurement.** Each backend runs"
        " 1 warm-up + 1 measured iteration. The warm-up absorbs cold-start"
        " effects (Pyodide bootstrap, JIT/code-cache, scikit-image lazy"
        " imports). For Bench #2 Web, longer multi-iteration runs"
        " accumulate Pyodide-GC / DOM / React state that is **not"
        " representative of interactive use** (1–3 images, 1–2 ops, then"
        " observation) and inflates apparent process time. A single"
        " post-warm-up iteration is closer to the steady-state cost a"
        " user actually experiences.\n",
        "## Bench #1 — Pure processing (per-step ms, sum across all images)\n",
        _bench1_table(grouped, chain),
        "\n## Bench #2 — Processing + visualization (per-step ms, sum across all images)\n",
        _bench2_table(grouped, chain),
        "\n## Cold-start (reported separately, never folded into processing time)\n",
        _cold_start_table(warmup),
    ]
    return "\n".join(md)


def main() -> int:
    results_dir = (
        Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_RESULTS_DIR
    )
    results_dir.mkdir(parents=True, exist_ok=True)
    report = build_report(results_dir)
    out = results_dir / "report.md"
    out.write_text(report, encoding="utf-8")
    print(f"Report written to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
