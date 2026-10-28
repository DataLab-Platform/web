/**
 * Python code blocks of assistant replies that can be saved as macros.
 *
 * The model is asked to propose macros through ``create_and_run_macro``
 * (with ``autorun: false`` when the user only wants the code), but it
 * may still paste the code in its reply. The AI Assistant panel offers
 * a "Save to Macros" button under each such block; this module finds
 * them and derives the title of the saved macro.
 */

import { marked, type Token } from "marked";
import { deriveTitle } from "./conversationStore";

/** Title used when no user request is available to name the macro. */
export const DEFAULT_MACRO_TITLE = "AI Assistant macro";

const PYTHON_LANGS = new Set(["python", "py", "python3", "py3"]);

/** Heuristic for fences without a language: a macro imports something
 *  or drives DataLab through ``proxy``. */
const PYTHON_HINT = /^\s*(import\s+\w|from\s+[\w.]+\s+import\s)|\bproxy\./m;

function isMacroCode(lang: string, code: string): boolean {
  const normalized = lang.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (PYTHON_LANGS.has(normalized)) return true;
  return normalized === "" && PYTHON_HINT.test(code);
}

/** Return the source of every Python code block of *markdown*, in
 *  document order (blocks nested in lists or quotes included). */
export function extractMacroCodeBlocks(markdown: string): string[] {
  if (!markdown.trim()) return [];
  const blocks: string[] = [];
  const tokens = marked.lexer(markdown);
  marked.walkTokens(tokens, (token: Token) => {
    if (token.type !== "code") return;
    const code = String(token.text ?? "");
    if (code.trim() && isMacroCode(String(token.lang ?? ""), code)) {
      blocks.push(code);
    }
  });
  return blocks;
}

/** Title of a macro saved from a reply: the user request it answers,
 *  shortened, or :data:`DEFAULT_MACRO_TITLE`. */
export function deriveMacroTitle(userText: string | null | undefined): string {
  if (!userText || !userText.trim()) return DEFAULT_MACRO_TITLE;
  return deriveTitle(userText);
}
