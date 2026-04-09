/**
 * Multi-tab Python code editor for macros.
 *
 * Wraps CodeMirror 6 in a controlled component: one editor view per
 * macro id, lazily mounted on first activation and torn down on tab
 * close.  Keeps in-memory editor state per tab so switching tabs
 * preserves the cursor position and selection.
 */

import { useEffect, useMemo, useRef } from "react";
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

export interface MacroTab {
  id: string;
  title: string;
  /** Source code as last read from the model — change ⇒ editor resets. */
  code: string;
  dirty: boolean;
}

interface Props {
  tabs: MacroTab[];
  activeId: string | null;
  /** Called when the user types — provides the new code (debounced upstream). */
  onChange: (id: string, code: string) => void;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onRenameRequest: (id: string) => void;
  /** Theme: "light" or "dark". */
  theme?: "light" | "dark";
}

export function MacroEditorTabs({
  tabs,
  activeId,
  onChange,
  onActivate,
  onClose,
  onRenameRequest,
  theme = "dark",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // One EditorView per tab id — kept across rerenders.
  const viewsRef = useRef<Map<string, EditorView>>(new Map());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Build the shared extension array (memoised on theme).
  const baseExtensions = useMemo(
    () => [
      lineNumbers(),
      foldGutter(),
      history(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      python(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        ...searchKeymap,
      ]),
      ...(theme === "dark" ? [oneDark] : []),
    ],
    [theme],
  );

  // Mount / unmount editor views as the active tab changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!activeId) {
      container.innerHTML = "";
      return;
    }
    const tab = tabs.find((t) => t.id === activeId);
    if (!tab) {
      container.innerHTML = "";
      return;
    }
    // Clear previous DOM but keep view instances alive in the map.
    container.innerHTML = "";
    let view = viewsRef.current.get(activeId);
    if (!view) {
      const id = activeId;
      view = new EditorView({
        state: EditorState.create({
          doc: tab.code,
          extensions: [
            ...baseExtensions,
            EditorView.updateListener.of((u) => {
              if (u.docChanged) {
                onChangeRef.current(id, u.state.doc.toString());
              }
            }),
          ],
        }),
        parent: container,
      });
      viewsRef.current.set(activeId, view);
    } else {
      container.appendChild(view.dom);
      // If the upstream code differs from the editor, sync (e.g. after
      // an Import .py).  Skip when content matches to preserve cursor.
      const current = view.state.doc.toString();
      if (current !== tab.code) {
        view.dispatch({
          changes: { from: 0, to: current.length, insert: tab.code },
        });
      }
      view.focus();
    }
    // Rebuild theme extensions if theme changed.
  }, [activeId, tabs, baseExtensions]);

  // Tear down views for closed tabs.
  useEffect(() => {
    const ids = new Set(tabs.map((t) => t.id));
    for (const [id, view] of viewsRef.current) {
      if (!ids.has(id)) {
        view.destroy();
        viewsRef.current.delete(id);
      }
    }
  }, [tabs]);

  // Dispose all on unmount.
  useEffect(
    () => () => {
      for (const v of viewsRef.current.values()) v.destroy();
      viewsRef.current.clear();
    },
    [],
  );

  return (
    <div className="macro-editor">
      <div className="macro-tabs" role="tablist">
        {tabs.map((t) => (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === activeId}
            className={`macro-tab${t.id === activeId ? " active" : ""}`}
            onClick={() => onActivate(t.id)}
            onDoubleClick={() => onRenameRequest(t.id)}
            title="Double-click to rename"
          >
            <span className="macro-tab-title">
              {t.title}
              {t.dirty ? " •" : ""}
            </span>
            <button
              type="button"
              className="macro-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
              aria-label={`Close ${t.title}`}
              title="Close tab"
            >
              ×
            </button>
          </div>
        ))}
        {tabs.length === 0 && (
          <div className="macro-tabs-empty">No macro open.</div>
        )}
      </div>
      <div className="macro-editor-host" ref={containerRef} />
    </div>
  );
}
