/**
 * Tiny module-level registry that lets the React app publish its
 * current selection / panel state to non-React consumers (the
 * iframe-embedded remote bridge in particular).
 *
 * The host app calls :func:`registerSelectionSource` once with a
 * snapshot getter; every subsequent reader (``remoteBridge`` /
 * ``proxyBridge``) goes through :func:`getSelection` /
 * :func:`getCurrentPanel`.
 *
 * Kept intentionally minimal — this is *not* a state container, just a
 * forwarding hook for callbacks that already live in the React tree.
 */

export interface SelectionSnapshot {
  /** Currently selected object ids on the active panel. May be empty. */
  ids: string[];
  /** The "current" object id (last clicked / single-selection focus). */
  currentId: string | null;
  /** Active panel name (``"signal"``, ``"image"``, ``"macro"``, …). */
  panel: string;
}

export type SelectionSource = () => SelectionSnapshot;

let source: SelectionSource | null = null;

/** Publish the selection snapshot getter (idempotent — last writer wins). */
export function registerSelectionSource(getter: SelectionSource | null): void {
  source = getter;
}

/** Return the current selection ids, or ``[]`` when no source is wired.
 *
 *  When the selection list is empty but a *current* object is set
 *  (single-row focus without an explicit multi-select), the current id
 *  is returned as a one-element list. This mirrors DataLab desktop's
 *  action semantics where commands run on the current object whenever
 *  no broader selection exists. */
export function getSelection(): string[] {
  if (!source) return [];
  const snap = source();
  if (snap.ids.length > 0) return snap.ids;
  return snap.currentId ? [snap.currentId] : [];
}

/** Return the current panel name, or ``"signal"`` as a sane default. */
export function getCurrentPanel(): string {
  return source ? source().panel : "signal";
}

/** Return the focused object id (``null`` when nothing is current). */
export function getCurrentObjectId(): string | null {
  return source ? source().currentId : null;
}
