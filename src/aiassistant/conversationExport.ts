/**
 * Markdown export for AI Assistant conversations.
 *
 * Renders a :type:`Conversation` to a self-contained Markdown document
 * suitable for sharing or pasting into a notebook. Uses fenced JSON
 * blocks for tool calls / results so the round-trip stays unambiguous.
 *
 * Cross-reference: :mod:`DataLab/datalab/aiassistant/utils/markdown.py`
 * (desktop equivalent).
 */

import type { Conversation } from "./conversationStore";
import type { ChatMessage, ToolCall } from "./types";

/** Format an ISO-8601 timestamp from an epoch millisecond value. */
function isoStamp(ms: number): string {
  if (!ms) return "";
  try {
    return new Date(ms).toISOString();
  } catch {
    return "";
  }
}

/** Try to pretty-print a JSON-ish blob; falls back to the raw string. */
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Serialise an ``assistant.tool_calls`` array as fenced JSON. */
function renderToolCalls(toolCalls: ToolCall[]): string {
  const compact = toolCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: (() => {
      try {
        return JSON.parse(tc.function.arguments) as unknown;
      } catch {
        return tc.function.arguments;
      }
    })(),
  }));
  return "```json\n" + JSON.stringify(compact, null, 2) + "\n```";
}

/** Render a single :type:`ChatMessage` as a Markdown section. */
function renderMessage(msg: ChatMessage): string {
  if (msg.role === "system") {
    // System prompt is intentionally omitted from exports — it's
    // generated at runtime and not interesting to a human reader.
    return "";
  }
  if (msg.role === "user") {
    const lines: string[] = ["## You", ""];
    if (typeof msg.content === "string") {
      lines.push(msg.content);
    } else {
      for (const part of msg.content) {
        if (part.type === "text") {
          lines.push(part.text);
        } else if (part.type === "image_url") {
          lines.push("> _(image attached)_");
        }
      }
    }
    return lines.join("\n");
  }
  if (msg.role === "assistant") {
    const lines: string[] = ["## Assistant", ""];
    if (msg.content) {
      lines.push(msg.content);
    }
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      if (msg.content) lines.push("");
      lines.push("**Tool calls:**", "", renderToolCalls(msg.tool_calls));
    }
    return lines.join("\n");
  }
  // Tool result.
  return [
    `## Tool result (${msg.name})`,
    "",
    "```json",
    prettyJson(msg.content),
    "```",
  ].join("\n");
}

/** Render *conv* as a self-contained Markdown document. */
export function conversationToMarkdown(conv: Conversation): string {
  const sections: string[] = [];
  sections.push(`# ${conv.title || "(untitled conversation)"}`);
  const meta: string[] = [];
  if (conv.createdAt) meta.push(`Created: ${isoStamp(conv.createdAt)}`);
  if (conv.updatedAt) meta.push(`Updated: ${isoStamp(conv.updatedAt)}`);
  if (conv.usage?.totalTokens) {
    meta.push(`Tokens: ${conv.usage.totalTokens}`);
  }
  if (meta.length > 0) {
    sections.push(`_${meta.join(" \u2022 ")}_`);
  }
  for (const msg of conv.messages) {
    const rendered = renderMessage(msg);
    if (rendered) sections.push(rendered);
  }
  return sections.join("\n\n") + "\n";
}

/** Strip filesystem-unsafe characters and clamp the length so the
 *  result is a valid filename on Windows / macOS / Linux. */
export function sanitizeFilename(name: string, maxLen = 80): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- intentional: strip ASCII control chars from filenames
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "conversation";
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen).trim() : cleaned;
}

/** Trigger a browser download of *content* under *filename*. Uses the
 *  ``<a download>`` pattern so it works without a server round-trip.
 *  Safe in test environments: no-ops when ``URL.createObjectURL`` is
 *  missing (jsdom) but still calls the spy if one is installed. */
export function downloadMarkdown(filename: string, content: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  if (typeof URL.createObjectURL !== "function") return;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    if (typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(url);
    }
  }
}
