import { useState } from "react";
import type { SignalCreationParams } from "../sigima/runtime";

interface Props {
  onCreate: (params: SignalCreationParams) => void | Promise<void>;
  onCancel: () => void;
}

const KINDS: Array<{ value: SignalCreationParams["kind"]; label: string }> = [
  { value: "sine", label: "Sine" },
  { value: "cosine", label: "Cosine" },
  { value: "gauss", label: "Gaussian" },
  { value: "noise", label: "Noise (normal)" },
];

export function NewSignalDialog({ onCreate, onCancel }: Props) {
  const [kind, setKind] = useState<SignalCreationParams["kind"]>("sine");
  const [title, setTitle] = useState("Signal");
  const [size, setSize] = useState(1024);
  const [xmin, setXmin] = useState(0);
  const [xmax, setXmax] = useState(10);
  const [a, setA] = useState(1);
  const [freq, setFreq] = useState(1);
  const [phase, setPhase] = useState(0);
  const [mu, setMu] = useState(5);
  const [sigma, setSigma] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onCreate({
        kind,
        title: title || "Signal",
        size,
        xmin,
        xmax,
        a,
        freq,
        phase,
        mu,
        sigma,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card">
        <h2>New signal</h2>
        <div className="row">
          <label>Kind</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as SignalCreationParams["kind"])}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
          <label>Size</label>
          <input
            type="number"
            min={2}
            value={size}
            onChange={(e) => setSize(parseInt(e.target.value, 10) || 0)}
          />
          <label>X min</label>
          <input
            type="number"
            value={xmin}
            onChange={(e) => setXmin(parseFloat(e.target.value) || 0)}
          />
          <label>X max</label>
          <input
            type="number"
            value={xmax}
            onChange={(e) => setXmax(parseFloat(e.target.value) || 0)}
          />
          {(kind === "sine" || kind === "cosine" || kind === "gauss" || kind === "noise") && (
            <>
              <label>Amplitude</label>
              <input
                type="number"
                value={a}
                onChange={(e) => setA(parseFloat(e.target.value) || 0)}
              />
            </>
          )}
          {(kind === "sine" || kind === "cosine") && (
            <>
              <label>Frequency</label>
              <input
                type="number"
                value={freq}
                onChange={(e) => setFreq(parseFloat(e.target.value) || 0)}
              />
              <label>Phase (rad)</label>
              <input
                type="number"
                value={phase}
                onChange={(e) => setPhase(parseFloat(e.target.value) || 0)}
              />
            </>
          )}
          {kind === "gauss" && (
            <>
              <label>Mean (µ)</label>
              <input
                type="number"
                value={mu}
                onChange={(e) => setMu(parseFloat(e.target.value) || 0)}
              />
              <label>Std dev (σ)</label>
              <input
                type="number"
                value={sigma}
                onChange={(e) => setSigma(parseFloat(e.target.value) || 0)}
              />
            </>
          )}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
