import type { ReactElement } from "react";

export type PanelKind = "signal" | "image" | "macro" | "notebook";

export interface PanelSwitcherProps {
  active: PanelKind;
  onChange: (kind: PanelKind) => void;
  disabled?: boolean;
}

/**
 * Four-tab switcher mirroring DataLab desktop's Signals / Images /
 * Macros panels, plus the DataLab-Web specific Notebooks tab.  The
 * active tab determines the object kind shown by the object tree (or
 * the macro/notebook editor for ``"macro"``/``"notebook"``), the data
 * displayed in the plot area, and the menu actions available.
 */
export function PanelSwitcher({
  active,
  onChange,
  disabled,
}: PanelSwitcherProps): ReactElement {
  return (
    <div className="panel-switcher" role="tablist" aria-label="Active panel">
      <button
        type="button"
        role="tab"
        aria-selected={active === "signal"}
        disabled={disabled}
        className={`panel-switcher-tab${active === "signal" ? " active" : ""}`}
        onClick={() => onChange("signal")}
      >
        Signals
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === "image"}
        disabled={disabled}
        className={`panel-switcher-tab${active === "image" ? " active" : ""}`}
        onClick={() => onChange("image")}
      >
        Images
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === "macro"}
        disabled={disabled}
        className={`panel-switcher-tab${active === "macro" ? " active" : ""}`}
        onClick={() => onChange("macro")}
      >
        Macros
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === "notebook"}
        disabled={disabled}
        className={`panel-switcher-tab${active === "notebook" ? " active" : ""}`}
        onClick={() => onChange("notebook")}
      >
        Notebooks
      </button>
    </div>
  );
}
