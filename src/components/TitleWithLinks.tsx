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

/** Match an isolated 8-char lowercase hex token. ``\b`` keeps us from
 *  splitting longer hex words (long uuids, sha-prefixed strings…). */
const SHORT_ID_RE = /\b[a-f0-9]{8}\b/g;

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
    for (const match of title.matchAll(SHORT_ID_RE)) {
      const oid = match[0];
      const start = match.index ?? 0;
      if (start > cursor) {
        out.push(title.slice(cursor, start));
      }
      const entry = nav.lookupOid(oid);
      if (entry) {
        const sourceTitle = entry.node.title;
        const kindLabel = entry.kind === "signal" ? "signal" : "image";
        const tooltip = `${sourceTitle} · ${kindLabel}`;
        out.push(
          <button
            key={`oid-${start}-${oid}`}
            type="button"
            className="title-oid-link"
            title={tooltip}
            aria-label={`Go to ${sourceTitle}`}
            onClick={(e: MouseEvent<HTMLButtonElement>) => {
              // Don't bubble into row click handlers (object tree
              // selects rows on plain click — clicking a hex link
              // should select the *source*, not the host row).
              e.stopPropagation();
              nav.navigateToOid(oid);
            }}
          >
            {oid}
          </button>,
        );
      } else {
        out.push(oid);
      }
      cursor = start + oid.length;
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
