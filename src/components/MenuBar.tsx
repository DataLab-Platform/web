import type { ProcessingDescriptor } from "../sigima/runtime";
import logoUrl from "../assets/DataLab.svg";

interface Props {
  status: string;
  statusKind: "loading" | "ready" | "error";
  canAct: boolean;
  canDelete: boolean;
  canProcess: boolean;
  processings: ProcessingDescriptor[];
  onNewSignal: () => void;
  onDeleteSignal: () => void;
  onApplyProcessing: (processingId: string) => void;
}

export function MenuBar(props: Props) {
  const {
    status,
    statusKind,
    canAct,
    canDelete,
    canProcess,
    processings,
    onNewSignal,
    onDeleteSignal,
    onApplyProcessing,
  } = props;

  const onSelectProcessing = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value) {
      onApplyProcessing(value);
      e.target.value = "";
    }
  };

  return (
    <div className="menubar">
      <div className="menubar-brand">
        <img
          className="menubar-logo"
          src={logoUrl}
          alt=""
          aria-hidden="true"
        />
        <h1>DataLab Web</h1>
      </div>
      <button onClick={onNewSignal} disabled={!canAct}>
        New signal…
      </button>
      <select
        onChange={onSelectProcessing}
        disabled={!canAct || !canProcess}
        defaultValue=""
        title="Apply processing to selected signal"
      >
        <option value="" disabled>
          Processing…
        </option>
        {processings.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <button onClick={onDeleteSignal} disabled={!canAct || !canDelete}>
        Delete
      </button>
      <span className="spacer" />
      <span
        className="status"
        style={{ color: statusKind === "error" ? "#f48771" : undefined }}
      >
        {status}
      </span>
    </div>
  );
}
