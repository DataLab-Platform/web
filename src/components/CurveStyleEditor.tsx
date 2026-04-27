/**
 * CurveStyleEditor — small inline editor for a signal's render style
 * (color / dash / width / curvestyle).
 *
 * Mirrors PlotPy's per-curve attributes used by DataLab desktop's
 * "Curve properties" dialog.  Values round-trip through the signal's
 * metadata (``color`` / ``linestyle`` / ``linewidth`` / ``curvestyle``)
 * which :class:`SignalPlot` already honours when rendering.
 *
 * Empty / unset values mean "fall back to the auto-cycling palette".
 */

import { useEffect, useState } from "react";
import type { DataLabRuntime, SignalStyle } from "../runtime/runtime";

interface Props {
  runtime: DataLabRuntime;
  oid: string;
  /** Bumped by the parent whenever the underlying object changed; used
   *  to refetch the persisted style. */
  refreshNonce: number;
  /** Notifies the parent that the style was applied so it can refresh
   *  the plot. */
  onApplied: () => void;
}

const LINESTYLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "(default)" },
  { value: "SolidLine", label: "Solid" },
  { value: "DashLine", label: "Dash" },
  { value: "DotLine", label: "Dot" },
  { value: "DashDotLine", label: "Dash-dot" },
  { value: "DashDotDotLine", label: "Dash-dot-dot" },
];

const CURVESTYLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "(default)" },
  { value: "Lines", label: "Lines" },
  { value: "Sticks", label: "Sticks" },
  { value: "Steps", label: "Steps" },
  { value: "Dots", label: "Dots" },
  { value: "NoCurve", label: "No curve" },
];

export function CurveStyleEditor({
  runtime,
  oid,
  refreshNonce,
  onApplied,
}: Props) {
  const [color, setColor] = useState<string>("");
  const [linestyle, setLinestyle] = useState<string>("");
  const [linewidth, setLinewidth] = useState<string>("");
  const [curvestyle, setCurvestyle] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load the current style from the signal's metadata.  We rely on the
  // existing ``getSignalsData`` batched helper, which already returns
  // the parsed ``style`` block.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    runtime
      .getSignalsData([oid])
      .then((items) => {
        if (cancelled || items.length === 0) return;
        const s: SignalStyle | undefined = items[0].style;
        setColor(s?.color ?? "");
        setLinestyle(s?.linestyle ?? "");
        setLinewidth(
          s?.linewidth !== null && s?.linewidth !== undefined
            ? String(s.linewidth)
            : "",
        );
        setCurvestyle(s?.curvestyle ?? "");
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, oid, refreshNonce]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const widthValue =
        linewidth.trim() === "" ? null : Number(linewidth.trim());
      if (widthValue !== null && (Number.isNaN(widthValue) || widthValue <= 0))
        throw new Error("Line width must be a positive number.");
      await runtime.setSignalStyle(oid, {
        color: color || null,
        linestyle: linestyle || null,
        linewidth: widthValue,
        curvestyle: curvestyle || null,
      });
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await runtime.setSignalStyle(oid, {
        color: null,
        linestyle: null,
        linewidth: null,
        curvestyle: null,
      });
      setColor("");
      setLinestyle("");
      setLinewidth("");
      setCurvestyle("");
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="curve-style-editor">
      <legend>Curve style</legend>
      <div className="curve-style-grid">
        <label>
          <span>Color</span>
          <span className="curve-style-color">
            <input
              type="color"
              value={color || "#1f77b4"}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Curve color"
            />
            <input
              type="text"
              value={color}
              placeholder="(default)"
              onChange={(e) => setColor(e.target.value)}
              spellCheck={false}
              aria-label="Curve color hex value"
            />
          </span>
        </label>
        <label>
          <span>Line style</span>
          <select
            value={linestyle}
            onChange={(e) => setLinestyle(e.target.value)}
          >
            {LINESTYLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Line width</span>
          <input
            type="number"
            value={linewidth}
            placeholder="(default)"
            min={0.1}
            step={0.5}
            onChange={(e) => setLinewidth(e.target.value)}
          />
        </label>
        <label>
          <span>Curve style</span>
          <select
            value={curvestyle}
            onChange={(e) => setCurvestyle(e.target.value)}
          >
            {CURVESTYLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="curve-style-actions">
        <button type="button" onClick={apply} disabled={busy}>
          Apply
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          title="Clear all overrides and fall back to the auto-cycling palette"
        >
          Reset
        </button>
      </div>
    </fieldset>
  );
}
