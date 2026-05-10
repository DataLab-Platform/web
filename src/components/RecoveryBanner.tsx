import { useCallback } from "react";

/**
 * Cold-start recovery banner.
 *
 * Surfaces a single, dismissable message at the top of the app
 * whenever the workspace booted with macros and/or notebooks
 * **silently recovered from the IndexedDB cache** rather than from an
 * HDF5 file.
 *
 * The semantics are deliberately minimal:
 *
 *   * The macro / notebook panels already auto-rehydrate from the
 *     "Recent…" cache on first mount when the workspace is empty
 *     (see :file:`src/components/MacroPanel.tsx` and
 *     :file:`src/components/notebook/NotebookPanel.tsx`). The banner
 *     does **not** drive that recovery; it only informs the user
 *     that it happened and reminds them that — under the
 *     "HDF5 = single durable source of truth" model — the recovered
 *     content is *not yet durable* until they save an HDF5 workspace.
 *
 *   * Signals and images do **not** survive a reload. If they were
 *     in the previous session, they are gone; only the macro /
 *     notebook content (which the panels persist eagerly) comes back.
 *
 *   * The banner is shown once per cold start. After "Save HDF5
 *     workspace…" or "Dismiss", it stays hidden for the session.
 *
 * The component is purely presentational; the parent decides when
 * to render it.
 */

export interface RecoveryBannerProps {
  /** Number of macros recovered from the IndexedDB cache. */
  macroCount: number;
  /** Number of notebooks recovered from the IndexedDB cache. */
  notebookCount: number;
  /** Triggered when the user clicks "Save HDF5 workspace…". */
  onSave: () => void;
  /** Triggered when the user clicks "Dismiss". */
  onDismiss: () => void;
  /** ``true`` while the Save action is unavailable (e.g. busy). */
  saveDisabled?: boolean;
}

function pluralise(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
}

export function RecoveryBanner({
  macroCount,
  notebookCount,
  onSave,
  onDismiss,
  saveDisabled = false,
}: RecoveryBannerProps): JSX.Element {
  const handleSave = useCallback(() => {
    onSave();
  }, [onSave]);
  const handleDismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  // Build a "N macros and M notebooks" sentence; collapse when one
  // side is zero so we don't say "0 macros".
  const parts: string[] = [];
  if (macroCount > 0) parts.push(pluralise(macroCount, "macro"));
  if (notebookCount > 0) parts.push(pluralise(notebookCount, "notebook"));
  const summary = parts.join(" and ");

  return (
    <div
      className="recovery-banner"
      role="status"
      data-testid="recovery-banner"
    >
      <div className="recovery-banner-message">
        <strong>Recovered {summary} from the previous session.</strong> Signals
        and images were not restored — only macros and notebooks are cached in
        the browser. Save an HDF5 workspace to make the current state durable.
      </div>
      <div className="recovery-banner-actions">
        <button
          type="button"
          className="recovery-banner-save"
          onClick={handleSave}
          disabled={saveDisabled}
        >
          Save HDF5 workspace…
        </button>
        <button
          type="button"
          className="recovery-banner-dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss recovery banner"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
