import type { ReactElement } from "react";

export type PanelKind = "signal" | "image" | "macro";

export interface PanelSwitcherProps {
  active: PanelKind;
  onChange: (kind: PanelKind) => void;
  disabled?: boolean;
}

/**
 * Three-tab switcher mirroring DataLab desktop's Signals / Images /
 * Macros panels.  The active tab determines the object kind shown by
 * the object tree (or the macro editor for ``"macro"``), the data
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
    </div>
  );
}
