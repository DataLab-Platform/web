import { describe, expect, it } from "vitest";

import {
  parseApplicationDeepLink,
  validateApplicationDeepLink,
  type ApplicationDeepLinkRequest,
  type BundledApplicationManifest,
} from "../../../src/utils/applicationDeepLink";

const REQUEST: ApplicationDeepLinkRequest = {
  pluginId: "org.datalab.camera-characterization",
  pluginVersion: "0.1.0",
  recipeId: "org.datalab.camera-characterization:relative-dn-characterization",
  recipeVersion: "1.1.0",
  exampleId: "quickstart",
};

const MANIFEST: BundledApplicationManifest = {
  plugin_id: REQUEST.pluginId,
  plugin_version: REQUEST.pluginVersion,
  recipe_id: REQUEST.recipeId,
  recipe_version: REQUEST.recipeVersion,
};

describe("parseApplicationDeepLink", () => {
  it("ignores query strings without Applications parameters", () => {
    expect(parseApplicationDeepLink("")).toEqual({ kind: "none" });
    expect(parseApplicationDeepLink("?lang=fr&preload=demos/a.h5")).toEqual({
      kind: "none",
    });
  });

  it("reports every missing parameter once the contract is requested", () => {
    expect(parseApplicationDeepLink("?plugin=org.example.app")).toEqual({
      kind: "invalid",
      missing: ["pluginVersion", "recipe", "recipeVersion", "example"],
    });
    expect(
      parseApplicationDeepLink(
        "?plugin=org.example.app&pluginVersion=&recipe=x&recipeVersion=1",
      ),
    ).toEqual({
      kind: "invalid",
      missing: ["pluginVersion", "example"],
    });
  });

  it("decodes and trims a complete request", () => {
    const search = new URLSearchParams({
      plugin: ` ${REQUEST.pluginId} `,
      pluginVersion: REQUEST.pluginVersion,
      recipe: REQUEST.recipeId,
      recipeVersion: REQUEST.recipeVersion,
      example: REQUEST.exampleId,
    }).toString();
    expect(parseApplicationDeepLink(`?${search}`)).toEqual({
      kind: "valid",
      request: REQUEST,
    });
  });
});

describe("validateApplicationDeepLink", () => {
  it("accepts an exact bundled plugin, recipe, versions, and example", () => {
    expect(
      validateApplicationDeepLink(REQUEST, MANIFEST, "quickstart"),
    ).toBeNull();
  });

  it.each([
    ["pluginId", "other.plugin", "plugin"],
    ["pluginVersion", "9.0.0", "pluginVersion"],
    ["recipeId", "other.plugin:recipe", "recipe"],
    ["recipeVersion", "9.0.0", "recipeVersion"],
    ["exampleId", "other-example", "example"],
  ] as const)("rejects a mismatched %s", (property, value, field) => {
    const request = { ...REQUEST, [property]: value };
    const mismatch = validateApplicationDeepLink(
      request,
      MANIFEST,
      "quickstart",
    );
    expect(mismatch).toEqual({
      field,
      requested: value,
      bundled:
        field === "plugin"
          ? MANIFEST.plugin_id
          : field === "pluginVersion"
            ? MANIFEST.plugin_version
            : field === "recipe"
              ? MANIFEST.recipe_id
              : field === "recipeVersion"
                ? MANIFEST.recipe_version
                : "quickstart",
    });
  });
});
