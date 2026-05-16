/**
 * ConversationsDialog — browse, load and delete persisted AI Assistant
 * conversations. Mirrors
 * :mod:`DataLab/datalab/aiassistant/widgets/conversationsdialog.py`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteConversation,
  listConversations,
  loadConversation,
  renameConversation,
  type ConversationInfo,
} from "../../aiassistant/conversationStore";
import {
  conversationToMarkdown,
  downloadMarkdown,
  sanitizeFilename,
} from "../../aiassistant/conversationExport";

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
  /** ID of the row currently in inline-rename mode (``null`` = none). */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Current draft of the row being renamed. */
  const [editingDraft, setEditingDraft] = useState("");
  const editingInputRef = useRef<HTMLInputElement | null>(null);

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

  // Escape closes the dialog — unless we're editing a row, in which
  // case Escape just cancels the inline rename.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && editingId === null) onClose(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, editingId]);

  /** Enter inline-rename mode for *info*. Auto-selects the text so the
   *  user can either overwrite or fine-tune. */
  const startRename = useCallback((info: ConversationInfo) => {
    setEditingId(info.id);
    setEditingDraft(info.title || "");
  }, []);

  // Focus + select the input when editing starts.
  useEffect(() => {
    if (!editingId) return;
    const el = editingInputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [editingId]);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditingDraft("");
  }, []);

  const commitRename = useCallback(async () => {
    if (!editingId) return;
    const trimmed = editingDraft.trim();
    const original = items.find((i) => i.id === editingId)?.title ?? "";
    if (trimmed && trimmed !== original) {
      await renameConversation(editingId, trimmed);
      setItems((prev) =>
        prev.map((i) => (i.id === editingId ? { ...i, title: trimmed } : i)),
      );
    }
    cancelRename();
  }, [cancelRename, editingDraft, editingId, items]);

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

  /** Export the selected conversation as a Markdown file download. */
  const handleExport = async () => {
    if (!selectedId) return;
    const conv = await loadConversation(selectedId);
    if (!conv) return;
    const content = conversationToMarkdown(conv);
    const stamp = new Date(conv.updatedAt || Date.now())
      .toISOString()
      .slice(0, 10);
    const base = sanitizeFilename(conv.title || "conversation");
    downloadMarkdown(`${stamp}-${base}.md`, content);
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
          Double-click a conversation to load it. Loading replaces the current
          one (it stays saved).
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
            const isEditing = info.id === editingId;
            return (
              <div
                key={info.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!isEditing) setSelectedId(info.id);
                }}
                onDoubleClick={() => {
                  if (!isEditing) onClose(info.id);
                }}
                onKeyDown={(e) => {
                  if (isEditing) return;
                  if (e.key === "Enter") onClose(info.id);
                  else if (e.key === "F2") {
                    e.preventDefault();
                    startRename(info);
                  }
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
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {isEditing ? (
                    <input
                      ref={editingInputRef}
                      type="text"
                      value={editingDraft}
                      onChange={(e) => setEditingDraft(e.target.value)}
                      onBlur={() => void commitRename()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitRename();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelRename();
                        }
                        // Stop propagation so the row's keydown (which
                        // would treat Enter as "load") doesn't fire.
                        e.stopPropagation();
                      }}
                      style={{
                        width: "100%",
                        font: "inherit",
                        boxSizing: "border-box",
                      }}
                      data-testid="ai-history-rename-input"
                    />
                  ) : (
                    <strong>{info.title || "(untitled)"}</strong>
                  )}
                  {!isEditing && isActive && (
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
          <button type="button" onClick={handleDelete} disabled={!selectedId}>
            Delete
          </button>
          <button
            type="button"
            onClick={() => {
              const info = items.find((i) => i.id === selectedId);
              if (info) startRename(info);
            }}
            disabled={!selectedId || editingId !== null}
            title="Rename the selected conversation (F2)"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={!selectedId || editingId !== null}
            title="Download the selected conversation as Markdown"
          >
            Export…
          </button>
          <button type="button" onClick={() => void refresh()} disabled={busy}>
            Refresh
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => onClose(null)}>
            Close
          </button>
          <button type="button" onClick={handleLoad} disabled={!selectedId}>
            Load
          </button>
        </div>
      </div>
    </div>
  );
}
