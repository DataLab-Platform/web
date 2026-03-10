import { useState } from "react";
import type { ObjectNode, PanelTree } from "../sigima/runtime";

interface Props {
  title: string;
  operandLabel: string;
  tree: PanelTree | null;
  excludeIds: string[];
  onSubmit: (operandId: string) => void;
  onCancel: () => void;
}

/**
 * Modal dialog for picking the second operand of a 2_to_1 feature.
 *
 * Lists all candidate objects (flat, with their group prefix) excluding
 * the current sources to avoid trivial self-operations.
 */
export function OperandPicker(props: Props) {
  const { title, operandLabel, tree, excludeIds, onSubmit, onCancel } = props;
  const candidates: { gname: string; obj: ObjectNode }[] = [];
  if (tree) {
    for (const g of tree.groups) {
      for (const o of g.objects) {
        if (!excludeIds.includes(o.id)) {
          candidates.push({ gname: g.name, obj: o });
        }
      }
    }
  }
  const [selected, setSelected] = useState<string | null>(
    candidates[0]?.obj.id ?? null,
  );

  return (
    <div className="overlay">
      <div className="card">
        <h2>{title}</h2>
        <p className="dataset-dialog-desc">{operandLabel}</p>
        {candidates.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
            No candidate operand available.
          </div>
        ) : (
          <select
            size={Math.min(8, candidates.length)}
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value)}
            style={{ width: "100%" }}
          >
            {candidates.map(({ gname, obj }) => (
              <option key={obj.id} value={obj.id}>
                [{gname}] {obj.title} (#{obj.id})
              </option>
            ))}
          </select>
        )}
        <div className="actions">
          <button onClick={onCancel}>Cancel</button>
          <button
            onClick={() => selected && onSubmit(selected)}
            disabled={!selected}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
