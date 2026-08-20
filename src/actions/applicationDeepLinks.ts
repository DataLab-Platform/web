import type { PluginExampleOpenResult, RuntimeApi } from "../runtime/runtime";
import {
  type ApplicationDeepLinkMismatch,
  type ApplicationDeepLinkRequest,
} from "../utils/applicationDeepLink";

export type ApplicationDeepLinkOpenResult =
  | { kind: "unsupported"; pluginId: string }
  | { kind: "unverified"; pluginId: string; status: string }
  | { kind: "mismatch"; mismatch: ApplicationDeepLinkMismatch }
  | {
      kind: "opened";
      pluginId: string;
      recipeId: string;
      example: PluginExampleOpenResult;
    };

function mismatch(
  field: ApplicationDeepLinkMismatch["field"],
  requested: string,
  bundled: string,
): ApplicationDeepLinkOpenResult {
  return { kind: "mismatch", mismatch: { field, requested, bundled } };
}

/** Validate and open one application example already bundled in DataLab-Web. */
export async function openBundledApplicationDeepLink(
  runtime: RuntimeApi,
  request: ApplicationDeepLinkRequest,
): Promise<ApplicationDeepLinkOpenResult> {
  const record = (await runtime.listPlugins()).find(
    (candidate) =>
      candidate.plugin_id === request.pluginId &&
      candidate.source === "bundled-wheel",
  );
  if (!record) return { kind: "unsupported", pluginId: request.pluginId };
  if (!record.enabled || !record.loaded) {
    return {
      kind: "unverified",
      pluginId: request.pluginId,
      status: "disabled",
    };
  }
  if (record.trust !== "verified") {
    return {
      kind: "unverified",
      pluginId: request.pluginId,
      status: record.trust,
    };
  }

  const pluginVersion = record.info?.version ?? record.version ?? "";
  if (request.pluginVersion !== pluginVersion) {
    return mismatch("pluginVersion", request.pluginVersion, pluginVersion);
  }
  const recipe = record.recipes.find(
    (candidate) => candidate.id === request.recipeId,
  );
  if (!recipe) {
    return mismatch("recipe", request.recipeId, record.recipes[0]?.id ?? "");
  }
  if (request.recipeVersion !== recipe.version) {
    return mismatch("recipeVersion", request.recipeVersion, recipe.version);
  }
  const example = record.examples.find(
    (candidate) => candidate.id === request.exampleId,
  );
  if (!example) {
    return mismatch("example", request.exampleId, record.examples[0]?.id ?? "");
  }
  if (example.recipe_id !== recipe.id) {
    return mismatch("recipe", request.recipeId, example.recipe_id ?? "");
  }

  const opened = await runtime.openPluginExample(
    request.pluginId,
    request.exampleId,
    true,
  );
  return {
    kind: "opened",
    pluginId: request.pluginId,
    recipeId: request.recipeId,
    example: opened,
  };
}
