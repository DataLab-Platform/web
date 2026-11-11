/**
 * Showcase scenarios generated for the application plugins (camera, pulse…
 * characterization): one per loaded application plugin.
 *
 * Plugins ship no showcase code. Each demo is derived from the contracts the
 * plugin already declares (see ``./applications_plan``): its application
 * info (name, description), its examples and the recipes (methods) they
 * target. The demo opens the Applications window from the menu bar, presents
 * the plugin, plays up to two examples the way a visitor would ("Try with
 * this example", parameter dialog, run), shows the objects and result
 * tables each method produced, and ends with an invitation to explore the
 * plugin's methods. A plugin without any example designed for a method only
 * gets its page and description.
 */

import { t } from "../i18n/translate";
import type { PluginRecord } from "../runtime/runtime";
import {
  isVisible,
  type ShowcaseContext,
  type ShowcaseScenario,
} from "./engine";
import {
  applicationName,
  describeObjects,
  newObjects,
  parseCreatedCount,
  planApplicationDemo,
  readingTime,
  type ApplicationDemoPlan,
  type ApplicationDemoStep,
  type WorkspaceObject,
} from "./applications_plan";
import {
  captionSideFor,
  closeApplicationsWindow,
  confirmButton,
  exampleRow,
  foldRecipeCards,
  modalCard,
  objectResults,
  openApplicationsWindow,
  openExampleConfirmation,
  openRecipeCard,
  recipeCard,
  resultsTab,
  selectApplication,
  showPanel,
  statusText,
  treeItem,
  treeItemId,
  visibleError,
  workspaceObjects,
} from "./applications_ui";

/** Plugins are listed shortly after the runtime is ready. */
const PLUGIN_WAIT_MS = 8_000;
/** Opening an example (generated or packaged data). */
const EXAMPLE_TIMEOUT_MS = 180_000;
/** Running a method in Pyodide (hundreds of shots, image stacks…). */
const RECIPE_TIMEOUT_MS = 300_000;

/** Explanations already given in the demo (not repeated per example). */
interface Told {
  outputs: boolean;
  diagnostics: boolean;
}

/** Scenario id of an application plugin, e.g.
 *  ``app:org.datalab.camera-characterization``. */
export function applicationScenarioId(record: PluginRecord): string {
  return `app:${record.info?.id ?? record.plugin_id ?? record.record_id}`.toLowerCase();
}

/** One scenario per loaded application plugin. */
export async function createApplicationScenarios(
  ctx: ShowcaseContext,
): Promise<ShowcaseScenario[]> {
  if (ctx.host.getPluginRecords().length === 0) {
    await ctx
      .waitFor(
        () => ctx.host.getPluginRecords().length > 0,
        PLUGIN_WAIT_MS,
        "the plugin list",
      )
      .catch(() => undefined);
  }
  return ctx.applications().map(applicationScenario);
}

function applicationScenario(record: PluginRecord): ShowcaseScenario {
  const id = applicationScenarioId(record);
  const name = applicationName(record);
  return {
    id,
    title: () => name,
    subtitle: () => t("Application plugin"),
    async run(ctx) {
      // The plugin may have been reloaded since the playlist was built.
      const latest =
        ctx.applications().find((item) => applicationScenarioId(item) === id) ??
        record;
      await playApplicationDemo(ctx, planApplicationDemo(latest));
    },
  };
}

async function playApplicationDemo(
  ctx: ShowcaseContext,
  plan: ApplicationDemoPlan,
): Promise<void> {
  const told: Told = { outputs: false, diagnostics: false };
  ctx.log(
    `${plan.name}: ${plan.steps.length} example(s)` +
      plan.steps
        .map((step) => ` ${step.example.id} → ${step.recipe.id}`)
        .join(","),
  );
  await ctx.say(
    t("Application plugins add complete measurement methods to DataLab."),
    2500,
  );
  const intro = plan.description
    ? `${plan.name} — ${plan.description}`
    : t("Application plugin: {name}", { name: plan.name });
  if (!plan.listed) {
    // Not listed by the Applications window: point at its menu entry.
    await ctx.spotlight(() => ctx.topMenu("Applications"));
    await ctx.say(intro, readingTime(intro));
    ctx.clearSpotlight();
    return;
  }

  let layer = await openApplicationsWindow(ctx);
  const card = await selectApplication(ctx, layer, plan);
  // Captions keep the title of the application page visible.
  const title = ctx.$(".application-title-row", layer) ?? card;
  await ctx.spotlight(card);
  await ctx.say(intro, readingTime(intro), captionSideFor(title));
  const methods = ctx.$(".application-accordion", layer);
  const page = ctx.$(".applications-content", layer);
  if (methods && page && isVisible(methods)) {
    await ctx.spotlight(page);
    await ctx.say(
      t(
        "Each method declares its expected inputs and its parameters, with examples to try it at once.",
      ),
      4000,
      captionSideFor(title),
    );
  }
  ctx.clearSpotlight();

  for (const [index, step] of plan.steps.entries()) {
    if (index > 0) {
      layer = await openApplicationsWindow(ctx);
      await selectApplication(ctx, layer, plan);
    }
    await playExample(ctx, layer, step, told);
  }

  if (plan.steps.length > 0) {
    layer = await openApplicationsWindow(ctx);
    await selectApplication(ctx, layer, plan);
  }
  // Folded method cards: the page lists every method of the plugin.
  await foldRecipeCards(ctx, layer);
  const catalog =
    ctx.visible(".application-accordion", layer) ??
    ctx.$(".applications-dialog", layer) ??
    layer;
  await ctx.spotlight(catalog);
  await ctx.say(
    t(
      "Explore its other methods and examples from the Applications menu, and try them on your own data.",
    ),
    5000,
    captionSideFor(catalog),
  );
  ctx.clearSpotlight();
  await closeApplicationsWindow(ctx);
}

/** Try ``step.example`` from its method card, then show what it produced. */
async function playExample(
  ctx: ShowcaseContext,
  layer: HTMLElement,
  step: ApplicationDemoStep,
  told: Told,
): Promise<void> {
  const { example, recipe } = step;
  const card = await ctx.find(() => recipeCard(ctx, layer, recipe.id), 10_000);
  await openRecipeCard(ctx, card);
  const row = await ctx.find(() => exampleRow(ctx, card, example.id), 10_000);
  row.scrollIntoView({ block: "nearest" });
  await ctx.spotlight(row);
  const about = t("Example: {title}", { title: example.title });
  const text = example.description
    ? `${about} — ${example.description}`
    : about;
  await ctx.say(text, readingTime(text), captionSideFor(row));
  const button = row.querySelector("button");
  if (!button) throw new Error(`The "${example.id}" example has no button`);
  await ctx.click(button);
  ctx.clearSpotlight();

  const loaded = await openExample(ctx, layer, step);
  const outputs = await runMethod(ctx, layer, step, loaded, told);
  await closeApplicationsWindow(ctx);
  await showOutputs(ctx, outputs, told);
  // No stale caption while the next step starts.
  ctx.clearCaption();
}

/** Wait for the example to open (confirming that it replaces the
 *  workspace) and present the parameter dialog of the method. Returns the
 *  example objects, or ``null`` when the method has no parameters (it then
 *  runs at once). */
async function openExample(
  ctx: ShowcaseContext,
  layer: HTMLElement,
  step: ApplicationDemoStep,
): Promise<WorkspaceObject[] | null> {
  for (;;) {
    const state = await ctx.waitFor(
      () => {
        const error = visibleError(ctx, layer);
        if (error) return { kind: "error" as const, error };
        const confirmation = openExampleConfirmation(ctx);
        if (confirmation)
          return { kind: "confirm" as const, card: confirmation };
        const inputs = modalCard(ctx, ".recipe-input-dialog");
        if (inputs) return { kind: "inputs" as const, card: inputs };
        const parameters = modalCard(ctx, ".dataset-dialog");
        if (parameters)
          return { kind: "parameters" as const, card: parameters };
        if (parseCreatedCount(statusText(layer)))
          return { kind: "done" as const };
        return null;
      },
      EXAMPLE_TIMEOUT_MS,
      `the "${step.example.id}" example to open`,
    );
    if (state.kind === "error") {
      throw new Error(
        `The "${step.example.id}" example failed: ${state.error}`,
      );
    }
    if (state.kind === "done") return null;
    if (state.kind === "confirm") {
      // The previous demo left objects: the example replaces them.
      await ctx.hold(700);
      await ctx.click(await ctx.find(() => confirmButton(state.card)));
      continue;
    }
    if (state.kind === "inputs") {
      // Examples bind their inputs; confirm the proposed assignment.
      const submit = await ctx.waitFor(
        () => {
          const button = confirmButton(state.card);
          return button && !button.disabled ? button : null;
        },
        10_000,
        "assignable example inputs",
      );
      await ctx.hold(1200);
      await ctx.click(submit);
      continue;
    }
    const loaded = await workspaceObjects(ctx);
    await ctx.checkpoint(
      loaded.length > 0,
      `the "${step.example.id}" example objects are created`,
    );
    const ok =
      [
        ...state.card.querySelectorAll<HTMLButtonElement>(".actions button"),
      ].find((button) =>
        [t("OK"), "OK"].includes((button.textContent ?? "").trim()),
      ) ?? confirmButton(state.card);
    if (!ok) throw new Error("The parameter dialog has no OK button");
    await ctx.spotlight(state.card);
    const text = t(
      "Example loaded: {objects}. The method “{title}” opens with parameters suited to this example.",
      { objects: describeObjects(loaded), title: step.recipe.title },
    );
    // Long parameter dialogs: the caption leaves the OK button visible.
    await ctx.say(text, readingTime(text), captionSideFor(ok));
    await ctx.click(ok);
    ctx.clearSpotlight();
    return loaded;
  }
}

/** Wait for the method to complete and return the objects it created. */
async function runMethod(
  ctx: ShowcaseContext,
  layer: HTMLElement,
  step: ApplicationDemoStep,
  loaded: WorkspaceObject[] | null,
  told: Told,
): Promise<WorkspaceObject[]> {
  const { recipe } = step;
  // The parameter dialog stays open ("Applying…") while the method runs.
  const running = modalCard(ctx, ".dataset-dialog")?.querySelector(".actions");
  const [created] = await Promise.all([
    ctx.waitFor(
      () => {
        const error = visibleError(ctx, layer);
        if (error) return { error };
        if (modalCard(ctx, ".dataset-dialog")) return null;
        const count = parseCreatedCount(statusText(layer));
        return count === null ? null : { count };
      },
      RECIPE_TIMEOUT_MS,
      `the "${recipe.title}" method to complete`,
    ),
    ctx.say(
      t(
        "The method runs right here, in the browser: Python and Sigima compiled to WebAssembly.",
      ),
      3500,
      captionSideFor(running ?? null),
    ),
  ]);
  if ("error" in created) {
    throw new Error(`The "${recipe.title}" method failed: ${created.error}`);
  }
  await ctx.checkpoint(
    created.count > 0,
    `the "${recipe.title}" method succeeded`,
  );

  let outputs: WorkspaceObject[];
  if (loaded) {
    outputs = newObjects(loaded, await workspaceObjects(ctx));
  } else {
    // No parameter dialog: the method ran before any snapshot, take the
    // outputs selected by the application.
    const all = await workspaceObjects(ctx);
    const selected = new Set(
      ctx
        .$$(".object-tree-item.selected")
        .map(treeItemId)
        .filter((id): id is string => id !== null),
    );
    outputs = all.filter((obj) => selected.has(obj.id));
  }
  await ctx.checkpoint(
    outputs.length > 0,
    `the "${recipe.title}" method created output objects`,
  );
  ctx.log(`${recipe.id}: ${outputs.map((obj) => obj.title).join(", ")}`);

  const status = ctx.$(".applications-status", layer);
  if (status) await ctx.spotlight(status);
  const text = t("Done — new objects created by the method: {objects}.", {
    objects: describeObjects(outputs),
  });
  await ctx.say(text, readingTime(text, 2500, 4000), captionSideFor(status));
  const diagnostics = ctx.visible(".applications-diagnostics", layer);
  if (diagnostics && !told.diagnostics) {
    told.diagnostics = true;
    await ctx.spotlight(diagnostics);
    await ctx.say(
      t("Its diagnostics explain every case it flagged."),
      3500,
      captionSideFor(diagnostics),
    );
  }
  ctx.clearSpotlight();
  return outputs;
}

/** Show the main output, its result tables and the other outputs. */
async function showOutputs(
  ctx: ShowcaseContext,
  outputs: WorkspaceObject[],
  told: Told,
): Promise<void> {
  // The application makes the main output (the one carrying the results,
  // or the first one) current after a method ran.
  const current = ctx.$(".object-tree-item.current");
  const currentId = current ? treeItemId(current) : null;
  const main = outputs.find((obj) => obj.id === currentId) ?? outputs[0];
  await showPanel(ctx, main.kind);
  const item = await ctx.find(() => treeItem(ctx, main.id), 10_000);
  await ctx.click(item);

  if (!told.outputs) {
    told.outputs = true;
    const group = item.closest(".object-tree-group");
    const outputIds = new Set(outputs.map((obj) => obj.id));
    const groupItems = group ? ctx.$$(".object-tree-item", group) : [];
    const onlyOutputs =
      groupItems.length > 0 &&
      groupItems.every((el) => outputIds.has(treeItemId(el) ?? ""));
    await ctx.spotlight(onlyOutputs && group ? group : item);
    await ctx.say(
      t(
        "The results are regular DataLab objects, ready for further processing.",
      ),
      3500,
    );
    ctx.clearSpotlight();
  }

  const plot = ctx.visible(".plot-area");
  if (plot) await ctx.spotlight(plot, 0);
  const mainText = t("Main result: “{title}”.", { title: main.title });
  await ctx.say(mainText, readingTime(mainText, 3000, 4500));
  ctx.clearSpotlight();

  const results = await objectResults(ctx, main);
  const tab = results.length > 0 ? resultsTab(ctx) : null;
  if (tab) {
    const previous = ctx.$(".side-panel-tab.active");
    await ctx.click(tab);
    const panel = await ctx.find(".results-panel", 5_000);
    await ctx.spotlight(panel.closest(".side-panel") ?? panel);
    const text = t("Its result table: {title}.", { title: results[0].title });
    await ctx.say(text, readingTime(text, 3500, 5000));
    ctx.clearSpotlight();
    if (previous && previous !== tab && isVisible(previous)) {
      await ctx.click(previous, { instant: true });
    }
  }

  const others = outputs.filter((obj) => obj.kind !== main.kind);
  if (others.length > 0) {
    const other = others[0];
    await showPanel(ctx, other.kind);
    await ctx.click(await ctx.find(() => treeItem(ctx, other.id), 10_000));
    if (plot) await ctx.spotlight(plot, 0);
    const text = t("Other outputs: {objects}, for example “{title}”.", {
      objects: describeObjects(others),
      title: other.title,
    });
    await ctx.say(text, readingTime(text, 3000, 4500));
    ctx.clearSpotlight();
  }
}
