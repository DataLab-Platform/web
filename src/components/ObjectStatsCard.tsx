/**
 * ObjectStatsCard — read-only stats summary for the Properties tab.
 *
 * Mirrors DataLab desktop's "Statistics" group above the Properties
 * panel: a compact table of dtype / shape / min / max / mean / std /
 * median, kept in sync with the underlying SignalObj / ImageObj.
 */

import type { ObjectStats } from "../runtime/runtime";
import { t } from "../i18n/translate";

interface Props {
  stats: ObjectStats | null;
  error?: string | null;
}

export function ObjectStatsCard({ stats, error }: Props) {
  if (error) {
    return <div className="stats-card error">{error}</div>;
  }
  if (!stats) {
    return <div className="stats-card loading">{t("Loading stats…")}</div>;
  }
  const rows = stats.kind === "signal" ? signalRows(stats) : imageRows(stats);
  return (
    <section className="stats-card" aria-label={t("Object statistics")}>
      <h3 className="stats-card-title">{t("Statistics")}</h3>
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
    [t("Points"), String(s.n_points)],
    [t("X dtype"), s.x_dtype],
    [t("Y dtype"), s.y_dtype],
    [t("X min"), fmt(s.x_min)],
    [t("X max"), fmt(s.x_max)],
    [t("Y min"), fmt(s.y_min)],
    [t("Y max"), fmt(s.y_max)],
    [t("Y mean"), fmt(s.y_mean)],
    [t("Y std"), fmt(s.y_std)],
    [t("Y median"), fmt(s.y_median)],
  ];
}

function imageRows(
  s: Extract<ObjectStats, { kind: "image" }>,
): [string, string][] {
  return [
    [t("Shape"), `${s.shape.join(" × ")}`],
    [t("dtype"), s.dtype],
    [t("Min"), fmt(s.min)],
    [t("Max"), fmt(s.max)],
    [t("Mean"), fmt(s.mean)],
    [t("Std"), fmt(s.std)],
    [t("Median"), fmt(s.median)],
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
