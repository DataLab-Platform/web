/**
 * Plan of the showcase demo generated for an application plugin.
 *
 * Plugins ship no showcase code: the demo is derived from the contracts they
 * already declare — the application info (name, description), the examples
 * and the recipes (methods) they target. This module holds the pure part of
 * the generator (no DOM), so that any application plugin gets a sensible
 * demo and the choices stay unit-tested.
 */

import { t } from "../i18n/translate";
import type {
  PluginExampleSummary,
  PluginRecipeSummary,
  PluginRecord,
} from "../runtime/runtime";

/** Examples played per application plugin (keeps a demo under ~2 min). */
export const MAX_DEMO_EXAMPLES = 2;

/** One example of the demo and the method run on it. */
export interface ApplicationDemoStep {
  example: PluginExampleSummary;
  /** One of the recipes the example targets, declared by the plugin. */
  recipe: PluginRecipeSummary;
}

export interface ApplicationDemoPlan {
  pluginId: string | null;
  name: string;
  description: string;
  /** Whether the Applications window lists the plugin (same rule as the
   *  window: a plugin ID and something to show). */
  listed: boolean;
  /** Examples to play, in declared order (empty: page and description
   *  only). */
  steps: ApplicationDemoStep[];
}

/** Object of the workspace, as listed by the runtime. */
export interface WorkspaceObject {
  id: string;
  kind: "signal" | "image";
  title: string;
}

/** Display name of an application plugin. */
export function applicationName(record: PluginRecord): string {
  return (
    record.info?.name ||
    record.name ||
    record.plugin_id ||
    record.record_id ||
    t("Application plugin")
  );
}

/**
 * Pick up to ``max`` examples designed for a recipe, in declared order (so
 * a plugin's first, "quickstart"-like example comes first). Each example
 * runs the first of its recipes not shown yet — the example's own method
 * unless an earlier example already showed it — so that the demo shows
 * several methods when it can; examples whose recipes were all shown only
 * fill the remaining places. Recipes the plugin does not declare are
 * ignored (the Applications window has no card for them).
 */
export function pickDemoSteps(
  recipes: readonly PluginRecipeSummary[],
  examples: readonly PluginExampleSummary[],
  max = MAX_DEMO_EXAMPLES,
): ApplicationDemoStep[] {
  const declared = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const candidates = examples
    .map((example) => ({
      example,
      recipes: example.recipe_ids
        .map((id) => declared.get(id))
        .filter((recipe): recipe is PluginRecipeSummary => !!recipe),
    }))
    .filter((candidate) => candidate.recipes.length > 0);
  const chosen = new Map<number, ApplicationDemoStep>();
  const shown = new Set<string>();
  candidates.forEach((candidate, index) => {
    if (chosen.size >= max) return;
    const recipe = candidate.recipes.find((item) => !shown.has(item.id));
    if (!recipe) return;
    shown.add(recipe.id);
    chosen.set(index, { example: candidate.example, recipe });
  });
  candidates.forEach((candidate, index) => {
    if (chosen.size >= max || chosen.has(index)) return;
    chosen.set(index, {
      example: candidate.example,
      recipe: candidate.recipes[0],
    });
  });
  return [...chosen.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, step]) => step);
}

/** What the demo of ``record`` shows, from its declared contracts only. */
export function planApplicationDemo(
  record: PluginRecord,
  max = MAX_DEMO_EXAMPLES,
): ApplicationDemoPlan {
  const { recipes, examples, tools } = record;
  const pluginId = record.plugin_id;
  const listed =
    pluginId !== null && recipes.length + examples.length + tools.length > 0;
  return {
    pluginId,
    name: applicationName(record),
    description: (record.info?.description ?? "").trim(),
    listed,
    steps: listed ? pickDemoSteps(recipes, examples, max) : [],
  };
}

/** Caption hold for ``text``: long enough to read it (scaled by the pace
 *  by the engine). */
export function readingTime(text: string, minMs = 2500, maxMs = 7000): number {
  return Math.round(Math.min(maxMs, Math.max(minMs, 1400 + 42 * text.length)));
}

/** Objects of ``after`` missing from ``before`` (same kind and ID). */
export function newObjects(
  before: readonly WorkspaceObject[],
  after: readonly WorkspaceObject[],
): WorkspaceObject[] {
  const known = new Set(before.map((obj) => `${obj.kind}:${obj.id}`));
  return after.filter((obj) => !known.has(`${obj.kind}:${obj.id}`));
}

/** "500 signals", "20 images and 1 signal"… (kinds in first-seen order). */
export function describeObjects(objects: readonly WorkspaceObject[]): string {
  const counts = new Map<WorkspaceObject["kind"], number>();
  for (const obj of objects)
    counts.set(obj.kind, (counts.get(obj.kind) ?? 0) + 1);
  const parts = [...counts.entries()].map(([kind, count]) => {
    if (kind === "signal") {
      return count === 1 ? t("1 signal") : t("{count} signals", { count });
    }
    return count === 1 ? t("1 image") : t("{count} images", { count });
  });
  return parts.length > 1
    ? t("{first} and {second}", { first: parts[0], second: parts[1] })
    : (parts[0] ?? "");
}

/** Number of objects reported by the Applications window status after a
 *  method ran (``"Created 5 objects"``, translated), or ``null``. */
export function parseCreatedCount(
  status: string | null | undefined,
): number | null {
  if (!status) return null;
  const template = t("Created {count} objects");
  const [before, after = ""] = template.split("{count}");
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escape(before)}(\\d+)${escape(after)}$`).exec(
    status.trim(),
  );
  return match ? Number(match[1]) : null;
}
