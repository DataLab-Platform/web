/**
 * Cross-panel object navigation context.
 *
 * Lets components render the 8-char hex short IDs that appear inside
 * computation titles (``average(a3f5b2c1, b9e2d104)``, ``normalize(
 * a3f5b2c1)`` …) as interactive affordances:
 *
 *   * :func:`lookupOid` resolves an oid to its owning panel + metadata,
 *     so a renderer can decide between a clickable link and plain text
 *     (no dead buttons for stale or accidental hex strings).
 *   * :func:`navigateToOid` selects the source object, switching
 *     panels (signal ↔ image) when it lives in the inactive panel.
 *
 * The provider lives in :mod:`App` where the active-panel state and
 * the selection setters are owned; this context just wraps them in a
 * stable typed surface so :class:`TitleWithLinks` doesn't need to
 * prop-drill through every title-rendering site.
 */
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { ObjectNode, PanelKind } from "../runtime/runtime";

/** Resolution of a short-ID lookup. */
export interface OidLookupEntry {
  kind: PanelKind;
  node: ObjectNode;
}

export interface ObjectNavigationContextValue {
  /** Returns the owning panel + node for *oid*, or ``null`` when the
   *  id isn't a real object id in either panel. Constant-time. */
  lookupOid: (oid: string) => OidLookupEntry | null;
  /** Selects *oid* (and switches panels when needed). No-op when the
   *  id is unknown. */
  navigateToOid: (oid: string) => void;
}

const ObjectNavigationContext =
  createContext<ObjectNavigationContextValue | null>(null);

interface ProviderProps {
  /** Pre-built oid → entry map. Callers should memoise it. */
  oidIndex: ReadonlyMap<string, OidLookupEntry>;
  navigateToOid: (oid: string) => void;
  children: ReactNode;
}

export function ObjectNavigationProvider({
  oidIndex,
  navigateToOid,
  children,
}: ProviderProps) {
  const value = useMemo<ObjectNavigationContextValue>(
    () => ({
      lookupOid: (oid) => oidIndex.get(oid) ?? null,
      navigateToOid,
    }),
    [oidIndex, navigateToOid],
  );
  return (
    <ObjectNavigationContext.Provider value={value}>
      {children}
    </ObjectNavigationContext.Provider>
  );
}

/** Read the navigation context. Returns ``null`` when no provider is
 *  mounted — callers fall back to plain-text rendering in that case
 *  (e.g. tests, dialogs rendered outside the main shell). */
export function useObjectNavigation(): ObjectNavigationContextValue | null {
  return useContext(ObjectNavigationContext);
}
