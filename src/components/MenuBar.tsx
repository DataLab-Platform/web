import { useEffect, useMemo, useRef, useState } from "react";
import logoUrl from "../assets/DataLab.svg";
import type { ActionDescriptor, ActionState } from "../actions/types";
import { buildMenuTree } from "../actions/buildMenu";
import { MenuDropdown } from "./MenuDropdown";
import { ConsoleStatusIndicator } from "./ConsoleStatusIndicator";
import { useTheme } from "../utils/theme";

interface Props {
  status: string;
  statusKind: "loading" | "ready" | "error";
  state: ActionState;
  actions: ActionDescriptor[];
  /** Callback invoked when the user clicks the "Beta" badge
   *  (typically opens the About dialog). */
  onShowExperimentalInfo?: () => void;
  /** Callback invoked when the user clicks the console-status indicator;
   *  typically opens the Help > Browser console log dialog. */
  onOpenConsole?: () => void;
  /** Current visibility of the AI Assistant panel. When ``undefined``
   *  the toggle button is hidden (used by surfaces that don't expose
   *  the assistant). */
  aiPanelVisible?: boolean;
  /** Toggle handler for the AI Assistant panel. Required to render
   *  the toggle button. */
  onToggleAIPanel?: () => void;
}

export function MenuBar(props: Props) {
  const {
    status,
    statusKind,
    state,
    actions,
    onShowExperimentalInfo,
    onOpenConsole,
    aiPanelVisible,
    onToggleAIPanel,
  } = props;
  const tree = useMemo(() => buildMenuTree(actions), [actions]);
  const [openTop, setOpenTop] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  // Close on outside-click / Escape.
  useEffect(() => {
    if (openTop === null) return;
    const handleDown = (event: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) {
        setOpenTop(null);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenTop(null);
    };
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openTop]);

  return (
    <div className="menubar" ref={barRef}>
      <div className="menubar-brand">
        <img className="menubar-logo" src={logoUrl} alt="" aria-hidden="true" />
        <h1>DataLab Web</h1>
        <button
          type="button"
          className="experimental-badge"
          onClick={onShowExperimentalInfo}
          title="DataLab-Web is currently in beta — click for details"
          aria-label="DataLab-Web is currently in beta — click for details"
        >
          Beta
        </button>
      </div>
      <nav className="menubar-nav" role="menubar">
        {tree.map((node) => {
          const isOpen = openTop === node.label;
          return (
            <div
              key={node.label}
              className={"menubar-top" + (isOpen ? " open" : "")}
              role="menuitem"
              data-menu-top={node.label}
              aria-haspopup="true"
              aria-expanded={isOpen}
              onClick={(event) => {
                event.stopPropagation();
                setOpenTop((c) => (c === node.label ? null : node.label));
              }}
              onMouseEnter={() => {
                if (openTop !== null) setOpenTop(node.label);
              }}
            >
              <span className="menubar-top-label">{node.label}</span>
              {isOpen && node.children && node.children.length > 0 && (
                <MenuDropdown
                  nodes={node.children}
                  state={state}
                  onClose={() => setOpenTop(null)}
                />
              )}
            </div>
          );
        })}
      </nav>
      <span className="spacer" />
      <span
        className="status"
        style={{ color: statusKind === "error" ? "#f48771" : undefined }}
      >
        {status}
      </span>
      {onOpenConsole && <ConsoleStatusIndicator onOpen={onOpenConsole} />}
      {onToggleAIPanel && (
        <AIToggleButton visible={!!aiPanelVisible} onToggle={onToggleAIPanel} />
      )}
      <ThemeToggleButton />
    </div>
  );
}

/** AI Assistant show/hide toggle, rendered next to the theme toggle.
 *  The pressed state mirrors :prop:`visible` so screen readers and
 *  visual styling stay in sync with the panel itself. */
function AIToggleButton({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  const label = visible ? "Hide AI Assistant" : "Show AI Assistant";
  return (
    <button
      type="button"
      className={
        "menubar-ai-toggle" + (visible ? " menubar-ai-toggle--active" : "")
      }
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={visible}
    >
      <svg
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        focusable={false}
      >
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.5A8 8 0 1 1 21 12z" />
        <path d="M9 11h.01M12 11h.01M15 11h.01" />
      </svg>
    </button>
  );
}

/** Light/dark theme toggle, wired to the persistent ``useTheme`` hook. */
function ThemeToggleButton() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      type="button"
      className="menubar-theme-toggle"
      onClick={toggle}
      title={label}
      aria-label={label}
    >
      {isDark ? "\u263C" : "\u263E"}
    </button>
  );
}
