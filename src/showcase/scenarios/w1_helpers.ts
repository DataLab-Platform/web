/**
 * Helpers of the W1 showcase scenario (interactive imaging): the demo
 * workspace file, data-to-screen coordinates of Plotly plots and the
 * light/dark theme memento.
 */

import { getActiveLocale } from "../../i18n/locale";
import type { Point, ShowcaseContext } from "../engine";

const demoFiles = new Map<string, File>();

/** Bundled demo workspace (``public/demos/…``) as a ``File``, fetched once
 *  per page load (same-origin, browser cache). */
export async function demoFile(path: string): Promise<File> {
  const cached = demoFiles.get(path);
  if (cached) return cached;
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok) {
    throw new Error(`Cannot fetch the demo file ${path}: ${response.status}`);
  }
  const name = path.split("/").pop() || path;
  const file = new File([await response.arrayBuffer()], name);
  demoFiles.set(path, file);
  return file;
}

/**
 * Run ``action`` (e.g. a visible File menu walk) and answer the file
 * picker it opens with ``file``: a script cannot drive the native dialog,
 * so the first ``<input type="file">`` clicked meanwhile receives the file
 * and a ``change`` event, as if the visitor had picked it.
 */
export async function answerFilePicker(
  ctx: ShowcaseContext,
  file: File,
  action: () => Promise<void>,
  timeoutMs = 10_000,
): Promise<void> {
  const proto = HTMLInputElement.prototype;
  const nativeClick = proto.click;
  let picked = false;
  proto.click = function (this: HTMLInputElement): void {
    if (this.type !== "file" || picked) {
      nativeClick.call(this);
      return;
    }
    picked = true;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    this.files = transfer.files;
    window.setTimeout(() => {
      this.dispatchEvent(new Event("input", { bubbles: true }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
    }, 0);
  };
  try {
    await action();
    await ctx.waitFor(() => picked, timeoutMs, "the file picker to open");
  } finally {
    proto.click = nativeClick;
  }
}

interface PlotlyAxis {
  c2p(value: number): number;
  _offset?: number;
  _length?: number;
}

interface PlotlyGraph extends HTMLElement {
  _fullLayout?: { xaxis?: PlotlyAxis; yaxis?: PlotlyAxis };
}

function plotAxes(
  host: Element,
): { graph: PlotlyGraph; xa: PlotlyAxis; ya: PlotlyAxis } | null {
  const graph = host.querySelector<PlotlyGraph>(".js-plotly-plot");
  const layout = graph?._fullLayout;
  const xa = layout?.xaxis;
  const ya = layout?.yaxis;
  if (!graph || !xa || !ya || typeof xa.c2p !== "function") return null;
  if (typeof ya.c2p !== "function") return null;
  return { graph, xa, ya };
}

/** Viewport position of the data coordinates ``(x, y)`` in the Plotly plot
 *  hosted by ``host`` (inverse of the image plot's hover read-out). */
export function plotPoint(host: Element, x: number, y: number): Point {
  const axes = plotAxes(host);
  if (!axes) throw new Error("The plot has no axes yet");
  const rect = axes.graph.getBoundingClientRect();
  return {
    x: rect.left + (axes.xa._offset ?? 0) + axes.xa.c2p(x),
    y: rect.top + (axes.ya._offset ?? 0) + axes.ya.c2p(y),
  };
}

/** Wait until the Plotly plot of ``selector`` has axes and a stable size
 *  (a layout change, such as the cross profiles grid, resizes it). */
export async function waitForStablePlot(
  ctx: ShowcaseContext,
  selector: string,
  timeoutMs = 10_000,
): Promise<HTMLElement> {
  let last = "";
  let stableSince = 0;
  return ctx.waitFor(
    () => {
      const host = ctx.visible(selector);
      const axes = host ? plotAxes(host) : null;
      if (!host || !axes) return null;
      const rect = axes.graph.getBoundingClientRect();
      const key = [
        rect.left,
        rect.top,
        rect.width,
        rect.height,
        axes.xa._length,
        axes.ya._length,
      ].join();
      const now = Date.now();
      if (key !== last) {
        last = key;
        stableSince = now;
        return null;
      }
      return now - stableSince >= 250 ? host : null;
    },
    timeoutMs,
    `a stable plot in ${selector}`,
  );
}

/** Format ``value`` for a caption, in the UI language. */
export function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat(getActiveLocale(), {
    maximumFractionDigits: digits,
  }).format(value);
}

// -- Theme --------------------------------------------------------------------

const THEME_KEY = "datalab-web:theme";

/** Theme to restore at the end of the demo: the displayed palette and the
 *  stored preference (``null`` = follow the system). */
export interface ThemeMemento {
  theme: string | null;
  stored: string | null;
}

export function currentTheme(): string | null {
  return document.documentElement.getAttribute("data-theme");
}

export function rememberTheme(): ThemeMemento {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(THEME_KEY);
  } catch {
    // localStorage unavailable: nothing to restore.
  }
  return { theme: currentTheme(), stored };
}

/** Put the visitor's theme back (immediately, whatever happened): the
 *  toggle button if the palette differs, then the stored preference. */
export function restoreTheme(memento: ThemeMemento): void {
  if (currentTheme() !== memento.theme) {
    document.querySelector<HTMLElement>(".menubar-theme-toggle")?.click();
  }
  try {
    if (memento.stored === null) window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, memento.stored);
  } catch {
    // localStorage unavailable.
  }
}
