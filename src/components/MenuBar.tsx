import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import logoUrl from "../assets/DataLab.svg";
import type { ActionDescriptor, ActionState, MenuNode } from "../actions/types";
import { buildMenuTree } from "../actions/buildMenu";
import { useTheme } from "../utils/theme";

interface Props {
  status: string;
  statusKind: "loading" | "ready" | "error";
  state: ActionState;
  actions: ActionDescriptor[];
}

/** Recursive submenu rendering. */
function SubmenuList({
  nodes,
  state,
  onClose,
}: {
  nodes: MenuNode[];
  state: ActionState;
  onClose: () => void;
}) {
  const [openChild, setOpenChild] = useState<string | null>(null);
  return (
    <ul className="menu-dropdown" role="menu">
      {nodes.map((node, idx) => {
        const sep =
          node.action?.beginGroup && idx > 0 ? (
            <li
              key={node.path + ":sep"}
              className="menu-separator"
              role="separator"
              aria-hidden="true"
            />
          ) : null;
        if (node.children && node.children.length > 0) {
          const isOpen = openChild === node.path;
          return (
            <Fragment key={node.path}>
              {sep}
              <li
                className="menu-item menu-item-submenu"
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={isOpen}
                onMouseEnter={() => setOpenChild(node.path)}
                onMouseLeave={() =>
                  setOpenChild((c) => (c === node.path ? null : c))
                }
              >
                <span className="menu-icon-slot" aria-hidden="true" />
                <span className="menu-label">{node.label}</span>
                <span className="menu-arrow">›</span>
                {isOpen && (
                  <SubmenuList
                    nodes={node.children}
                    state={state}
                    onClose={onClose}
                  />
                )}
              </li>
            </Fragment>
          );
        }
        const action = node.action!;
        const enabled = action.enabled(state);
        return (
          <Fragment key={node.path}>
            {sep}
            <li
              className={
                "menu-item menu-item-leaf" + (enabled ? "" : " disabled")
              }
              role="menuitem"
              aria-disabled={!enabled}
              onClick={(event) => {
                event.stopPropagation();
                if (!enabled) return;
                onClose();
                void action.run();
              }}
              title={action.menuPath}
            >
              <span className="menu-icon-slot" aria-hidden="true">
                {action.iconUrl && (
                  <img
                    src={action.iconUrl}
                    alt=""
                    className="menu-icon-img"
                  />
                )}
              </span>
              <span className="menu-label">{node.label}</span>
              {action.shortcut && (
                <span className="menu-shortcut">{action.shortcut}</span>
              )}
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}

export function MenuBar(props: Props) {
  const { status, statusKind, state, actions } = props;
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
      </div>
      <nav className="menubar-nav" role="menubar">
        {tree.map((node) => {
          const isOpen = openTop === node.label;
          return (
            <div
              key={node.label}
              className={"menubar-top" + (isOpen ? " open" : "")}
              role="menuitem"
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
                <SubmenuList
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
      <ThemeToggleButton />
    </div>
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
