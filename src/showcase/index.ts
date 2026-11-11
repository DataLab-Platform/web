/**
 * Showcase scenario registry: the native scenarios (``./scenarios``) with
 * one generated scenario per application plugin (``./applications``)
 * interleaved — w1, first application, w2, second application, w3…
 */

import { createApplicationScenarios } from "./applications";
import type { ShowcaseContext, ShowcaseScenario } from "./engine";
import { NATIVE_SCENARIOS } from "./scenarios";

export { NATIVE_SCENARIOS };

/** ``native[0], extra[0], native[1], extra[1], …`` then the remainder. */
export function interleave<T>(native: T[], extra: T[]): T[] {
  const result: T[] = [];
  for (let i = 0; i < Math.max(native.length, extra.length); i++) {
    if (i < native.length) result.push(native[i]);
    if (i < extra.length) result.push(extra[i]);
  }
  return result;
}

/** Every available scenario, in playing order. */
export async function getShowcaseScenarios(
  ctx: ShowcaseContext,
): Promise<ShowcaseScenario[]> {
  return interleave(NATIVE_SCENARIOS, await createApplicationScenarios(ctx));
}

/** Keep the scenarios whose id is in ``ids`` (all when ``null``), in
 *  registry order; ``unknown`` lists the ids matching no scenario. */
export function selectScenarios(
  all: ShowcaseScenario[],
  ids: string[] | null,
): { scenarios: ShowcaseScenario[]; unknown: string[] } {
  if (!ids) return { scenarios: all, unknown: [] };
  const wanted = new Set(ids.map((id) => id.toLowerCase()));
  const known = new Set(all.map((scenario) => scenario.id.toLowerCase()));
  return {
    scenarios: all.filter((scenario) => wanted.has(scenario.id.toLowerCase())),
    unknown: ids.filter((id) => !known.has(id.toLowerCase())),
  };
}
