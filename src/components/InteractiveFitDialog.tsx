/**
 * Modal dialog wrapping an interactive curve fit.
 *
 * Mirrors DataLab desktop's ``plotpy.widgets.fit.FitDialog``:
 *  * One slider + spin-box per fit parameter.
 *  * "Auto fit" button → ``scipy.optimize.curve_fit``.
 *  * Live overlay of the fitted curve on top of the source signal.
 *  * "OK" commits the curve as a new signal in the active panel.
 *
 * Heavy lifting (initial estimates, bounds, evaluation, optimisation) is
 * delegated to :mod:`dlw_interactive_fit` on the Python side.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Plot from "react-plotly.js";
import type {
  InteractiveFitInfo,
  InteractiveFitInit,
  InteractiveFitParam,
} from "../runtime/runtime";
import { useSigima } from "../runtime/SigimaContext";

interface Props {
  oid: string;
  fit: InteractiveFitInfo;
  onCommit: (newOid: string) => void;
  onCancel: () => void;
}

/** A single parameter row: label, slider, spin-box. */
function ParamRow(props: {
  param: InteractiveFitParam;
  onChange: (value: number) => void;
}) {
  const { param, onChange } = props;
  const span = param.max - param.min;
  // Resolution of the slider — 1000 steps gives sub-pixel granularity at
  // typical screen widths and avoids jagged updates while dragging.
  const STEPS = 1000;
  const step = span > 0 ? span / STEPS : 1;
  return (
    <div className="ifit-param-row">
      <span className="ifit-param-label">{param.label}</span>
      <span className="ifit-param-min">{param.min.toPrecision(4)}</span>
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={step}
        value={param.value}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
        className="ifit-param-slider"
      />
      <span className="ifit-param-max">{param.max.toPrecision(4)}</span>
      <input
        type="number"
        value={param.value}
        step={step}
        onChange={(e) => {
          const v = Number.parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="ifit-param-input"
      />
    </div>
  );
}

export function InteractiveFitDialog(props: Props) {
  const { oid, fit, onCommit, onCancel } = props;
  const { runtime } = useSigima();
  const [degree, setDegree] = useState<number>(3);
  const [init, setInit] = useState<InteractiveFitInit | null>(null);
  const [params, setParams] = useState<InteractiveFitParam[]>([]);
  const [yFit, setYFit] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Debounce token: cancels in-flight evaluate calls that slider drags
  // make obsolete before they return.
  const evalToken = useRef(0);

  const extras = useCallback(
    (): Record<string, unknown> | null =>
      fit.needs_degree ? { degree } : null,
    [fit.needs_degree, degree],
  );

  // ---- Initial load + degree changes ---------------------------------
  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    runtime
      .initInteractiveFit(oid, fit.id, extras())
      .then((data) => {
        if (cancelled) return;
        setInit(data);
        setParams(data.params);
        setYFit(data.y_fit);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, oid, fit.id, extras]);

  // ---- Re-evaluate the model when any parameter changes --------------
  const reevaluate = useCallback(
    async (next: InteractiveFitParam[]) => {
      if (!runtime || !init) return;
      const token = ++evalToken.current;
      const values: Record<string, number> = {};
      for (const p of next) values[p.name] = p.value;
      try {
        const newY = await runtime.evaluateInteractiveFit(
          fit.id,
          init.x,
          values,
          extras(),
        );
        if (token === evalToken.current) setYFit(newY);
      } catch (err) {
        if (token === evalToken.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [runtime, init, fit.id, extras],
  );

  const handleParamChange = (idx: number, value: number) => {
    setParams((prev) => {
      const next = prev.slice();
      next[idx] = { ...next[idx], value };
      void reevaluate(next);
      return next;
    });
  };

  const handleAutoFit = async () => {
    if (!runtime || !init) return;
    setBusy(true);
    setError(null);
    try {
      const result = await runtime.autoFitInteractive(oid, fit.id, extras());
      setParams((prev) =>
        prev.map((p) => {
          const v = result.values[p.name];
          if (v === undefined) return p;
          // Expand bounds if the optimiser pushed past them, so the
          // slider keeps the value reachable.
          let { min, max } = p;
          if (v < min) min = v;
          if (v > max) max = v;
          return { ...p, value: v, min, max };
        }),
      );
      setYFit(result.y_fit);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleOk = async () => {
    if (!runtime || !init) return;
    setBusy(true);
    setError(null);
    try {
      const values: Record<string, number> = {};
      for (const p of params) values[p.name] = p.value;
      const newOid = await runtime.commitInteractiveFit(
        oid,
        fit.id,
        values,
        extras(),
      );
      onCommit(newOid);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card ifit-dialog">
        <h2>{fit.label}</h2>
        <div className="ifit-body">
          <div className="ifit-plot">
            {init ? (
              <Plot
                data={[
                  {
                    x: init.x,
                    y: init.y,
                    type: "scatter",
                    mode: "lines+markers",
                    name: "Source",
                    marker: { size: 3, color: "#7aa6da" },
                    line: { color: "#7aa6da", width: 1 },
                  },
                  {
                    x: init.x,
                    y: yFit,
                    type: "scatter",
                    mode: "lines",
                    name: "Fit",
                    line: { color: "#e07b00", width: 2 },
                  },
                ]}
                layout={{
                  autosize: true,
                  margin: { l: 50, r: 20, t: 10, b: 40 },
                  showlegend: true,
                  legend: { orientation: "h", y: -0.18 },
                  paper_bgcolor: "transparent",
                  plot_bgcolor: "transparent",
                  font: { color: "var(--text)" as unknown as string },
                  xaxis: { gridcolor: "rgba(128,128,128,0.2)" },
                  yaxis: { gridcolor: "rgba(128,128,128,0.2)" },
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%", height: "100%" }}
                useResizeHandler
              />
            ) : (
              <div className="ifit-placeholder">Loading…</div>
            )}
          </div>
          <div className="ifit-params">
            {fit.needs_degree && (
              <div className="ifit-param-row ifit-degree-row">
                <span className="ifit-param-label">Degree</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={degree}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(v) && v >= 1 && v <= 10) setDegree(v);
                  }}
                  className="ifit-param-input"
                />
                <span className="ifit-degree-hint">
                  Changing the degree resets the parameters.
                </span>
              </div>
            )}
            {params.map((p, idx) => (
              <ParamRow
                key={p.name}
                param={p}
                onChange={(v) => handleParamChange(idx, v)}
              />
            ))}
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button onClick={handleAutoFit} disabled={busy || !init}>
            Auto fit
          </button>
          <button onClick={handleOk} disabled={busy || !init}>
            {busy ? "Working…" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
