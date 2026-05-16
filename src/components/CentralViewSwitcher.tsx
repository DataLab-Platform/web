import type { ReactElement } from "react";

import { getRootIconUrl } from "../assets/rootIcons";

export type CentralView = "plot" | "macro" | "notebook";

export interface CentralViewSwitcherProps {
  active: CentralView;
  onChange: (view: CentralView) => void;
  disabled?: boolean;
}

const PLOT_ICON = getRootIconUrl("visualization.svg");
const MACRO_ICON = getRootIconUrl("script.svg");
const NOTEBOOK_ICON = getRootIconUrl("notebook.svg");

/**
 * Three-tab switcher at the top of the central area that controls
 * which view occupies the central pane: the plot for the
 * currently-selected object, the macro editor, or the notebook
 * editor.  Independent from the left-panel TreeKindSwitcher.
 */
export function CentralViewSwitcher({
  active,
  onChange,
  disabled,
}: CentralViewSwitcherProps): ReactElement {
  return (
    <div
      className="central-view-switcher"
      role="tablist"
      aria-label="Central view"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === "plot"}
        disabled={disabled}
        className={`central-view-switcher-tab${
          active === "plot" ? " active" : ""
        }`}
        onClick={() => onChange("plot")}
      >
        {PLOT_ICON && (
          <img src={PLOT_ICON} alt="" className="switcher-tab-icon" />
        )}
        Plot
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === "macro"}
        disabled={disabled}
        className={`central-view-switcher-tab${
          active === "macro" ? " active" : ""
        }`}
        onClick={() => onChange("macro")}
      >
        {MACRO_ICON && (
          <img src={MACRO_ICON} alt="" className="switcher-tab-icon" />
        )}
        Macros
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === "notebook"}
        disabled={disabled}
        className={`central-view-switcher-tab${
          active === "notebook" ? " active" : ""
        }`}
        onClick={() => onChange("notebook")}
      >
        {NOTEBOOK_ICON && (
          <img src={NOTEBOOK_ICON} alt="" className="switcher-tab-icon" />
        )}
        Notebooks
      </button>
    </div>
  );
}
