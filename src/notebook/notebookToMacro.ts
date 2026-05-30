/**
 * Convert a :type:`NotebookModel` to DataLab macro source code.
 *
 * Cells are concatenated in order:
 *   - Code cells contribute their source verbatim.
 *   - Markdown cells contribute the same source, prefixed with ``# `` on
 *     each line so the result remains valid Python.
 *   - Cells are separated by a single blank line.
 *
 * The function is a pure transformation — it does not touch React,
 * Pyodide, or the macro store. Callers (e.g. :file:`MacroPanel.tsx`)
 * are responsible for prepending the standard macro header.
 *
 * The conversion is intentionally lossy: cell ids, execution counts
 * and outputs are dropped. Markdown cells round-trip back to markdown
 * via :file:`macroToNotebook.ts` only if the user does not edit the
 * commented lines.
 */

import type { CellModel, NotebookModel } from "./types";
import { t } from "../i18n/translate";

/** Magic marker line identifying a markdown cell in macro form. */
const MARKDOWN_MARKER = "# %% [markdown]";

/** Magic marker line identifying a code cell in macro form. */
const CODE_MARKER = "# %%";

/**
 * Convert one cell to macro-friendly source text.
 *
 * Markdown cells are emitted as a ``# %% [markdown]`` block followed by
 * each line of the source prefixed with ``# `` (so the file remains a
 * valid Python module). Code cells are emitted as a plain ``# %%``
 * block followed by the source verbatim.
 */
function cellToMacroBlock(cell: CellModel): string {
  if (cell.type === "markdown") {
    const body = cell.source
      .split("\n")
      .map((line) => (line.length === 0 ? "#" : `# ${line}`))
      .join("\n");
    return `${MARKDOWN_MARKER}\n${body}`;
  }
  return `${CODE_MARKER}\n${cell.source}`;
}

/**
 * Build macro source code from a notebook.
 *
 * The returned string is the body to put under DataLab's standard
 * macro header. Use :func:`buildConvertedMacro` for the full
 * "header + body" string ready to load into the editor.
 */
export function notebookToMacroBody(nb: NotebookModel): string {
  if (nb.cells.length === 0) {
    return "";
  }
  return nb.cells.map(cellToMacroBlock).join("\n\n") + "\n";
}

/** Default macro title derived from a notebook name. */
export function notebookTitleAsMacroTitle(nb: NotebookModel): string {
  const trimmed = nb.name.trim();
  return trimmed === "" ? t("Untitled") : trimmed;
}

/**
 * Convenience wrapper returning ``{title, body}`` ready for
 * :meth:`DataLabRuntime.createMacro`. The caller still needs to
 * prepend the standard ``makeFileHeader`` from MacroPanel.
 */
export function notebookToMacro(nb: NotebookModel): {
  title: string;
  body: string;
} {
  return {
    title: notebookTitleAsMacroTitle(nb),
    body: notebookToMacroBody(nb),
  };
}
