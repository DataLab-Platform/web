import { useCallback } from "react";
import { t } from "../i18n/translate";

/**
 * Cold-start "Recent…" hint banner.
 *
 * Surfaces a single, dismissable message at the top of the app on a
 * cold start when the IndexedDB cache still holds macros and/or
 * notebooks the user edited in a previous session.
 *
 * The semantics are deliberately minimal and honest:
 *
 *   * Macros and notebooks are **not** silently restored into the
 *     workspace. The cache is a roll-over of *edited* documents,
 *     reachable only through each panel's "Recent…" menu
 *     (see :file:`src/components/MacroPanel.tsx` and
 *     :file:`src/components/notebook/NotebookPanel.tsx`). The banner
 *     simply tells the user those documents exist and where to find
 *     them.
 *
 *   * Signals and images are **not** cached at all — they never
 *     survive a reload. Only HDF5 saves are durable.
 *
 *   * The banner is shown once per cold start. After "Dismiss" — or
 *     once the user opens / saves an HDF5 workspace — it stays hidden
 *     for the session.
 *
 * The component is purely presentational; the parent decides when
 * to render it.
 */

export interface RecoveryBannerProps {
  /** Number of macros available in the IndexedDB "Recent…" cache. */
  macroCount: number;
  /** Number of notebooks available in the IndexedDB "Recent…" cache. */
  notebookCount: number;
  /** Triggered when the user clicks "Dismiss". */
  onDismiss: () => void;
}

function pluralise(n: number, singularKey: string, pluralKey: string): string {
  return t(n === 1 ? singularKey : pluralKey, { count: n });
}

export function RecoveryBanner({
  macroCount,
  notebookCount,
  onDismiss,
}: RecoveryBannerProps): JSX.Element {
  const handleDismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  // Build a "N macros and M notebooks" sentence; collapse when one
  // side is zero so we don't say "0 macros".
  const parts: string[] = [];
  if (macroCount > 0)
    parts.push(pluralise(macroCount, "{count} macro", "{count} macros"));
  if (notebookCount > 0)
    parts.push(
      pluralise(notebookCount, "{count} notebook", "{count} notebooks"),
    );
  const summary = parts.join(` ${t("and")} `);

  return (
    <div
      className="recovery-banner"
      role="status"
      data-testid="recovery-banner"
    >
      <div className="recovery-banner-message">
        <strong>
          {t("{summary} from a previous session available in Recent…", {
            summary,
          })}
        </strong>{" "}
        {t(
          "Open them from each panel's Recent… menu. Signals and images are not cached in the browser — save an HDF5 workspace to make the current state durable.",
        )}
      </div>
      <div className="recovery-banner-actions">
        <button
          type="button"
          className="recovery-banner-dismiss"
          onClick={handleDismiss}
          aria-label={t("Dismiss recovery banner")}
        >
          {t("Dismiss")}
        </button>
      </div>
    </div>
  );
}
