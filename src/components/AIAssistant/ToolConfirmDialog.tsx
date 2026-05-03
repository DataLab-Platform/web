/**
 * ToolConfirmDialog — modal asking the user to approve a mutating tool
 * call requested by the LLM.
 *
 * Mirrors :mod:`DataLab/datalab/aiassistant/widgets/toolconfirmdialog.py`.
 * The "Auto-approve in this conversation" option is checked off by
 * default — the user must opt in per turn.
 */

import { useEffect, useState } from "react";
import type { Tool } from "../../aiassistant/types";

export interface ToolConfirmRequest {
  tool: Tool;
  args: Record<string, unknown>;
  resolve: (decision: { approve: boolean; remember: boolean }) => void;
}

interface Props {
  request: ToolConfirmRequest;
}

export function ToolConfirmDialog({ request }: Props) {
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        request.resolve({ approve: false, remember: false });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [request]);

  const argsText = JSON.stringify(request.args, null, 2);
  const handleApprove = () =>
    request.resolve({ approve: true, remember });
  const handleReject = () =>
    request.resolve({ approve: false, remember: false });

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-tool-confirm-title"
      onClick={handleReject}
    >
      <div
        className="card ai-tool-confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 520, maxWidth: "90vw" }}
      >
        <h2 id="ai-tool-confirm-title">Approve tool call?</h2>
        <p style={{ fontSize: 13 }}>
          The assistant wants to run the following mutating tool. Review
          the arguments and approve or reject.
        </p>
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: 8,
            marginBottom: 8,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {request.tool.name}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              marginBottom: 6,
            }}
          >
            {request.tool.description}
          </div>
          <pre
            style={{
              margin: 0,
              fontSize: 12,
              maxHeight: 240,
              overflow: "auto",
              background: "var(--bg)",
              padding: 8,
              borderRadius: 4,
            }}
          >
            {argsText}
          </pre>
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
          }}
        >
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Auto-approve <code>{request.tool.name}</code> for the rest of
          this conversation
        </label>
        <div className="actions" style={{ marginTop: 14 }}>
          <button type="button" onClick={handleReject}>
            Reject
          </button>
          <button type="button" onClick={handleApprove}>
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
