import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { useTheme } from "../../utils/theme";

/** Read-only CodeMirror viewer with Python syntax highlighting. */
export function PythonCodeViewer({ code }: { code: string }) {
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
