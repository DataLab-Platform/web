import type { ReactElement } from "react";

import { getRootIconUrl } from "../assets/rootIcons";
import { t } from "../i18n/translate";

export type TreeKind = "signal" | "image";

export interface TreeKindSwitcherProps {
  active: TreeKind;
  onChange: (kind: TreeKind) => void;
  disabled?: boolean;
}

const SIGNAL_ICON = getRootIconUrl("signal.svg");
const IMAGE_ICON = getRootIconUrl("image.svg");

/**
 * Permanent two-tab switcher at the top of the left panel that
 * controls which object kind (signals or images) the ObjectTree
 * displays.  Independent from the central-view switcher: the user can
 * browse signals while editing a notebook, or vice versa.
 */
export function TreeKindSwitcher({
  active,
  onChange,
  disabled,
}: TreeKindSwitcherProps): ReactElement {
  return (
    <div
      className="tree-kind-switcher"
      role="tablist"
      aria-label={t("Object tree kind")}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === "signal"}
        disabled={disabled}
        className={`tree-kind-switcher-tab${
          active === "signal" ? " active" : ""
        }`}
        onClick={() => onChange("signal")}
      >
        {SIGNAL_ICON && (
          <img src={SIGNAL_ICON} alt="" className="switcher-tab-icon" />
        )}
        {t("Signals")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === "image"}
        disabled={disabled}
        className={`tree-kind-switcher-tab${
          active === "image" ? " active" : ""
        }`}
        onClick={() => onChange("image")}
      >
        {IMAGE_ICON && (
          <img src={IMAGE_ICON} alt="" className="switcher-tab-icon" />
        )}
        {t("Images")}
      </button>
    </div>
  );
}
