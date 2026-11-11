/**
 * DOM and runtime helpers of the generated application showcase scenarios:
 * the Applications window (plugin list, method cards, examples, status) and
 * the workspace objects created by a method.
 *
 * Hooks: ``.applications-window-layer`` and its ``[data-plugin-id]`` list
 * entries, ``.application-method[data-recipe-id]`` method cards and their
 * ``.application-method-example[data-example-id]`` rows, the
 * ``.applications-status`` line, and the ``#<id> ·`` meta line of the
 * object tree items.
 */

import { t } from "../i18n/translate";
import { isVisible, type SayOptions, type ShowcaseContext } from "./engine";
import type { ApplicationDemoPlan, WorkspaceObject } from "./applications_plan";

export const APPLICATIONS_LAYER = ".applications-window-layer";

/** Caption side leaving ``el`` visible: above it when it lies in the lower
 *  half of the window, below it otherwise. */
export function captionSideFor(el: Element | null): SayOptions {
  if (!el) return {};
  const rect = el.getBoundingClientRect();
  const middle = (rect.top + rect.bottom) / 2;
  return { position: middle > window.innerHeight / 2 ? "top" : "bottom" };
}

/** The open Applications window, if any. */
export function applicationsLayer(ctx: ShowcaseContext): HTMLElement | null {
  return ctx.visible(APPLICATIONS_LAYER);
}

/** Delay for the Applications window and its plugin list (listed by the
 *  Python runtime, which may still be busy, e.g. loading packages). */
const WINDOW_TIMEOUT_MS = 30_000;

/** Open the Applications window from its menu bar entry. */
export async function openApplicationsWindow(
  ctx: ShowcaseContext,
): Promise<HTMLElement> {
  if (!applicationsLayer(ctx)) await ctx.clickMenuPath("Applications");
  return ctx.waitFor(APPLICATIONS_LAYER, WINDOW_TIMEOUT_MS);
}

/** Close the Applications window with its close button. */
export async function closeApplicationsWindow(
  ctx: ShowcaseContext,
): Promise<void> {
  const layer = applicationsLayer(ctx);
  if (layer) {
    const close = ctx.$(".dialog-close-button", layer);
    if (close) await ctx.click(close);
    else await ctx.press("Escape");
  }
  await ctx.checkpoint(
    () => !applicationsLayer(ctx),
    "the Applications window is closed",
    10_000,
  );
}

function applicationEntry(
  ctx: ShowcaseContext,
  layer: HTMLElement,
  plan: ApplicationDemoPlan,
): HTMLElement | null {
  const entries = ctx.$$(".applications-list button", layer);
  return (
    entries.find(
      (entry) => entry.getAttribute("data-plugin-id") === plan.pluginId,
    ) ??
    entries.find(
      (entry) =>
        (entry.querySelector("strong")?.textContent ?? "").trim() === plan.name,
    ) ??
    null
  );
}

/** Select the plugin of ``plan`` in the Applications window (showing the
 *  application list first if it is hidden). Returns the window card. */
export async function selectApplication(
  ctx: ShowcaseContext,
  layer: HTMLElement,
  plan: ApplicationDemoPlan,
): Promise<HTMLElement> {
  const toggle = ctx.$(".applications-list-toggle", layer);
  if (toggle?.getAttribute("aria-expanded") === "false") {
    await ctx.click(toggle);
  }
  const entry = await ctx.find(
    () => applicationEntry(ctx, layer, plan),
    WINDOW_TIMEOUT_MS,
  );
  await ctx.click(entry);
  await ctx.waitFor(
    () =>
      entry.classList.contains("active") &&
      (ctx.$(".application-title-row h3", layer)?.textContent ?? "").trim() ===
        plan.name,
    WINDOW_TIMEOUT_MS,
    `the page of ${plan.name}`,
  );
  return ctx.$<HTMLElement>(".applications-dialog", layer) ?? layer;
}

/** Method card of ``recipeId`` in the Applications window. */
export function recipeCard(
  ctx: ShowcaseContext,
  layer: ParentNode,
  recipeId: string,
): HTMLDetailsElement | null {
  return (
    ctx
      .$$<HTMLDetailsElement>(".application-method", layer)
      .find((card) => card.getAttribute("data-recipe-id") === recipeId) ?? null
  );
}

/** Unfold a method card (the accordion folds the other ones). */
export async function openRecipeCard(
  ctx: ShowcaseContext,
  card: HTMLElement,
): Promise<void> {
  // Method cards are <details> elements.
  const details = card as HTMLDetailsElement;
  if (details.open) return;
  const summary = details.querySelector<HTMLElement>(":scope > summary");
  if (summary) await ctx.click(summary);
  if (!details.open) details.open = true;
  await ctx.waitFor(() => details.open, 5_000, "the method card to unfold");
}

/** Fold the open method cards, so that the window lists every method. */
export async function foldRecipeCards(
  ctx: ShowcaseContext,
  layer: ParentNode,
): Promise<void> {
  for (const card of ctx.$$<HTMLDetailsElement>(
    ".application-accordion > details[open]",
    layer,
  )) {
    const summary = card.querySelector<HTMLElement>(":scope > summary");
    if (summary) await ctx.click(summary);
    if (card.open) card.open = false;
  }
}

/** Row of ``exampleId`` in a method card. */
export function exampleRow(
  ctx: ShowcaseContext,
  card: ParentNode,
  exampleId: string,
): HTMLElement | null {
  return (
    ctx
      .$$(".application-method-example", card)
      .find((row) => row.getAttribute("data-example-id") === exampleId) ?? null
  );
}

/** Text of the Applications window status line, if shown. */
export function statusText(layer: ParentNode): string | null {
  const status = layer.querySelector(".applications-status");
  return isVisible(status) ? (status.textContent ?? "").trim() : null;
}

/** Error shown by the Applications window or by one of its dialogs. */
export function visibleError(
  ctx: ShowcaseContext,
  layer: ParentNode,
): string | null {
  const errors = [
    ...ctx.$$(".applications-dialog > .error", layer),
    ...ctx.$$('.overlay[role="dialog"] .error'),
  ];
  const error = errors.find(isVisible);
  return error ? (error.textContent ?? "").trim() || t("Error") : null;
}

/** Visible modal dialog whose card matches ``selector``. */
export function modalCard(
  ctx: ShowcaseContext,
  selector: string,
): HTMLElement | null {
  return (
    ctx
      .$$('.overlay[role="dialog"] > .card')
      .find((card) => isVisible(card) && card.matches(selector)) ?? null
  );
}

/** The "replace the workspace?" confirmation of the examples. */
export function openExampleConfirmation(
  ctx: ShowcaseContext,
): HTMLElement | null {
  return (
    ctx
      .$$('.overlay[role="dialog"] > .card')
      .find(
        (card) =>
          isVisible(card) &&
          !card.matches(".dataset-dialog, .recipe-input-dialog") &&
          (card.querySelector("h2")?.textContent ?? "").trim() ===
            t("Open example"),
      ) ?? null
  );
}

/** Last button of a dialog card (its confirm button). */
export function confirmButton(card: ParentNode): HTMLButtonElement | null {
  const buttons = card.querySelectorAll<HTMLButtonElement>(".actions button");
  return buttons[buttons.length - 1] ?? null;
}

/** Every signal and image of the workspace. */
export async function workspaceObjects(
  ctx: ShowcaseContext,
): Promise<WorkspaceObject[]> {
  const { runtime } = ctx.host;
  const [signals, images] = await Promise.all([
    runtime.listSignals(),
    runtime.listImages(),
  ]);
  return [
    ...signals.map((obj) => ({
      id: obj.id,
      kind: "signal" as const,
      title: obj.title,
    })),
    ...images.map((obj) => ({
      id: obj.id,
      kind: "image" as const,
      title: obj.title,
    })),
  ];
}

/** ID of an object tree item (from its ``#<id> · …`` meta line). */
export function treeItemId(item: Element): string | null {
  const meta = item.querySelector(".object-tree-meta")?.textContent ?? "";
  const match = /^#(\S+)/.exec(meta.trim());
  return match ? match[1] : null;
}

/** Object tree item of ``id`` (in the panel shown). */
export function treeItem(ctx: ShowcaseContext, id: string): HTMLElement | null {
  return (
    ctx.$$(".object-tree-item").find((item) => treeItemId(item) === id) ?? null
  );
}

/** Object tree tab of a panel kind. */
export function panelTabName(kind: WorkspaceObject["kind"]): string {
  return kind === "signal" ? "Signals" : "Images";
}

/** Show the Signals or Images panel. */
export async function showPanel(
  ctx: ShowcaseContext,
  kind: WorkspaceObject["kind"],
): Promise<void> {
  const name = panelTabName(kind);
  const tab = await ctx.find(() => ctx.tab(name), 5_000);
  if (tab.getAttribute("aria-selected") !== "true") {
    await ctx.click(tab);
    await ctx.waitFor(
      () => ctx.tab(name)?.getAttribute("aria-selected") === "true",
      10_000,
      `the ${name} panel`,
    );
  }
}

/** Analysis results attached to an object (result tables). */
export async function objectResults(
  ctx: ShowcaseContext,
  obj: WorkspaceObject,
): Promise<{ title: string }[]> {
  const { runtime } = ctx.host;
  return obj.kind === "signal"
    ? runtime.listSignalResults(obj.id)
    : runtime.listImageResults(obj.id);
}

/** The Results tab of the side panel. */
export function resultsTab(ctx: ShowcaseContext): HTMLElement | null {
  const label = t("Results");
  return (
    ctx
      .$$(".side-panel-tab")
      .find(
        (tab) =>
          isVisible(tab) &&
          (tab.querySelector(".side-panel-tab-label")?.textContent ?? "")
            .trim()
            .startsWith(label),
      ) ?? null
  );
}
