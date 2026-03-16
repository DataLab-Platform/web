import type { ReactElement } from "react";

export type PanelKind = "signal" | "image";

export interface PanelSwitcherProps {
  active: PanelKind;
  onChange: (kind: PanelKind) => void;
  disabled?: boolean;
}

/**
 * Two-tab switcher mirroring DataLab desktop's Signals / Images panels.
 *
 * Displayed at the top of the left side panel — the active tab determines
 * the object kind shown by the object tree, the data displayed in the
 * plot area, and the menu actions (Create / Operations / Processing /
 * Analysis / ROI) the user can run.
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
    </div>
  );
}
