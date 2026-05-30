/**
 * Convert a DataLab macro source file to a :type:`NotebookModel`.
 *
 * The macro body is split on Spyder/VS-Code-style cell separators:
 *   - ``# %%``                  → starts a code cell
 *   - ``# %% [markdown]``       → starts a markdown cell (lines that
 *     follow are stripped of their leading ``# `` so the text is
 *     restored to plain markdown)
 *
 * If the source contains **no** cell separator, a single code cell is
 * returned with the full body as source. This makes the conversion
 * round-trip-safe with :file:`notebookToMacro.ts`: the markers it
 * emits are detected and restored to their original cell types.
 *
 * The standard DataLab macro header (``# -*- coding: utf-8 -*-`` and
 * the ``"""DataLab Macro: ..."""`` block) is detected and stripped from
 * the body. When a title can be parsed from the header it overrides the
 * caller-supplied default.
 */

import {
  emptyCodeCell,
  emptyMarkdownCell,
  emptyNotebook,
  type CellModel,
  type NotebookModel,
} from "../notebook/types";
import { t } from "../i18n/translate";

const MARKDOWN_MARKER_RE = /^#\s*%%\s*\[markdown\]\s*$/i;
const CODE_MARKER_RE = /^#\s*%%(?!\s*\[)\s*.*$/;

/**
 * Strip the standard DataLab macro header and return ``{title, body}``.
 *
 * The header is recognised by the line ``DataLab Macro: "..."`` inside
 * a leading triple-quoted string. When found:
 *   - the title is extracted,
 *   - everything up to the closing ``"""`` (and the immediately
 *     following blank lines) is removed from ``body``.
 *
 * If no header is present, the source is returned verbatim and
 * ``title`` is ``null``.
 */
export function stripMacroHeader(source: string): {
  title: string | null;
  body: string;
} {
  const lines = source.split("\n");
  let title: string | null = null;
  let endIdx = -1;
  let inDocstring = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!inDocstring) {
      if (line.trim() === '"""') {
        inDocstring = true;
        continue;
      }
      // Allow shebang / coding declaration before the docstring.
      if (line.trim() === "" || line.startsWith("#")) {
        continue;
      }
      // Anything else means there is no recognisable header.
      break;
    }
    const m = line.match(/^DataLab Macro:\s*"(.*)"\s*$/);
    if (m) {
      title = m[1];
    }
    if (line.trim() === '"""') {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0) {
    return { title, body: source };
  }
  // Drop the header lines plus trailing blank lines.
  let cursor = endIdx + 1;
  while (cursor < lines.length && lines[cursor].trim() === "") {
    cursor += 1;
  }
  return { title, body: lines.slice(cursor).join("\n") };
}

/** Restore a markdown cell's source by stripping ``# `` prefixes. */
function unindentMarkdown(lines: string[]): string {
  return lines
    .map((line) => {
      if (line === "#") return "";
      if (line.startsWith("# ")) return line.slice(2);
      // Tolerate lines a user may have edited without the prefix.
      return line;
    })
    .join("\n")
    .replace(/\n+$/, "");
}

/**
 * Split a macro body into cells using ``# %%`` / ``# %% [markdown]``
 * markers. The leading content (before the first marker) becomes a
 * code cell when non-empty, so users who add code above the first
 * marker do not lose it.
 */
function splitMacroBodyIntoCells(body: string): CellModel[] {
  const lines = body.split("\n");
  const cells: CellModel[] = [];
  let currentType: "code" | "markdown" = "code";
  let buffer: string[] = [];

  const flush = () => {
    // Drop trailing blank lines from the buffer.
    while (buffer.length > 0 && buffer[buffer.length - 1].trim() === "") {
      buffer.pop();
    }
    if (buffer.length === 0) return;
    if (currentType === "markdown") {
      cells.push(emptyMarkdownCell(unindentMarkdown(buffer)));
    } else {
      cells.push(emptyCodeCell(buffer.join("\n")));
    }
    buffer = [];
  };

  for (const line of lines) {
    if (MARKDOWN_MARKER_RE.test(line)) {
      flush();
      currentType = "markdown";
      continue;
    }
    if (CODE_MARKER_RE.test(line)) {
      flush();
      currentType = "code";
      continue;
    }
    buffer.push(line);
  }
  flush();
  return cells;
}

/**
 * Convert a macro to a notebook.
 *
 * @param title  Default title (used when the header doesn't carry one).
 * @param source Full macro source (header + body).
 */
export function macroToNotebook(title: string, source: string): NotebookModel {
  const stripped = stripMacroHeader(source);
  const finalTitle = (stripped.title ?? title).trim() || t("Untitled");
  const cells = splitMacroBodyIntoCells(stripped.body);
  const nb = emptyNotebook(finalTitle);
  nb.cells = cells.length > 0 ? cells : [emptyCodeCell(stripped.body)];
  return nb;
}
