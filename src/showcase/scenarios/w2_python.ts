import { EditorView } from "@codemirror/view";
import { t } from "../../i18n/translate";
import {
  getMaxEntries,
  listRecent,
  removeRecent,
  setMaxEntries,
  type RecentKind,
} from "../../storage/recentStore";
import {
  isVisible,
  type ShowcaseContext,
  type ShowcaseScenario,
} from "../engine";
import { waitForKernel } from "./w2_kernel";

/**
 * W2 — Python in the browser: notebooks & macros.
 *
 * A new notebook gets a Markdown cell and two code cells typed on screen
 * (a chirp pushed to the Signals panel through ``proxy``, then its NumPy
 * spectrum); a new macro then creates noisy signals and averages them with
 * DataLab's own processing, through the same ``proxy`` API as DataLab
 * desktop macros. The notebook and the macro created by the demo are
 * closed at the end and removed from the "Recent…" cache, so that loops
 * never pile up tabs or pollute the user's recent documents.
 */

/** Typing pace of the code (characters per second at speed 1). */
const CODE_CPS = 21;
/** Kernel boot while the demo plays (e.g. after a workspace was opened). */
const KERNEL_RUN_TIMEOUT_MS = 90_000;
/** A notebook cell or a macro run (the macro worker may still boot). */
const RUN_TIMEOUT_MS = 120_000;

// -- Code typed on screen ----------------------------------------------------

function markdownSource(): string {
  return [
    `## ${t("Chirp analysis")}`,
    t("NumPy runs in this tab; the results go to DataLab."),
  ].join("\n");
}

function chirpCell(): string {
  return [
    "import numpy as np",
    "",
    "t = np.linspace(0, 1, 2000)",
    "chirp = np.sin(2 * np.pi * (5 + 40 * t) * t)",
    'await proxy.add_signal("Chirp", t, chirp)',
    `print(f"{chirp.size} ${t("samples")}")`,
  ].join("\n");
}

function spectrumCell(): string {
  return [
    "f = np.fft.rfftfreq(t.size, t[1] - t[0])",
    "spectrum = np.abs(np.fft.rfft(chirp))",
    `await proxy.add_signal("${spectrumTitle()}", f, spectrum)`,
    "band = f[spectrum > spectrum.max() / 2]",
    `print(f"${t("Band")}: {band.min():.0f}-{band.max():.0f} Hz")`,
  ].join("\n");
}

function spectrumTitle(): string {
  return t("Chirp spectrum");
}

function macroSource(): string {
  return [
    "import numpy as np",
    "",
    "x = np.linspace(-5, 5, 500)",
    "ids = []",
    "for i in range(1, 6):",
    "    y = np.exp(-x**2) + np.random.normal(0, 0.2, x.size)",
    `    ids.append(await proxy.add_signal(f"${t("Noisy")} {i}", x, y))`,
    'avg = await proxy.calc("average", sources=ids)',
    "await proxy.select_objects([ids[0]] + avg)",
    "xy = await proxy.get_signal_xy(avg[0])",
    'noise = np.std(np.array(xy["y"]) - np.exp(-x**2))',
    `print(f"${t("Noise")}: 0.20 -> {noise:.2f}")`,
  ].join("\n");
}

// -- DOM helpers ---------------------------------------------------------------

/** Visible button of ``scope`` whose tooltip is ``title``. */
function buttonByTitle(
  ctx: ShowcaseContext,
  scope: string,
  title: string,
): () => HTMLElement | null {
  return () =>
    ctx
      .$$<HTMLButtonElement>(`${scope} button`)
      .find((button) => button.title === title && isVisible(button)) ?? null;
}

function enabled(button: HTMLElement | null): HTMLElement | null {
  return button && !(button as HTMLButtonElement).disabled ? button : null;
}

function treeTitles(ctx: ShowcaseContext): string[] {
  return ctx
    .$$(".object-tree-item .object-tree-title")
    .map((el) => (el.textContent ?? "").trim());
}

function treeItem(ctx: ShowcaseContext, title: string): HTMLElement | null {
  return (
    ctx
      .$$(".object-tree-item")
      .find(
        (item) =>
          (
            item.querySelector(".object-tree-title")?.textContent ?? ""
          ).trim() === title,
      ) ?? null
  );
}

function viewActive(ctx: ShowcaseContext, name: string): boolean {
  return ctx.tab(name)?.getAttribute("aria-selected") === "true";
}

function editorView(el: Element | null): EditorView | null {
  const editor = el?.closest(".cm-editor") ?? el?.querySelector(".cm-editor");
  return editor ? EditorView.findFromDOM(editor as HTMLElement) : null;
}

/** Click the confirmation button of the modal confirm dialog. */
async function confirmModal(
  ctx: ShowcaseContext,
  label: string,
): Promise<void> {
  const button = await ctx.find(() => {
    const dialog = ctx.visible('.overlay[role="dialog"]');
    return dialog
      ? (ctx
          .$$(".actions button", dialog)
          .find((b) => (b.textContent ?? "").trim() === label) ?? null)
      : null;
  }, 5_000);
  await ctx.click(button);
}

/** Close a notebook or macro tab (with its confirmation) through the UI. */
async function closeTab(
  ctx: ShowcaseContext,
  tab: HTMLElement,
  closeSelector: string,
): Promise<void> {
  if (!tab.isConnected) return;
  await ctx.click(() => tab.querySelector<HTMLElement>(closeSelector), {
    instant: true,
  });
  await confirmModal(ctx, t("Close"));
  await ctx.waitFor(() => !tab.isConnected, 10_000, "the tab to close");
}

// -- Clean-up without the showcase context (also after an abort) ---------------

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function poll<T>(probe: () => T | null, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value || Date.now() >= deadline) return value;
    await pause(50);
  }
}

/** Close ``tab`` with plain DOM clicks (no pointer, no abort check). */
async function forceCloseTab(
  tab: HTMLElement | null,
  closeSelector: string,
): Promise<void> {
  const close = tab?.isConnected
    ? tab.querySelector<HTMLElement>(closeSelector)
    : null;
  if (!tab || !close) return;
  close.click();
  const confirm = await poll(() => {
    const dialog = document.querySelector('.overlay[role="dialog"]');
    return (
      [
        ...(dialog?.querySelectorAll<HTMLElement>(".actions button") ?? []),
      ].find((b) => (b.textContent ?? "").trim() === t("Close")) ?? null
    );
  }, 3_000);
  confirm?.click();
  await poll(() => (tab.isConnected ? null : true), 3_000);
}

/**
 * Keep the cross-workspace "Recent…" cache of notebooks and macros as it
 * was: the cap is raised meanwhile (no user entry is evicted) and the
 * entries recorded by the demo are removed by the returned function.
 */
async function guardRecentCache(): Promise<() => Promise<void>> {
  const kinds: RecentKind[] = ["notebook", "macro"];
  const known = new Map<RecentKind, Set<string>>();
  const caps = new Map<RecentKind, number>();
  try {
    for (const kind of kinds) {
      const entries = await listRecent(kind);
      known.set(kind, new Set(entries.map((entry) => entry.id)));
      caps.set(kind, getMaxEntries(kind));
      setMaxEntries(kind, getMaxEntries(kind) + 20);
    }
  } catch (error) {
    console.warn("[showcase:w2] recent cache unavailable", error);
  }
  return async () => {
    for (const [kind, ids] of known) {
      try {
        for (const entry of await listRecent(kind)) {
          if (!ids.has(entry.id)) await removeRecent(kind, entry.id);
        }
      } catch (error) {
        console.warn("[showcase:w2] recent cache clean-up failed", error);
      }
    }
    for (const [kind, cap] of caps) setMaxEntries(kind, cap);
  };
}

// -- Notebook steps ----------------------------------------------------------------

const NB_TOOLBAR = ".nb-panel .nb-toolbar";

function activeCell(ctx: ShowcaseContext): HTMLElement | null {
  return ctx.visible(".nb-cell.nb-cell-active");
}

/** Run the active code cell from the toolbar; resolves once it is done. */
async function runActiveCell(ctx: ShowcaseContext): Promise<HTMLElement> {
  const cell = await ctx.find(() => activeCell(ctx));
  // Disabled while the kernel boots or runs another cell.
  const run = await ctx.find(
    () =>
      enabled(
        buttonByTitle(ctx, NB_TOOLBAR, t("Run active cell (Ctrl+Enter)"))(),
      ),
    RUN_TIMEOUT_MS,
  );
  await ctx.click(run);
  await ctx.checkpoint(
    () =>
      /^\[\d+\]:$/.test(
        (cell.querySelector(".nb-cell-prompt")?.textContent ?? "").trim(),
      ) && !cell.classList.contains("nb-cell-running"),
    "the notebook cell runs to completion",
    RUN_TIMEOUT_MS,
  );
  await ctx.checkpoint(
    () =>
      !cell.classList.contains("nb-cell-error") &&
      !cell.querySelector(".nb-output-stderr, .nb-output-error"),
    "the notebook cell runs without error",
  );
  return cell;
}

/** Type ``source`` in a new code cell (below the active one). */
async function typeNewCodeCell(
  ctx: ShowcaseContext,
  source: string,
): Promise<void> {
  const before = ctx.$$(".nb-panel .nb-cell").length;
  await ctx.click(buttonByTitle(ctx, NB_TOOLBAR, t("Insert code cell below")));
  await ctx.waitFor(
    () =>
      ctx.$$(".nb-panel .nb-cell").length > before &&
      activeCell(ctx)?.classList.contains("nb-cell-code"),
    5_000,
    "a new code cell",
  );
  await ctx.type(
    ".nb-cell.nb-cell-active .nb-cell-editor .cm-content",
    source,
    CODE_CPS,
  );
}

/** The cell's stdout, once the central view shows the notebook again. */
async function showCellOutput(
  ctx: ShowcaseContext,
  cell: HTMLElement,
  expected: string,
): Promise<void> {
  if (!viewActive(ctx, "Notebooks")) await ctx.clickTab("Notebooks");
  const output = await ctx.find(
    () => cell.querySelector<HTMLElement>(".nb-output-stdout"),
    10_000,
  );
  await ctx.checkpoint(
    () => (output.textContent ?? "").includes(expected),
    `the cell prints "${expected}"`,
    10_000,
  );
  output.scrollIntoView({ block: "nearest" });
  await ctx.spotlight(output);
}

/** After a cell or a macro pushed an object, DataLab shows its plot. */
async function showPlotOf(ctx: ShowcaseContext, title: string): Promise<void> {
  await ctx.checkpoint(
    () => treeItem(ctx, title),
    `"${title}" is listed in the Signals panel`,
    10_000,
  );
  if (!viewActive(ctx, "Plot")) await ctx.clickTab("Plot");
}

// -- Scenario -----------------------------------------------------------------------

export const w2Python: ShowcaseScenario = {
  id: "w2",
  title: () => t("Python in the browser: notebooks & macros"),
  subtitle: () => t("Notebooks and macros running Python in WebAssembly"),

  async prewarm(ctx) {
    await waitForKernel(ctx);
  },

  async run(ctx) {
    const restoreRecentCache = await guardRecentCache();
    let notebookTab: HTMLElement | null = null;
    let macroTab: HTMLElement | null = null;
    try {
      await ctx.say(
        t(
          "Real CPython, NumPy and SciPy, compiled to WebAssembly, run in this browser tab.",
        ),
        3200,
      );

      // -- Notebook --------------------------------------------------------
      await ctx.clickTab("Notebooks");
      await ctx.waitFor(".nb-panel .nb-toolbar", 10_000);
      // Normally warm (see prewarm), unless a workspace was opened since.
      const kernel = waitForKernel(ctx, KERNEL_RUN_TIMEOUT_MS).then(
        () => null,
        (error: unknown) => error,
      );
      await ctx.say(
        t("Jupyter-like notebooks, with a Python kernel running locally."),
      );
      const kernelError = await kernel;
      if (kernelError) throw kernelError;
      const tabsBefore = ctx.$$(".nb-panel .nb-tab");
      await ctx.click(".nb-panel .nb-tab-new");
      await ctx.click(
        () => ctx.visible(".nb-new-menu .nb-open-menu-name"),
        // "Empty notebook" is the first entry of the menu.
      );
      notebookTab = await ctx.waitFor(
        () =>
          ctx
            .$$(".nb-panel .nb-tab.active")
            .find((tab) => !tabsBefore.includes(tab)) ?? null,
        15_000,
        "the new notebook",
      );
      // A new notebook has no active cell yet: click into its first cell.
      await ctx.click(() => ctx.visible(".nb-panel .nb-cell"));
      await ctx.waitFor(
        () => activeCell(ctx)?.classList.contains("nb-cell-code"),
        5_000,
        "the first cell of the new notebook",
      );

      // Markdown cell: convert the first cell, type, render (Ctrl+Enter).
      await ctx.click(
        buttonByTitle(
          ctx,
          NB_TOOLBAR,
          t("Convert active cell between code and markdown"),
        ),
      );
      await ctx.waitFor(
        ".nb-cell.nb-cell-active.nb-cell-markdown .cm-content",
        5_000,
      );
      await ctx.type(
        ".nb-cell.nb-cell-active.nb-cell-markdown .cm-content",
        markdownSource(),
        CODE_CPS,
      );
      await ctx.press(
        "Control+Enter",
        ".nb-cell.nb-cell-active.nb-cell-markdown .cm-content",
      );
      await ctx.checkpoint(
        () =>
          ctx.$(
            ".nb-cell.nb-cell-active.nb-cell-markdown .nb-cell-markdown-rendered",
          ),
        "the Markdown cell is rendered",
        5_000,
      );
      await ctx.hold(1500);

      // Code cell 1: a chirp, pushed to the Signals panel.
      await typeNewCodeCell(ctx, chirpCell());
      await ctx.hold(500);
      const chirp = await runActiveCell(ctx);
      await showPlotOf(ctx, "Chirp");
      await ctx.spotlight(() => treeItem(ctx, "Chirp"));
      await ctx.say(
        t("One call to proxy.add_signal and the chirp is a DataLab signal."),
        3000,
      );
      ctx.clearSpotlight();
      await showCellOutput(ctx, chirp, `2000 ${t("samples")}`);
      await ctx.hold(2000);
      ctx.clearSpotlight();

      // Code cell 2: its spectrum, computed with NumPy.
      await typeNewCodeCell(ctx, spectrumCell());
      await ctx.hold(500);
      const spectrum = await runActiveCell(ctx);
      await showPlotOf(ctx, spectrumTitle());
      await ctx.spotlight(".plot-area");
      await ctx.say(
        t("A NumPy FFT, computed in the browser and plotted by DataLab."),
        3000,
      );
      ctx.clearSpotlight();
      await showCellOutput(ctx, spectrum, `${t("Band")}:`);
      await ctx.say(t("Cell outputs show up below each cell, as in Jupyter."));
      ctx.clearSpotlight();

      // -- Macro -------------------------------------------------------------
      await ctx.clickTab("Macros");
      await ctx.waitFor(".macro-panel .macro-toolbar", 10_000);
      await ctx.say(
        t("Macros use the same proxy API as DataLab desktop macros."),
      );
      const macroTabsBefore = ctx.$$(".macro-panel .macro-tab");
      await ctx.click(".macro-panel .macro-tab-new");
      // "Blank macro" is the first entry of the menu.
      await ctx.click(() => ctx.visible(".macro-tab-new-menu-item"));
      macroTab = await ctx.waitFor(
        () =>
          ctx
            .$$(".macro-panel .macro-tab.active")
            .find((tab) => !macroTabsBefore.includes(tab)) ?? null,
        15_000,
        "the new macro",
      );
      // A blank macro starts from a sample: select it all, then delete it.
      const editor = ".macro-panel .macro-editor .cm-content";
      await ctx.click(editor);
      await ctx.press("Control+a", editor);
      await ctx.hold(500);
      await ctx.press("Delete", editor);
      const view = editorView(ctx.$(editor));
      if (view && view.state.doc.length > 0) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: "" },
        });
      }
      await ctx.type(editor, macroSource(), CODE_CPS);
      await ctx.hold(500);
      const run = ".macro-panel .macro-toolbar .macro-btn.primary";
      await ctx.click(run);
      const noise = `${t("Noise")}: 0.20 ->`;
      await ctx.checkpoint(
        () =>
          ctx
            .$$(".macro-panel .macro-console-line.stdout")
            .some((line) => (line.textContent ?? "").includes(noise)) &&
          !(ctx.$(run) as HTMLButtonElement | null)?.disabled,
        "the macro averages the noisy signals",
        RUN_TIMEOUT_MS,
      );
      await ctx.checkpoint(
        () =>
          treeTitles(ctx).filter((title) => title.startsWith(t("Noisy")))
            .length === 5 &&
          treeTitles(ctx).some((title) => title.startsWith("µ(")),
        "the noisy signals and their average are in the Signals panel",
        10_000,
      );
      if (!viewActive(ctx, "Plot")) await ctx.clickTab("Plot");
      await ctx.spotlight(".plot-area");
      await ctx.say(
        t(
          "Five noisy signals, averaged by DataLab's own processing: the noise drops.",
        ),
        4000,
      );
      ctx.clearSpotlight();
      await ctx.clickTab("Macros");
      const consoleBox = await ctx.find(".macro-panel .macro-console-wrap");
      await ctx.spotlight(consoleBox);
      await ctx.say(t("The console streams the macro output."), 3200);
      ctx.clearSpotlight();

      // -- Tidy up -----------------------------------------------------------
      await closeTab(ctx, macroTab, ".macro-tab-close");
      await ctx.clickTab("Notebooks", { instant: true });
      await closeTab(ctx, notebookTab, ".nb-tab-close");
      await ctx.clickTab("Plot");
      await ctx.say(
        t("The same Python scripts run in DataLab Web and in DataLab desktop."),
        3500,
      );
    } finally {
      ctx.clearSpotlight();
      await forceCloseTab(macroTab, ".macro-tab-close");
      await forceCloseTab(notebookTab, ".nb-tab-close");
      // Let the debounced autosaves land before cleaning the cache.
      await pause(1_500);
      await restoreRecentCache();
    }
  },
};
