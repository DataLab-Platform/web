import { Fragment, useState } from "react";
import type { ActionState, MenuNode } from "../actions/types";

interface MenuDropdownProps {
  nodes: MenuNode[];
  state: ActionState;
  onClose: () => void;
}

/**
 * Recursive submenu rendering shared by the menu bar and the
 * object-tree context menu.
 *
 * The component is purely presentational: it walks ``nodes`` and
 * delegates ``run()``/``enabled()`` decisions to each leaf
 * ``ActionDescriptor``.
 */
export function MenuDropdown({ nodes, state, onClose }: MenuDropdownProps) {
  const [openChild, setOpenChild] = useState<string | null>(null);
  return (
    <ul className="menu-dropdown" role="menu">
      {nodes.map((node, idx) => {
        const sep =
          (node.action?.beginGroup || node.beginGroup) && idx > 0 ? (
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
                <span className="menu-icon-slot" aria-hidden="true">
                  {node.iconUrl && (
                    <img src={node.iconUrl} alt="" className="menu-icon-img" />
                  )}
                </span>
                <span className="menu-label">{node.displayLabel}</span>
                <span className="menu-arrow">›</span>
                {isOpen && (
                  <MenuDropdown
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
                  <img src={action.iconUrl} alt="" className="menu-icon-img" />
                )}
              </span>
              <span className="menu-label">{node.displayLabel}</span>
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}
