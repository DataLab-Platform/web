import type { SignalMeta } from "../sigima/runtime";

interface Props {
  signals: SignalMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SignalList({ signals, selectedId, onSelect }: Props) {
  if (signals.length === 0) {
    return (
      <div style={{ padding: 10, color: "var(--text-dim)", fontSize: 12 }}>
        No signals yet.
      </div>
    );
  }
  return (
    <ul className="signal-list">
      {signals.map((s) => (
        <li
          key={s.id}
          className={s.id === selectedId ? "selected" : ""}
          onClick={() => onSelect(s.id)}
        >
          <div>{s.title}</div>
          <div className="meta">
            #{s.id} · {s.size} pts
          </div>
        </li>
      ))}
    </ul>
  );
}
