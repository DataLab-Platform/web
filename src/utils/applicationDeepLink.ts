export interface ApplicationDeepLinkRequest {
  pluginId: string;
  pluginVersion: string;
  recipeId: string;
  recipeVersion: string;
  exampleId: string;
}

export type ApplicationDeepLinkParseResult =
  | { kind: "none" }
  | { kind: "invalid"; missing: string[] }
  | { kind: "valid"; request: ApplicationDeepLinkRequest };

export interface BundledApplicationManifest {
  plugin_id: string;
  plugin_version: string;
  recipe_id: string;
  recipe_version: string;
}

export type ApplicationDeepLinkMismatchField =
  | "plugin"
  | "pluginVersion"
  | "recipe"
  | "recipeVersion"
  | "example";

export interface ApplicationDeepLinkMismatch {
  field: ApplicationDeepLinkMismatchField;
  requested: string;
  bundled: string;
}

const REQUIRED_PARAMETERS = [
  ["plugin", "pluginId"],
  ["pluginVersion", "pluginVersion"],
  ["recipe", "recipeId"],
  ["recipeVersion", "recipeVersion"],
  ["example", "exampleId"],
] as const;

/** Parse the Applications deep-link contract from a URL query string. */
export function parseApplicationDeepLink(
  search: string,
): ApplicationDeepLinkParseResult {
  const params = new URLSearchParams(search);
  const hasApplicationParameter = REQUIRED_PARAMETERS.some(
    ([parameter]) => params.get(parameter) !== null,
  );
  if (!hasApplicationParameter) return { kind: "none" };

  const missing = REQUIRED_PARAMETERS.filter(
    ([parameter]) => !params.get(parameter)?.trim(),
  ).map(([parameter]) => parameter);
  if (missing.length > 0) return { kind: "invalid", missing };

  const values = Object.fromEntries(
    REQUIRED_PARAMETERS.map(([parameter, property]) => [
      property,
      params.get(parameter)!.trim(),
    ]),
  ) as unknown as ApplicationDeepLinkRequest;
  return { kind: "valid", request: values };
}

/** Compare a requested workflow with one application bundled in DataLab-Web. */
export function validateApplicationDeepLink(
  request: ApplicationDeepLinkRequest,
  manifest: BundledApplicationManifest,
  bundledExampleId: string,
): ApplicationDeepLinkMismatch | null {
  const comparisons: Array<[ApplicationDeepLinkMismatchField, string, string]> =
    [
      ["plugin", request.pluginId, manifest.plugin_id],
      ["pluginVersion", request.pluginVersion, manifest.plugin_version],
      ["recipe", request.recipeId, manifest.recipe_id],
      ["recipeVersion", request.recipeVersion, manifest.recipe_version],
      ["example", request.exampleId, bundledExampleId],
    ];
  for (const [field, requested, bundled] of comparisons) {
    if (requested !== bundled) return { field, requested, bundled };
  }
  return null;
}
