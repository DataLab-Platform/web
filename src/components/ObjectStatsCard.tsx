/**
 * ObjectStatsCard — read-only stats summary for the Properties tab.
 *
 * Mirrors DataLab desktop's "Statistics" group above the Properties
 * panel: a compact table of dtype / shape / min / max / mean / std /
 * median, kept in sync with the underlying SignalObj / ImageObj.
 */

import type { ObjectStats } from "../runtime/runtime";

interface Props {
  stats: ObjectStats | null;
  error?: string | null;
}

export function ObjectStatsCard({ stats, error }: Props) {
  if (error) {
    return <div className="stats-card error">{error}</div>;
  }
  if (!stats) {
    return <div className="stats-card loading">Loading stats…</div>;
  }
  const rows = stats.kind === "signal" ? signalRows(stats) : imageRows(stats);
  return (
    <section className="stats-card" aria-label="Object statistics">
      <h3 className="stats-card-title">Statistics</h3>
      <dl className="stats-card-grid">
        {rows.map(([label, value]) => (
          <div className="stats-card-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function signalRows(
  s: Extract<ObjectStats, { kind: "signal" }>,
): [string, string][] {
  return [
    ["Points", String(s.n_points)],
    ["X dtype", s.x_dtype],
    ["Y dtype", s.y_dtype],
    ["X min", fmt(s.x_min)],
    ["X max", fmt(s.x_max)],
    ["Y min", fmt(s.y_min)],
    ["Y max", fmt(s.y_max)],
    ["Y mean", fmt(s.y_mean)],
    ["Y std", fmt(s.y_std)],
    ["Y median", fmt(s.y_median)],
  ];
}

function imageRows(
  s: Extract<ObjectStats, { kind: "image" }>,
): [string, string][] {
  return [
    ["Shape", `${s.shape.join(" × ")}`],
    ["dtype", s.dtype],
    ["Min", fmt(s.min)],
    ["Max", fmt(s.max)],
    ["Mean", fmt(s.mean)],
    ["Std", fmt(s.std)],
    ["Median", fmt(s.median)],
  ];
}

/** Format a numeric stat (or ``—`` for null/NaN). */
function fmt(v: number | null): string {
  if (v == null) return "—";
  // Compact display: 4 significant digits, switch to exponential
  // when the value is very large or very small.
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) {
    return v.toExponential(4);
  }
  return Number(v.toPrecision(6)).toString();
}
