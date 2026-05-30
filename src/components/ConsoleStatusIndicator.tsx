/**
 * ConsoleStatusIndicator — small persistent button rendered in the
 * menu bar that turns red whenever a ``warn`` or ``error`` entry lands
 * in the global browser console buffer (see :mod:`utils/consoleLog`).
 *
 * Mirrors the ``ConsoleStatus`` widget of the DataLab Qt desktop app:
 * silent JS or Python failures (the latter routed through ``console.
 * error`` in ``runtime.ts`` ``catch`` blocks) become visible without
 * forcing the console log dialog to open.
 *
 * Clicking the indicator invokes ``onOpen`` (which the parent wires to
 * the Help > Browser console log dialog) and then marks the unseen
 * entries as acknowledged.
 */

import { useConsoleErrors } from "../utils/consoleLog";
import { t } from "../i18n/translate";

interface Props {
  /** Called when the user clicks the indicator.  The parent typically
   *  opens the Help > Browser console log dialog. */
  onOpen: () => void;
}

export function ConsoleStatusIndicator({ onOpen }: Props) {
  const { unseen, errors, warnings, markSeen } = useConsoleErrors();
  const alert = unseen > 0;
  // Mirror the DataLab Qt ``ConsoleStatus`` pattern (info icon when
  // idle, warning icon when an error/warning is logged) with Unicode
  // glyphs — same visual style as the theme toggle button (☼/☾).
  const glyph = alert ? "\u26A0" : "\u24D8"; // ⚠ / ⓘ
  const tooltip = alert
    ? t("{breakdown} logged — click to open the browser console log", {
        breakdown: formatBreakdown(errors, warnings),
      })
    : t("No error or warning logged — click to open the browser console log");
  return (
    <button
      type="button"
      className={"console-status-indicator" + (alert ? " alert" : "")}
      onClick={() => {
        onOpen();
        markSeen();
      }}
      title={tooltip}
      aria-label={tooltip}
    >
      <span className="console-status-indicator-glyph" aria-hidden="true">
        {glyph}
      </span>
      {alert && (
        <span className="console-status-indicator-badge" aria-hidden="true">
          {unseen > 99 ? "99+" : unseen}
        </span>
      )}
    </button>
  );
}

function formatBreakdown(errors: number, warnings: number): string {
  const parts: string[] = [];
  if (errors > 0)
    parts.push(
      errors > 1
        ? t("{count} errors", { count: errors })
        : t("{count} error", { count: errors }),
    );
  if (warnings > 0)
    parts.push(
      warnings > 1
        ? t("{count} warnings", { count: warnings })
        : t("{count} warning", { count: warnings }),
    );
  return parts.join(", ");
}
