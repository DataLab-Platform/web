import { useCallback } from "react";

/** Outcome of a multi-selection click: the new selection and current item. */
export interface ListSelection {
  ids: string[];
  current: string | null;
}

/**
 * Pure reducer for list multi-selection à la file explorer:
 *
 * - **Shift** extends a contiguous range from ``currentId`` to ``clickedId``
 *   over the visible ``flatIds`` order.
 * - **Ctrl / Meta** toggles ``clickedId`` in/out of the current selection.
 * - **Plain click** selects ``clickedId`` alone.
 *
 * Kept side-effect-free so it can be unit-tested without React.
 */
export function computeListSelection(
  flatIds: string[],
  selectedIds: string[],
  currentId: string | null,
  clickedId: string,
  modifiers: { shift: boolean; ctrlOrMeta: boolean },
): ListSelection {
  if (modifiers.shift && currentId) {
    const a = flatIds.indexOf(currentId);
    const b = flatIds.indexOf(clickedId);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return { ids: flatIds.slice(lo, hi + 1), current: clickedId };
    }
  }
  if (modifiers.ctrlOrMeta) {
    const next = new Set(selectedIds);
    if (next.has(clickedId)) next.delete(clickedId);
    else next.add(clickedId);
    return {
      ids: Array.from(next),
      current: next.has(clickedId) ? clickedId : currentId,
    };
  }
  return { ids: [clickedId], current: clickedId };
}

/**
 * React binding around :func:`computeListSelection`. Returns a stable click
 * handler that maps a mouse event's modifier keys to the next selection and
 * forwards it to ``onSelectionChange``.
 */
export function useListSelection(
  flatIds: string[],
  selectedIds: string[],
  currentId: string | null,
  onSelectionChange: (ids: string[], current: string | null) => void,
): (clickedId: string, evt: React.MouseEvent) => void {
  return useCallback(
    (clickedId: string, evt: React.MouseEvent) => {
      const { ids, current } = computeListSelection(
        flatIds,
        selectedIds,
        currentId,
        clickedId,
        { shift: evt.shiftKey, ctrlOrMeta: evt.ctrlKey || evt.metaKey },
      );
      onSelectionChange(ids, current);
    },
    [flatIds, selectedIds, currentId, onSelectionChange],
  );
}
