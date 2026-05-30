/**
 * ToolConfirmDialog — modal asking the user to approve a mutating tool
 * call requested by the LLM.
 *
 * Mirrors :mod:`DataLab/datalab/aiassistant/widgets/toolconfirmdialog.py`.
 * The "Auto-approve in this conversation" option is checked off by
 * default — the user must opt in per turn.
 */

import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import type { Tool } from "../../aiassistant/types";
import { useTheme } from "../../utils/theme";
import { t } from "../../i18n/translate";

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

  // Multi-line string arguments (e.g. ``code`` for ``create_and_run_macro``)
  // are unreadable when JSON-encoded — newlines collapse to a literal
  // ``\n`` and the whole script ends up on a single line. Surface every
  // such argument as its own pre-formatted block, and render the rest
  // as a compact JSON object so the user actually sees what will run.
  const longStringArgs: Array<[string, string]> = [];
  const compactArgs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request.args)) {
    if (
      typeof value === "string" &&
      (value.includes("\n") || value.length > 80)
    ) {
      longStringArgs.push([key, value]);
    } else {
      compactArgs[key] = value;
    }
  }
  const hasCompactArgs = Object.keys(compactArgs).length > 0;
  const compactArgsText = JSON.stringify(compactArgs, null, 2);
  const handleApprove = () => request.resolve({ approve: true, remember });
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
        <h2 id="ai-tool-confirm-title">{t("Approve tool call?")}</h2>
        <p style={{ fontSize: 13 }}>
          {t(
            "The assistant wants to run the following mutating tool. Review the arguments and approve or reject.",
          )}
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
              whiteSpace: "pre",
              display: hasCompactArgs ? "block" : "none",
            }}
          >
            {compactArgsText}
          </pre>
          {longStringArgs.map(([name, value]) => (
            <div key={name} style={{ marginTop: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-dim)",
                  marginBottom: 2,
                }}
              >
                <code>{name}</code>:
              </div>
              {name === "code" ? (
                <PythonCodeViewer code={value} />
              ) : (
                <pre
                  style={{
                    margin: 0,
                    fontSize: 12,
                    maxHeight: 320,
                    overflow: "auto",
                    background: "var(--bg)",
                    padding: 8,
                    borderRadius: 4,
                    whiteSpace: "pre",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                >
                  {value}
                </pre>
              )}
            </div>
          ))}
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
          {t("Auto-approve")} <code>{request.tool.name}</code>{" "}
          {t("for the rest of this conversation")}
        </label>
        <div className="actions" style={{ marginTop: 14 }}>
          <button type="button" onClick={handleReject}>
            {t("Reject")}
          </button>
          <button type="button" onClick={handleApprove}>
            {t("Approve")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Read-only CodeMirror viewer with Python syntax highlighting. */
function PythonCodeViewer({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const state = EditorState.create({
      doc: code,
      extensions: [
        lineNumbers(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        python(),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.theme({
          "&": { fontSize: "12px", maxHeight: "320px" },
          ".cm-scroller": { overflow: "auto" },
        }),
        ...(theme === "dark" ? [oneDark] : []),
      ],
    });
    const view = new EditorView({ state, parent: container });
    return () => view.destroy();
  }, [code, theme]);

  return (
    <div
      ref={containerRef}
      style={{
        border: "1px solid var(--border)",
        borderRadius: 4,
        overflow: "hidden",
      }}
    />
  );
}
