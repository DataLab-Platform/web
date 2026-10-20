import { afterEach, describe, expect, it } from "vitest";

import { setActiveLocale } from "../../../src/i18n/locale";
import { currentRuntimeLabels } from "../../../src/runtime/runtimeLabels";

describe("currentRuntimeLabels", () => {
  afterEach(() => setActiveLocale("en", { reload: false }));

  it("passes the English labels and no translation in English", () => {
    setActiveLocale("en", { reload: false });

    expect(currentRuntimeLabels()).toEqual({
      group: "Group",
      untitled: "Untitled",
      translations: {},
    });
  });

  it("passes the catalog of the active locale to bootstrap.py", () => {
    setActiveLocale("fr", { reload: false });

    const labels = currentRuntimeLabels();

    expect(labels.group).toBe(labels.translations["Group"]);
    expect(labels.untitled).toBe(labels.translations["Untitled"]);
    // Strings of bootstrap.py's own dialogs, translated through ``_web()``.
    expect(labels.translations["Add metadata"]).toBe("Ajouter des métadonnées");
    expect(labels.translations["Invalid pattern:"]).toBe("Modèle invalide :");
  });
});
