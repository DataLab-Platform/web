/**
 * Active-plot registry powering the AI Assistant's ``capture_view`` tool.
 *
 * Each visible Plotly graph (signal or image) registers its underlying
 * ``graphDiv`` element here on mount via :func:`registerActivePlot` and
 * unregisters it on unmount. The AI tool then resolves the active plot
 * by panel kind (or falls back to whichever plot was most recently
 * registered) and asks Plotly to render it as a PNG via ``Plotly.toImage``.
 *
 * The registry intentionally lives outside React state so it can be
 * read from the controller / tool layer without prop drilling.
 *
 * Cross-reference: ``DataLab/datalab/aiassistant/tools/builtin.py`` —
 * ``_tool_capture_view``.
 */

import type { PanelKind } from "../runtime/runtime";

export type { PanelKind };

/** Minimal subset of the Plotly module surface we depend on. */
interface PlotlyModule {
  toImage: (
    gd: HTMLElement,
    opts: {
      format?: "png" | "jpeg" | "svg" | "webp";
      width?: number;
      height?: number;
      scale?: number;
    },
  ) => Promise<string>;
}

interface RegistryEntry {
  gd: HTMLElement;
  /** Higher = more recently registered; used to resolve the "current"
   *  plot when the panel kind is ambiguous. */
  seq: number;
}

const REGISTRY: Map<PanelKind, RegistryEntry> = new Map();
let SEQ = 0;

/** Register the active graphDiv for a panel. Pass ``null`` to clear. */
export function registerActivePlot(
  kind: PanelKind,
  gd: HTMLElement | null,
): void {
  if (gd === null) {
    REGISTRY.delete(kind);
    return;
  }
  SEQ += 1;
  REGISTRY.set(kind, { gd, seq: SEQ });
}

/** Returns the most-recently-registered panel kind, or ``null`` when no
 *  plot is currently mounted. Useful as a "current panel" hint. */
export function getMostRecentPanel(): PanelKind | null {
  let best: { kind: PanelKind; seq: number } | null = null;
  for (const [kind, entry] of REGISTRY) {
    if (best === null || entry.seq > best.seq) {
      best = { kind, seq: entry.seq };
    }
  }
  return best?.kind ?? null;
}

/** Resolve the graphDiv to capture for ``kind`` (or the most recent
 *  one when ``kind`` is omitted). Returns ``null`` when nothing is
 *  available. */
export function resolveGraphDiv(kind?: PanelKind): HTMLElement | null {
  if (kind) {
    return REGISTRY.get(kind)?.gd ?? null;
  }
  const recent = getMostRecentPanel();
  return recent ? (REGISTRY.get(recent)?.gd ?? null) : null;
}

/** Render the resolved graphDiv as a PNG data URL via ``Plotly.toImage``.
 *
 *  We rely on the global ``window.Plotly`` populated by react-plotly.js
 *  (which itself imports the ``plotly.js`` bundle). When the registry
 *  is empty or Plotly is unavailable, a descriptive error is thrown so
 *  the AI tool surfaces a clean error message back to the LLM.
 */
export async function capturePlotPng(opts: {
  panel?: PanelKind;
  width?: number;
  height?: number;
  scale?: number;
}): Promise<{
  panel: PanelKind;
  pngBase64: string;
  dataUrl: string;
  width: number;
  height: number;
}> {
  const targetKind = opts.panel ?? getMostRecentPanel();
  if (!targetKind) {
    throw new Error(
      "No plot is currently mounted — open a signal or image first.",
    );
  }
  const gd = REGISTRY.get(targetKind)?.gd ?? null;
  if (!gd) {
    throw new Error(`No '${targetKind}' plot is currently mounted.`);
  }
  const Plotly = (window as unknown as { Plotly?: PlotlyModule }).Plotly;
  if (!Plotly?.toImage) {
    throw new Error(
      "Plotly is not available in the current page — cannot capture view.",
    );
  }
  const width = opts.width ?? (gd.clientWidth || 800);
  const height = opts.height ?? (gd.clientHeight || 600);
  const dataUrl = await Plotly.toImage(gd, {
    format: "png",
    width,
    height,
    scale: opts.scale ?? 1,
  });
  // ``toImage`` returns ``data:image/png;base64,…``; isolate the payload
  // so callers can choose between the data URL (for HTML rendering) and
  // the raw base64 (e.g. for direct upload).
  const comma = dataUrl.indexOf(",");
  const pngBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return { panel: targetKind, pngBase64, dataUrl, width, height };
}

/** Test-only escape hatch: empty the registry between specs. */
export function _resetRegistryForTests(): void {
  REGISTRY.clear();
  SEQ = 0;
}
