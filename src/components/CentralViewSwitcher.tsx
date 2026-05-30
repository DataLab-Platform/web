import type { ReactElement } from "react";

import { getRootIconUrl } from "../assets/rootIcons";
import { t } from "../i18n/translate";

export type CentralView = "plot" | "macro" | "notebook";

export interface CentralViewSwitcherProps {
  active: CentralView;
  onChange: (view: CentralView) => void;
  disabled?: boolean;
  /** Map of views currently rendered as floating overlays.  Detached
   *  tabs render a small "↗" glyph and call ``onChange`` even when
   *  clicked while active — the host uses this to focus / un-collapse
   *  the overlay. */
  detached?: Partial<Record<CentralView, boolean>>;
}

const PLOT_ICON = getRootIconUrl("visualization.svg");
const MACRO_ICON = getRootIconUrl("script.svg");
const NOTEBOOK_ICON = getRootIconUrl("notebook.svg");

interface TabConfig {
  view: CentralView;
  label: string;
  iconUrl: string | undefined;
}

const TABS: TabConfig[] = [
  { view: "plot", label: "Plot", iconUrl: PLOT_ICON },
  { view: "macro", label: "Macros", iconUrl: MACRO_ICON },
  { view: "notebook", label: "Notebooks", iconUrl: NOTEBOOK_ICON },
];

/**
 * Three-tab switcher at the top of the central area that controls
 * which view occupies the central pane: the plot for the
 * currently-selected object, the macro editor, or the notebook
 * editor.  Independent from the left-panel TreeKindSwitcher.
 *
 * The Notebook and Macro tabs may be *detached* — rendered as a
 * floating overlay instead of occupying the central area.  Detached
 * tabs gain a "↗" glyph; clicking such a tab is forwarded to the
 * host so it can focus the corresponding overlay.
 */
export function CentralViewSwitcher({
  active,
  onChange,
  disabled,
  detached,
}: CentralViewSwitcherProps): ReactElement {
  return (
    <div
      className="central-view-switcher"
      role="tablist"
      aria-label={t("Central view")}
    >
      {TABS.map(({ view, label, iconUrl }) => {
        const isDetached = !!detached?.[view];
        const isActive = active === view;
        const tLabel = t(label);
        return (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={
              isDetached ? t("{label} (detached)", { label: tLabel }) : tLabel
            }
            disabled={disabled}
            className={`central-view-switcher-tab${isActive ? " active" : ""}`}
            onClick={() => onChange(view)}
          >
            {iconUrl && (
              <img src={iconUrl} alt="" className="switcher-tab-icon" />
            )}
            {tLabel}
            {isDetached && (
              <span
                className="central-view-switcher-tab-detached"
                aria-hidden="true"
              >
                ↗
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
