/**
 * ConversationsDialog — browse, load and delete persisted AI Assistant
 * conversations. Mirrors
 * :mod:`DataLab/datalab/aiassistant/widgets/conversationsdialog.py`.
 */

import { useCallback, useEffect, useState } from "react";
import {
  deleteConversation,
  listConversations,
  type ConversationInfo,
} from "../../aiassistant/conversationStore";

interface Props {
  /** Called with the selected conversation id (or ``null`` to dismiss). */
  onClose: (selectedId: string | null) => void;
  /** Currently-active conversation id, highlighted in the list. */
  activeId?: string | null;
}

function formatDate(epochMs: number): string {
  if (!epochMs) return "";
  try {
    return new Date(epochMs).toLocaleString();
  } catch {
    return "";
  }
}

export function ConversationsDialog({ onClose, activeId = null }: Props) {
  const [items, setItems] = useState<ConversationInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(activeId);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const list = await listConversations();
      setItems(list);
      if (selectedId && !list.some((c) => c.id === selectedId)) {
        setSelectedId(null);
      }
    } finally {
      setBusy(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Escape closes the dialog.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleLoad = () => {
    if (!selectedId) return;
    onClose(selectedId);
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Delete the selected conversation? This cannot be undone.",
      )
    ) {
      return;
    }
    await deleteConversation(selectedId);
    await refresh();
  };

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-history-title"
      onClick={() => onClose(null)}
    >
      <div
        className="card ai-history-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 640, maxWidth: "92vw" }}
      >
        <h2 id="ai-history-title">AI Assistant — Conversation history</h2>
        <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 0 }}>
          Double-click a conversation to load it. Loading replaces the
          current one (it stays saved).
        </p>
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 4,
            maxHeight: 360,
            overflowY: "auto",
            background: "var(--bg)",
          }}
          data-testid="ai-history-list"
        >
          {items.length === 0 && !busy && (
            <div
              style={{
                padding: 12,
                color: "var(--text-dim)",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              No saved conversations yet.
            </div>
          )}
          {items.map((info) => {
            const isActive = info.id === activeId;
            const isSelected = info.id === selectedId;
            return (
              <div
                key={info.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(info.id)}
                onDoubleClick={() => onClose(info.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onClose(info.id);
                }}
                title={`Created: ${formatDate(info.createdAt)}\nUpdated: ${formatDate(info.updatedAt)}\nMessages: ${info.messageCount}`}
                style={{
                  padding: "6px 8px",
                  borderBottom: "1px solid var(--border)",
                  background: isSelected
                    ? "var(--accent-soft, rgba(45,127,249,0.15))"
                    : "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  fontSize: 13,
                }}
              >
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                  <strong>{info.title || "(untitled)"}</strong>
                  {isActive && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 11,
                        color: "var(--text-dim)",
                      }}
                    >
                      (current)
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {info.messageCount} msg · {formatDate(info.updatedAt)}
                </span>
              </div>
            );
          })}
        </div>
        <div
          className="actions"
          style={{ marginTop: 12, display: "flex", gap: 6 }}
        >
          <button
            type="button"
            onClick={handleDelete}
            disabled={!selectedId}
          >
            Delete
          </button>
          <button type="button" onClick={() => void refresh()} disabled={busy}>
            Refresh
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => onClose(null)}>
            Close
          </button>
          <button
            type="button"
            onClick={handleLoad}
            disabled={!selectedId}
          >
            Load
          </button>
        </div>
      </div>
    </div>
  );
}
