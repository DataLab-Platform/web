/**
 * Macro output console.
 *
 * Mirrors the bottom ``PythonShellWidget`` of DataLab Qt's MacroPanel
 * but is plain HTML — no terminal emulation.  Lines are colored by
 * stream (stdout / stderr / system).  Auto-scroll is sticky at the
 * bottom and pauses if the user scrolls up; a "Resume" pill restores
 * it.  Capped at ``MAX_LINES`` lines (FIFO).
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { MacroStreamKind } from "../runtime/MacroRuntime";

const MAX_LINES = 5000;

export interface MacroConsoleHandle {
  append: (kind: MacroStreamKind, text: string) => void;
  clear: () => void;
  exportText: () => string;
}

interface Line {
  kind: MacroStreamKind;
  text: string;
}

export const MacroConsole = forwardRef<MacroConsoleHandle, object>(
  function MacroConsole(_props, ref) {
    const [lines, setLines] = useState<Line[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);
    const stickyRef = useRef(true);
    const [showResume, setShowResume] = useState(false);
    // Buffer pending splits across appends so we never break a UTF-8 line.
    const pendingRef = useRef<Record<MacroStreamKind, string>>({
      stdout: "",
      stderr: "",
      system: "",
    });

    const append = useCallback((kind: MacroStreamKind, text: string) => {
      // Split into individual lines; keep dangling fragment for next call.
      pendingRef.current[kind] += text;
      const buf = pendingRef.current[kind];
      const parts = buf.split("\n");
      pendingRef.current[kind] = parts.pop() ?? "";
      const completed = parts.map((t) => ({ kind, text: t }));
      if (completed.length === 0) return;
      setLines((prev) => {
        const next = prev.concat(completed);
        if (next.length > MAX_LINES) {
          return next.slice(next.length - MAX_LINES);
        }
        return next;
      });
    }, []);

    const clear = useCallback(() => {
      setLines([]);
      pendingRef.current = { stdout: "", stderr: "", system: "" };
    }, []);

    const exportText = useCallback(
      () =>
        lines
          .map((l) => l.text)
          .concat(Object.values(pendingRef.current).filter((s) => s.length > 0))
          .join("\n"),
      [lines],
    );

    useImperativeHandle(ref, () => ({ append, clear, exportText }), [
      append,
      clear,
      exportText,
    ]);

    // Sticky auto-scroll: if user is at (or near) the bottom, snap to it
    // after each render; otherwise show the "Resume" pill.
    useLayoutEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      if (stickyRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    }, [lines]);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const onScroll = () => {
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        const atBottom = distance < 4;
        stickyRef.current = atBottom;
        setShowResume(!atBottom);
      };
      el.addEventListener("scroll", onScroll, { passive: true });
      return () => el.removeEventListener("scroll", onScroll);
    }, []);

    const handleResume = () => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      stickyRef.current = true;
      setShowResume(false);
    };

    const handleClear = () => clear();

    const handleExport = () => {
      const text = exportText();
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "macro-console.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };

    return (
      <div className="macro-console">
        <div className="macro-console-toolbar">
          <span className="macro-console-title">Output</span>
          <div className="macro-console-actions">
            <button type="button" onClick={handleClear}>
              Clear
            </button>
            <button type="button" onClick={handleExport}>
              Export…
            </button>
          </div>
        </div>
        <div className="macro-console-body" ref={containerRef}>
          {lines.length === 0 ? (
            <div className="macro-console-empty">
              Run a macro to see its output here.
            </div>
          ) : (
            lines.map((line, idx) => (
              <div key={idx} className={`macro-console-line ${line.kind}`}>
                {line.text || "\u00a0"}
              </div>
            ))
          )}
          {showResume && (
            <button
              type="button"
              className="macro-console-resume"
              onClick={handleResume}
            >
              ↓ Resume auto-scroll
            </button>
          )}
        </div>
      </div>
    );
  },
);
