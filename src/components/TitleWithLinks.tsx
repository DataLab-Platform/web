/**
 * Render an object title with embedded short-ID hyperlinks.
 *
 * Computation results carry titles like ``normalize(a3f5b2c1)`` or
 * ``average(a3f5b2c1, b9e2d104)`` where each ``[a-f0-9]{8}`` substring
 * is the short id of a source object (see ``patch_title_with_ids`` in
 * ``src/runtime/bootstrap.py``). This component parses such titles
 * and turns each *resolvable* hex id into a button that selects the
 * source object via :func:`useObjectNavigation`.
 *
 * Hex substrings that don't resolve to a real object (stale ids,
 * coincidental user titles) are left as plain text — no dead buttons.
 *
 * The raw ``title`` string is unchanged on the Python side: HDF5
 * round-trips, macros, notebooks and clipboard exports keep seeing
 * ``average(a3f5b2c1, b9e2d104)``. Interactivity is purely a render
 * concern.
 */
import { Fragment, useMemo } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useObjectNavigation } from "./ObjectNavigationContext";

interface Props {
  title: string;
  className?: string;
}

/** Match an isolated 8-char lowercase hex token (object short id) or a
 *  ``g``-prefixed 9-char group id (``g`` + 8 hex). ``\b`` keeps us from
 *  splitting longer hex words (long uuids, sha-prefixed strings…). The
 *  group alternative is tried first so a group id is never mis-read as a
 *  bare object id. */
const TOKEN_RE = /\b(?:g[a-f0-9]{8}|[a-f0-9]{8})\b/g;

export function TitleWithLinks({ title, className }: Props) {
  const nav = useObjectNavigation();

  const parts = useMemo<ReactNode[]>(() => {
    if (!nav || !title) {
      return [title];
    }
    const out: ReactNode[] = [];
    let cursor = 0;
    // ``matchAll`` returns the matches in order with their indices,
    // which is what we need to preserve the original ordering.
    for (const match of title.matchAll(TOKEN_RE)) {
      const token = match[0];
      const start = match.index ?? 0;
      if (start > cursor) {
        out.push(title.slice(cursor, start));
      }
      const isGroup = token.length === 9 && token.startsWith("g");
      const groupEntry = isGroup ? nav.lookupGroup(token) : null;
      const entry = isGroup ? null : nav.lookupOid(token);
      if (groupEntry) {
        const kindLabel = groupEntry.kind === "signal" ? "signal" : "image";
        const tooltip = `${groupEntry.name} · ${kindLabel}`;
        out.push(
          <button
            key={`gid-${start}-${token}`}
            type="button"
            className="title-oid-link"
            title={tooltip}
            aria-label={`Go to ${groupEntry.name}`}
            onClick={(e: MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              nav.navigateToGroup(token);
            }}
          >
            {token}
          </button>,
        );
      } else if (entry) {
        const sourceTitle = entry.node.title;
        const kindLabel = entry.kind === "signal" ? "signal" : "image";
        const tooltip = `${sourceTitle} · ${kindLabel}`;
        out.push(
          <button
            key={`oid-${start}-${token}`}
            type="button"
            className="title-oid-link"
            title={tooltip}
            aria-label={`Go to ${sourceTitle}`}
            onClick={(e: MouseEvent<HTMLButtonElement>) => {
              // Don't bubble into row click handlers (object tree
              // selects rows on plain click — clicking a hex link
              // should select the *source*, not the host row).
              e.stopPropagation();
              nav.navigateToOid(token);
            }}
          >
            {token}
          </button>,
        );
      } else {
        out.push(token);
      }
      cursor = start + token.length;
    }
    if (cursor < title.length) {
      out.push(title.slice(cursor));
    }
    return out;
  }, [nav, title]);

  return (
    <span className={className}>
      {parts.map((p, i) =>
        typeof p === "string" ? <Fragment key={i}>{p}</Fragment> : p,
      )}
    </span>
  );
}
