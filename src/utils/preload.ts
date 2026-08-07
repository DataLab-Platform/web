/**
 * Startup workspace preloading from the `?preload=` URL parameter.
 *
 * Used by documentation "use case" pages to deep-link into the app with a
 * demo workspace already loaded (e.g. `?preload=demos/spectroscopy.h5`).
 * The companion `?panel=` parameter (or, failing that, the content of the
 * loaded workspace) decides which panel the app lands on, so image-only
 * workspaces don't greet the user with an empty Signal panel.
 */

export type PreloadPanelKind = "signal" | "image";

/**
 * Resolve and validate the `?preload=` parameter of a query string.
 *
 * Only same-origin targets are allowed (relative URLs, or absolute URLs on
 * the same origin as `baseUrl`): the fetched bytes are handed to the Python
 * runtime, so arbitrary cross-origin sources must be rejected.
 *
 * @param search Query string (e.g. `window.location.search`).
 * @param baseUrl Base URL to resolve relative targets against
 *   (e.g. `document.baseURI`).
 * @returns The resolved URL, or `null` when the parameter is absent,
 *   unparsable, or not same-origin.
 */
export function resolvePreloadUrl(search: string, baseUrl: string): URL | null {
  const raw = new URLSearchParams(search).get("preload");
  if (!raw) return null;
  let base: URL;
  let target: URL;
  try {
    base = new URL(baseUrl);
    target = new URL(raw, base);
  } catch {
    return null;
  }
  if (target.origin !== base.origin) return null;
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  return target;
}

/** Derive a workspace filename from a preload URL (fallback: workspace.h5). */
export function preloadFilename(url: URL): string {
  const name = url.pathname.split("/").pop() ?? "";
  return name || "workspace.h5";
}

/**
 * Resolve the `?panel=` parameter of a query string (case-insensitive).
 * Unknown values are ignored.
 */
export function resolvePanelKind(search: string): PreloadPanelKind | null {
  const raw = new URLSearchParams(search).get("panel")?.toLowerCase();
  return raw === "signal" || raw === "image" ? raw : null;
}

/**
 * Panel the app should land on after preloading a workspace: the explicit
 * `?panel=` choice wins, otherwise the only non-empty panel (if any).
 */
export function preloadPanelKind(
  search: string,
  counts: { signals: number; images: number },
): PreloadPanelKind | null {
  const explicit = resolvePanelKind(search);
  if (explicit) return explicit;
  if (counts.images > 0 && counts.signals === 0) return "image";
  if (counts.signals > 0 && counts.images === 0) return "signal";
  return null;
}
