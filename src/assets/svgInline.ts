/**
 * Inline an SVG source string as a ``data:`` URL.
 *
 * The icon registries import their SVGs as raw text (Vite ``query: "?raw"``)
 * instead of as separate asset URLs (``query: "?url"``). Returning a
 * ``data:image/svg+xml`` URL lets the menu ``<img>`` tags render every icon
 * straight from the JS bundle — no per-icon HTTP request when a large menu
 * (Operations, Create, Processing…) opens.
 *
 * ``encodeURIComponent`` is used rather than base64: it keeps the payload
 * smaller for text-based SVG and escapes the ``#`` characters found in inline
 * ``fill``/``stroke`` colours, which would otherwise truncate the URL.
 */
export function svgToDataUrl(raw: string): string {
  return `data:image/svg+xml,${encodeURIComponent(raw)}`;
}
