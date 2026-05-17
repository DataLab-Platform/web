/**
 * Registry of bundled notebook templates surfaced by the **+ New
 * notebook** menu in :class:`NotebookPanel`. Each entry pairs a
 * stable id (used to wire the panel button) with a label /
 * description (shown in the menu) and a builder function that
 * returns a fresh :type:`NotebookModel` — new cell ids on every
 * call so opening the same template repeatedly never collides on
 * stored ids.
 */
import type { NotebookModel } from "../types";
import { buildQuickstartNotebook } from "./quickstart";
import { buildSignalImageProcessingNotebook } from "./signalImageProcessing";
import { buildProxyMethodsNotebook } from "./proxyMethods";

export interface NotebookTemplate {
  /** Stable id (kebab-case). Used by the imperative handle. */
  id: string;
  /** Short label rendered in the new-notebook menu. */
  label: string;
  /** One-line description shown below the label. */
  description: string;
  /** Build a fresh notebook for this template. */
  build: () => NotebookModel;
}

export const NOTEBOOK_TEMPLATES: NotebookTemplate[] = [
  {
    id: "quickstart",
    label: "Quickstart template",
    description: "Signal + moving average + publish to workspace",
    build: buildQuickstartNotebook,
  },
  {
    id: "signal-image-processing",
    label: "Signal & image processing",
    description: "Publish signal/image, run moving_average and FFT via proxy",
    build: buildSignalImageProcessingNotebook,
  },
  {
    id: "proxy-methods",
    label: "Proxy methods",
    description: "Inspect workspace and discover features via proxy",
    build: buildProxyMethodsNotebook,
  },
];

/**
 * Build the notebook for *id*, falling back to ``null`` when the id
 * is unknown so callers can decide how to recover.
 */
export function buildNotebookFromTemplate(id: string): NotebookModel | null {
  const tpl = NOTEBOOK_TEMPLATES.find((t) => t.id === id);
  return tpl ? tpl.build() : null;
}

export { buildQuickstartNotebook } from "./quickstart";
export { buildSignalImageProcessingNotebook } from "./signalImageProcessing";
export { buildProxyMethodsNotebook } from "./proxyMethods";
