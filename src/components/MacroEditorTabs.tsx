/**
 * Multi-tab Python code editor for macros.
 *
 * Wraps CodeMirror 6 in a controlled component: one editor view per
 * macro id, lazily mounted on first activation and torn down on tab
 * close.  Keeps in-memory editor state per tab so switching tabs
 * preserves the cursor position and selection.
 */

import { useEffect, useMemo, useRef, useState } from "react";
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
}

/** One "+" menu entry: blank macro or template-based macro creation. */
export interface MacroNewMenuEntry {
  /** User-visible label shown in the dropdown. */
  label: string;
  /** Optional short description rendered below the label. */
  description?: string;
  /** Optional template source code; when omitted ⇒ blank macro. */
  templateCode?: string;
}

interface Props {
  tabs: MacroTab[];
  activeId: string | null;
  /** Called when the user types — provides the new code (debounced upstream). */
  onChange: (id: string, code: string) => void;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** Request to start inline tab rename for *id* (double-click / button). */
  onRenameRequest: (id: string) => void;
  /** Id currently being renamed inline, or ``null`` if no rename in flight. */
  renamingId?: string | null;
  /** Current value of the rename input. */
  renameDraft?: string;
  /** Called as the rename input changes. */
  onRenameDraftChange?: (value: string) => void;
  /** Commit the in-flight rename. */
  onCommitRename?: () => void;
  /** Abort the in-flight rename. */
  onCancelRename?: () => void;
  /**
   * Optional "+" button at the right of the tab strip mirroring the
   * notebook tab strip's :code:`nb-tab-new` button. When omitted, the
   * button is hidden.
   */
  onNew?: (templateCode?: string) => void;
  /** Entries for the "+" dropdown (blank + templates). */
  newMenuEntries?: MacroNewMenuEntry[];
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
  renamingId = null,
  renameDraft = "",
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onNew,
  newMenuEntries,
  theme = "dark",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newMenuAnchor, setNewMenuAnchor] = useState<{
    left: number;
    top: number;
  } | null>(null);

  // Close the "+" dropdown on outside click.
  useEffect(() => {
    if (!newMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!newMenuRef.current?.contains(e.target as Node)) {
        setNewMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [newMenuOpen]);
  // One EditorView per tab id — kept across rerenders.
  const viewsRef = useRef<Map<string, EditorView>>(new Map());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Latest tabs array, accessed by the mount effect without making
  // ``tabs`` an effect dependency: every keystroke causes ``tabs`` to
  // change reference upstream, and re-attaching the editor DOM on each
  // keystroke loses the contentEditable selection in Firefox — typed
  // characters then end up inserted at line 1, column 1.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

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

  // Mount / attach editor view when the active tab changes.
  // IMPORTANT: this effect must NOT depend on ``tabs``. Each keystroke
  // updates ``tabs`` upstream; if we re-ran this effect on every tab
  // change we would detach and reattach the editor's contentEditable
  // root, which under Firefox resets the DOM selection to (0, 0) and
  // causes subsequent keystrokes to be inserted at the start of the
  // document. Document content sync is handled by a separate effect.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!activeId) {
      container.innerHTML = "";
      return;
    }
    const tab = tabsRef.current.find((t) => t.id === activeId);
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
    }
    view.focus();
  }, [activeId, baseExtensions]);

  // Sync upstream code changes into the active editor (e.g. after an
  // Import .py or a programmatic reset). Skip when content matches to
  // preserve the cursor — this is critical: on every keystroke the
  // updateListener pushes the new code upstream, which re-runs this
  // effect with a matching ``tab.code``, so we must be a no-op then.
  useEffect(() => {
    if (!activeId) return;
    const view = viewsRef.current.get(activeId);
    if (!view) return;
    const tab = tabs.find((t) => t.id === activeId);
    if (!tab) return;
    const current = view.state.doc.toString();
    if (current !== tab.code) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: tab.code },
      });
    }
  }, [activeId, tabs]);

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
            {renamingId === t.id ? (
              <input
                className="nb-tab-rename-input"
                type="text"
                autoFocus
                value={renameDraft}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onRenameDraftChange?.(e.target.value)}
                onBlur={() => onCommitRename?.()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onCommitRename?.();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    onCancelRename?.();
                  }
                }}
                aria-label="Macro name"
              />
            ) : (
              <span className="macro-tab-title">{t.title}</span>
            )}
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
        {onNew && (
          <div className="macro-tab-new-container" ref={newMenuRef}>
            <button
              type="button"
              className="macro-tab-new"
              onClick={(e) => {
                const rect = (
                  e.currentTarget as HTMLButtonElement
                ).getBoundingClientRect();
                setNewMenuAnchor({
                  left: rect.left,
                  top: rect.bottom + 4,
                });
                setNewMenuOpen((o) => !o);
              }}
              title="New macro…"
              aria-haspopup="menu"
              aria-expanded={newMenuOpen}
            >
              +
            </button>
            {newMenuOpen && newMenuAnchor && (
              <div
                className="macro-tab-new-menu"
                role="menu"
                style={{
                  position: "fixed",
                  left: newMenuAnchor.left,
                  top: newMenuAnchor.top,
                }}
              >
                {(newMenuEntries ?? [{ label: "Blank macro" }]).map(
                  (entry, i) => (
                    <button
                      type="button"
                      key={`${entry.label}-${i}`}
                      className="macro-tab-new-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setNewMenuOpen(false);
                        onNew(entry.templateCode);
                      }}
                    >
                      <span className="macro-tab-new-menu-label">
                        {entry.label}
                      </span>
                      {entry.description && (
                        <span className="macro-tab-new-menu-desc">
                          {entry.description}
                        </span>
                      )}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="macro-editor-host" ref={containerRef} />
    </div>
  );
}
