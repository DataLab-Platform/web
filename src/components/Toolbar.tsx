import { useMemo } from "react";
import type { ActionDescriptor, ActionState } from "../actions/types";
import { buildToolbarItems } from "../actions/buildToolbar";
import { t } from "../i18n/translate";

interface Props {
  /** Same flat action list that feeds the menu bar. Actions flagged with
   *  ``toolbar: true`` are surfaced here as icon buttons. */
  actions: ActionDescriptor[];
  /** Current action state, driving each button's enabled/disabled status. */
  state: ActionState;
}

/** General toolbar shown under the menu bar.
 *
 * It is a thin, icon-only view of the shared action registry — mirroring
 * DataLab desktop's ``PANEL_TOOLBAR``. Buttons reuse each action's
 * ``iconUrl``, translated ``label`` (as tooltip / accessible name),
 * ``enabled(state)`` predicate and ``run`` handler. As ``actions`` is
 * rebuilt per active panel, the toolbar automatically reflects the current
 * signal/image context.
 */
export function Toolbar(props: Props) {
  const { actions, state } = props;
  const items = useMemo(() => buildToolbarItems(actions), [actions]);

  if (items.length === 0) return null;

  return (
    <div className="toolbar" role="toolbar" aria-label={t("Toolbar")}>
      {items.map((item, index) => {
        if (item.kind === "separator") {
          return (
            <span
              key={`sep-${index}`}
              className="toolbar-separator"
              role="separator"
              aria-orientation="vertical"
            />
          );
        }
        const { action } = item;
        const enabled = action.enabled(state);
        return (
          <button
            key={action.id}
            type="button"
            className="toolbar-button"
            data-action-id={action.id}
            title={action.label}
            aria-label={action.label}
            disabled={!enabled}
            onClick={() => {
              void action.run();
            }}
          >
            {action.iconUrl ? (
              <img className="toolbar-icon" src={action.iconUrl} alt="" />
            ) : (
              <span className="toolbar-icon toolbar-icon-fallback" aria-hidden>
                {action.label.charAt(0)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
