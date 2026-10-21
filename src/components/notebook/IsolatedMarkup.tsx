/**
 * Renders sanitised notebook markup (outputs, markdown cells) out of reach of
 * the rest of the application.
 *
 * The markup lives in a Shadow DOM, so its ``<style>`` rules only apply
 * inside the block. The wrapper of the shadow host has paint containment: it
 * is the containing block of ``position: fixed`` content and clips it, so
 * nothing the markup positions — even with a ``:host`` rule moving the host
 * itself — can cover the rest of the interface.
 */

import type { CSSProperties, ReactElement } from "react";
import { useLayoutEffect, useRef } from "react";

const BASE_CSS = "*, *::before, *::after { box-sizing: border-box; }";

const CONTAINED: CSSProperties = { contain: "paint", overflow: "auto" };

interface IsolatedMarkupProps {
  /** Markup sanitised by ``untrustedMarkup.ts``. */
  html: string;
  /** Trusted CSS applied to the markup, inside the Shadow DOM. */
  css?: string;
  className?: string;
  style?: CSSProperties;
}

export function IsolatedMarkup({
  html,
  css = "",
  className,
  style,
}: IsolatedMarkupProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${BASE_CSS}${css}</style>${html}`;
  }, [html, css]);
  return (
    <div className={className} style={{ ...style, ...CONTAINED }}>
      <div ref={hostRef} />
    </div>
  );
}
