/**
 * One notebook cell — code editor + (for code cells) execution state &
 * output area.  Markdown cells render their source as HTML when not
 * being edited; double-click to edit.
 *
 * The editor is built on CodeMirror 6 (same config as
 * :file:`MacroEditorTabs.tsx`) so the look-and-feel and keymaps are
 * consistent across the macro and notebook panels.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import type { CellModel } from "../../notebook/types";
import { IsolatedMarkup } from "./IsolatedMarkup";
import { OutputArea } from "./OutputArea";
import { sanitizeUntrustedHtml } from "./untrustedMarkup";
import { t } from "../../i18n/translate";

interface CellProps {
  cell: CellModel;
  active: boolean;
  theme: "light" | "dark";
  onChange: (id: string, source: string) => void;
  onRun: (id: string) => void;
  onActivate: (id: string) => void;
  onInsertBelow: (id: string) => void;
  onDelete: (id: string) => void;
  onConvert: (id: string) => void;
}

export function Cell({
  cell,
  active,
  theme,
  onChange,
  onRun,
  onActivate,
  onInsertBelow,
  onDelete,
  onConvert,
}: CellProps) {
  const [editingMarkdown, setEditingMarkdown] = useState(cell.source === "");

  return (
    <div
      className={`nb-cell nb-cell-${cell.type}${active ? " nb-cell-active" : ""}${
        cell.status === "running" ? " nb-cell-running" : ""
      }${cell.status === "error" ? " nb-cell-error" : ""}`}
      onClick={() => onActivate(cell.id)}
      role="group"
      aria-label={`${cell.type} cell`}
    >
      <div className="nb-cell-prompt">
        {cell.type === "code"
          ? `[${cell.execCount ?? (cell.status === "running" ? "*" : " ")}]:`
          : ""}
      </div>
      <div className="nb-cell-body">
        {cell.type === "code" || editingMarkdown ? (
          <CodeMirrorEditor
            cellId={cell.id}
            value={cell.source}
            language={cell.type === "code" ? "python" : "markdown"}
            theme={theme}
            onChange={onChange}
            onRun={() => onRun(cell.id)}
            onInsertBelow={() => onInsertBelow(cell.id)}
            onDelete={() => onDelete(cell.id)}
            onConvert={() => onConvert(cell.id)}
            onCommitMarkdown={
              cell.type === "markdown"
                ? () => setEditingMarkdown(false)
                : undefined
            }
          />
        ) : (
          <div
            className="nb-cell-markdown-rendered"
            onDoubleClick={() => setEditingMarkdown(true)}
            title={t("Double-click to edit")}
          >
            {cell.source.trim() === "" ? (
              <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                {t("(empty markdown — double-click to edit)")}
              </pre>
            ) : (
              <MarkdownRendered source={cell.source} />
            )}
          </div>
        )}
        {cell.type === "code" && cell.outputs.length > 0 && (
          <OutputArea outputs={cell.outputs} />
        )}
      </div>
    </div>
  );
}

interface CodeMirrorEditorProps {
  cellId: string;
  value: string;
  language: "python" | "markdown";
  theme: "light" | "dark";
  onChange: (id: string, source: string) => void;
  onRun: () => void;
  onInsertBelow: () => void;
  onDelete: () => void;
  onConvert: () => void;
  onCommitMarkdown?: () => void;
}

function CodeMirrorEditor({
  cellId,
  value,
  language,
  theme,
  onChange,
  onRun,
  onInsertBelow,
  onDelete,
  onConvert,
  onCommitMarkdown,
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onInsertBelowRef = useRef(onInsertBelow);
  const onDeleteRef = useRef(onDelete);
  const onConvertRef = useRef(onConvert);
  const onCommitMarkdownRef = useRef(onCommitMarkdown);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  onInsertBelowRef.current = onInsertBelow;
  onDeleteRef.current = onDelete;
  onConvertRef.current = onConvert;
  onCommitMarkdownRef.current = onCommitMarkdown;

  const cellKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: "Shift-Enter",
          preventDefault: true,
          run: () => {
            onRunRef.current();
            onInsertBelowRef.current();
            return true;
          },
        },
        {
          key: "Ctrl-Enter",
          preventDefault: true,
          run: () => {
            onRunRef.current();
            if (onCommitMarkdownRef.current) onCommitMarkdownRef.current();
            return true;
          },
        },
        {
          key: "Mod-Enter",
          preventDefault: true,
          run: () => {
            onRunRef.current();
            if (onCommitMarkdownRef.current) onCommitMarkdownRef.current();
            return true;
          },
        },
        {
          key: "Alt-Shift-Backspace",
          preventDefault: true,
          run: () => {
            onDeleteRef.current();
            return true;
          },
        },
      ]),
    [],
  );

  const baseExtensions = useMemo(() => {
    const langExt = language === "python" ? [python()] : [];
    return [
      lineNumbers(),
      foldGutter(),
      history(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      ...langExt,
      cellKeymap,
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        ...searchKeymap,
      ]),
      ...(theme === "dark" ? [oneDark] : []),
    ];
  }, [language, theme, cellKeymap]);

  // Mount editor on first render / language change.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          ...baseExtensions,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              onChangeRef.current(cellId, u.state.doc.toString());
            }
          }),
        ],
      }),
      parent: container,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // baseExtensions changes when language/theme changes; cellId is stable.
    // ``value`` is intentionally excluded — pushing it into deps would
    // recreate the editor on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseExtensions, cellId]);

  // Sync upstream value into the editor when it diverges (Restart, undo
  // from menu, etc.) without losing the cursor on every keystroke.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // Reference ``onConvert`` so future toolbar wires can pick it up;
  // also serves as a placeholder for the keymap binding (Esc-then-M/Y
  // is more involved and deferred to a later iteration).
  void onConvertRef;

  return <div className="nb-cell-editor" ref={containerRef} />;
}

// ---------------------------------------------------------------------------
// Markdown rendering — marked + untrusted markup isolation
// ---------------------------------------------------------------------------

// Configure once. Synchronous mode keeps ``parse`` returning string.
marked.setOptions({ gfm: true, breaks: false });

/** Rendering of markdown cells, applied inside their Shadow DOM. */
const MARKDOWN_CSS = `
h1, h2, h3, h4 { margin: 0.6em 0 0.3em 0; }
p { margin: 0.4em 0; }
code {
  background: var(--panel-alt);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: Consolas, monospace;
  font-size: 0.9em;
}
pre {
  background: var(--panel-alt);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
}
pre code { background: transparent; padding: 0; }
table { border-collapse: collapse; margin: 0.6em 0; }
th, td { border: 1px solid var(--border); padding: 4px 8px; }
blockquote {
  border-left: 3px solid var(--accent);
  margin: 0.6em 0;
  padding: 0 0.8em;
  color: var(--text-dim);
}
`;

interface MarkdownRenderedProps {
  source: string;
}

// Markdown cells of an opened ``.ipynb`` may hold any raw HTML: they are
// rendered like untrusted outputs.
function MarkdownRendered({ source }: MarkdownRenderedProps) {
  const rendered = useMemo(() => {
    try {
      const raw = marked.parse(source, { async: false }) as string;
      return { html: sanitizeUntrustedHtml(raw), error: null };
    } catch (err) {
      console.error("Markdown render failed:", err);
      return { html: "", error: (err as Error).message };
    }
  }, [source]);
  if (rendered.error !== null) return <pre>{rendered.error}</pre>;
  return <IsolatedMarkup html={rendered.html} css={MARKDOWN_CSS} />;
}
