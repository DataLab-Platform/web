/**
 * AIAssistantPanel — chat panel mounted on the right side of the
 * workspace.
 *
 * Owns its own :class:`AIController`, transcript state, pending tool
 * confirmation state and settings dialog visibility. Mirrors the
 * UX of :mod:`DataLab/datalab/aiassistant/widgets/chatpanel.py`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataLabRuntime } from "../../runtime/runtime";
import { AIController } from "../../aiassistant/controller";
import {
  fetchDevOpenAIKey,
  isConfigured,
  loadSettings,
  saveSettings,
} from "../../aiassistant/settings";
import { SYSTEM_PROMPT } from "../../aiassistant/systemPrompt";
import { BUILTIN_TOOLS } from "../../aiassistant/tools";
import type {
  ChatMessage,
  ProviderSettings,
  Tool,
  ToolCall,
  ToolResult,
} from "../../aiassistant/types";
import { AISettingsDialog } from "./AISettingsDialog";
import { MarkdownView } from "./MarkdownView";
import {
  ToolConfirmDialog,
  type ToolConfirmRequest,
} from "./ToolConfirmDialog";

interface Props {
  runtime: DataLabRuntime;
  /** Optional callback to collapse the panel into the floating pill. */
  onMinimize?: () => void;
  /** Optional callback to fully hide the panel (same as the View menu
   *  toggle). */
  onClose?: () => void;
}

interface TranscriptEntry {
  message: ChatMessage;
  /** Bumped to force a re-render when streaming-style updates happen
   *  (we don't stream in v1 so this is currently always 0, but keeps
   *  the door open). */
  rev?: number;
}

export function AIAssistantPanel({ runtime, onMinimize, onClose }: Props) {
  const [settings, setSettings] = useState<ProviderSettings>(() =>
    loadSettings(),
  );
  const [showSettings, setShowSettings] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [pendingConfirm, setPendingConfirm] =
    useState<ToolConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // Per-conversation auto-approve memory keyed by tool name.
  const autoApprovedRef = useRef<Set<string>>(new Set());
  // ``settings`` getter for the controller — wrapped through a ref so a
  // mid-conversation settings update is picked up by the next request
  // without rebuilding the controller.
  const settingsRef = useRef<ProviderSettings>(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Best-effort: when running under ``npm run dev`` and no key has been
  // saved yet, fetch the developer's ``OPENAI_API_KEY`` exposed by the
  // Vite dev plugin and persist it. The endpoint never ships in
  // production builds (registered under ``apply: "serve"``).
  useEffect(() => {
    if (settings.apiKey.trim()) return;
    let cancelled = false;
    void fetchDevOpenAIKey().then((devKey) => {
      if (cancelled || !devKey) return;
      setSettings((prev) => {
        if (prev.apiKey.trim()) return prev;
        const next = { ...prev, apiKey: devKey };
        saveSettings(next);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [settings.apiKey]);

  const confirmTool = useCallback(
    (tool: Tool, args: Record<string, unknown>): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        if (autoApprovedRef.current.has(tool.name)) {
          resolve(true);
          return;
        }
        setPendingConfirm({
          tool,
          args,
          resolve: ({ approve, remember }) => {
            if (approve && remember) {
              autoApprovedRef.current.add(tool.name);
            }
            setPendingConfirm(null);
            resolve(approve);
          },
        });
      }),
    [],
  );

  const controller = useMemo(
    () =>
      new AIController({
        runtime,
        tools: BUILTIN_TOOLS,
        systemPrompt: SYSTEM_PROMPT,
        getSettings: () => settingsRef.current,
        confirmTool,
        listener: {
          onMessageAppended: (message) => {
            // Skip the system prompt (controller seeds it on construction).
            if (message.role === "system") return;
            setTranscript((prev) => [...prev, { message }]);
          },
          onToolFinished: (call: ToolCall, result: ToolResult) => {
            // No-op: the matching ``role:"tool"`` message is appended by
            // the controller and handled in ``onMessageAppended``.
            void call;
            void result;
          },
        },
      }),
    [runtime, confirmTool],
  );

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript, busy, pendingConfirm]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (!isConfigured(settings)) {
      setErrorMessage(
        "Configure base URL and model in Settings before sending a message.",
      );
      return;
    }
    setErrorMessage(null);
    setInput("");
    setBusy(true);
    try {
      await controller.sendUserMessage(text);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, controller, input, settings]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleNewConversation = () => {
    if (busy) return;
    controller.reset();
    autoApprovedRef.current.clear();
    setTranscript([]);
    setErrorMessage(null);
  };

  return (
    <aside
      className="ai-panel panel"
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
      data-testid="ai-assistant-panel"
    >
      <div
        className="panel-header ai-panel-header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 8px",
        }}
      >
        <span style={{ flex: 1 }}>AI Assistant</span>
        <button
          type="button"
          className="ai-panel-button"
          onClick={handleNewConversation}
          disabled={busy || transcript.length === 0}
          title="Start a new conversation"
        >
          New
        </button>
        <button
          type="button"
          className="ai-panel-button"
          onClick={() => setShowSettings(true)}
          title="Provider settings"
        >
          Settings
        </button>
        {onMinimize && (
          <button
            type="button"
            className="ai-panel-button"
            onClick={onMinimize}
            title="Minimise to floating button"
            aria-label="Minimise AI Assistant"
          >
            {"\u2013"}
          </button>
        )}
        {onClose && (
          <button
            type="button"
            className="ai-panel-button"
            onClick={onClose}
            title="Hide AI Assistant"
            aria-label="Hide AI Assistant"
          >
            {"\u00d7"}
          </button>
        )}
      </div>
      <div
        className="ai-transcript"
        ref={transcriptRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 8,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minHeight: 0,
        }}
      >
        {transcript.length === 0 && !busy && (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              padding: 8,
              textAlign: "center",
            }}
          >
            Ask the assistant to inspect the workspace, list available
            processings, or apply one to the current selection. Mutating calls
            will require your approval.
          </div>
        )}
        {transcript.map((entry, idx) => (
          <TranscriptItem key={idx} entry={entry} />
        ))}
        {busy && (
          <div
            className="ai-bubble ai-bubble-status"
            style={{
              alignSelf: "flex-start",
              fontSize: 12,
              color: "var(--text-dim)",
              fontStyle: "italic",
            }}
          >
            Thinking…
          </div>
        )}
        {errorMessage && (
          <div
            className="ai-bubble ai-bubble-error"
            style={{
              border: "1px solid #c4302b",
              padding: 6,
              borderRadius: 4,
              color: "#c4302b",
              fontSize: 12,
            }}
          >
            {errorMessage}
          </div>
        )}
      </div>
      <div
        className="ai-input"
        style={{
          borderTop: "1px solid var(--border)",
          padding: 6,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          disabled={busy}
          placeholder="Ask the assistant… (Enter to send, Shift+Enter for newline)"
          aria-label="AI Assistant input"
          style={{
            width: "100%",
            resize: "vertical",
            fontFamily: "inherit",
            fontSize: 13,
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 6 }}>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={busy || !input.trim()}
          >
            Send
          </button>
        </div>
      </div>
      {showSettings && (
        <AISettingsDialog
          onClose={() => setShowSettings(false)}
          onSaved={(s) => setSettings(s)}
        />
      )}
      {pendingConfirm && <ToolConfirmDialog request={pendingConfirm} />}
    </aside>
  );
}

function TranscriptItem({ entry }: { entry: TranscriptEntry }) {
  const { message } = entry;
  if (message.role === "user") {
    return (
      <div
        className="ai-bubble ai-bubble-user"
        style={{
          alignSelf: "flex-end",
          background: "var(--accent, #2d7ff9)",
          color: "white",
          padding: "6px 10px",
          borderRadius: 8,
          maxWidth: "85%",
          whiteSpace: "pre-wrap",
          fontSize: 13,
        }}
      >
        {message.content}
      </div>
    );
  }
  if (message.role === "assistant") {
    return (
      <div
        className="ai-bubble ai-bubble-assistant"
        style={{
          alignSelf: "flex-start",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          padding: "6px 10px",
          borderRadius: 8,
          maxWidth: "95%",
          fontSize: 13,
        }}
      >
        {message.content && message.content.trim() ? (
          <MarkdownView text={message.content} />
        ) : null}
        {message.tool_calls && message.tool_calls.length > 0 && (
          <div
            style={{
              marginTop: message.content ? 4 : 0,
              fontSize: 11,
              color: "var(--text-dim)",
              fontStyle: "italic",
            }}
          >
            Calling: {message.tool_calls.map((c) => c.function.name).join(", ")}
          </div>
        )}
      </div>
    );
  }
  if (message.role === "tool") {
    let preview = message.content;
    try {
      const parsed = JSON.parse(message.content) as {
        ok?: boolean;
        result?: unknown;
        error?: string;
      };
      if (parsed.ok === false) {
        preview = `error: ${parsed.error ?? "unknown"}`;
      } else if (parsed.result !== undefined) {
        const compact = JSON.stringify(parsed.result);
        preview = compact.length > 160 ? compact.slice(0, 157) + "…" : compact;
      }
    } catch {
      // leave as-is
    }
    return (
      <div
        className="ai-bubble ai-bubble-tool"
        style={{
          alignSelf: "flex-start",
          background: "var(--bg)",
          border: "1px dashed var(--border)",
          padding: "4px 8px",
          borderRadius: 6,
          maxWidth: "95%",
          fontSize: 11,
          fontFamily: "monospace",
          color: "var(--text-dim)",
          wordBreak: "break-all",
        }}
      >
        <strong>{message.name}</strong> → {preview}
      </div>
    );
  }
  return null;
}
