import { test, expect } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

/**
 * End-to-end coverage for internationalisation.
 *
 * Two distinct surfaces must be in French when the app boots with
 * ``?lang=fr``:
 *
 *   1. **UI strings** translated by the lightweight ``t()`` helper — e.g.
 *      the top-level "Processing" menu folder renders as "Traitement".
 *   2. **Python-origin labels** coming from Sigima/guidata gettext catalogs
 *      inside Pyodide. This only works if the ``LANG`` propagation from the
 *      active locale to the Pyodide boot is wired correctly, so asserting a
 *      French Sigima label exercises the whole bridge. The signal creation
 *      type "Gaussian" → "Gaussienne" is a non-overridden catalog label, so
 *      it carries the gettext translation straight through.
 */
test.describe("Internationalisation (French locale)", () => {
  test("translates UI menus and Sigima-origin labels with ?lang=fr", async ({
    page,
  }) => {
    await page.goto("/?lang=fr");
    await waitForRuntimeReady(page);

    const menubar = page.locator("[role=menubar]");

    // 1. UI-side translation: the "Processing" folder is "Traitement",
    // the "Create" folder is "Créer".
    await expect(
      menubar.getByText("Traitement", { exact: true }),
    ).toBeVisible();
    await expect(menubar.getByText("Créer", { exact: true })).toBeVisible();

    // 2. Pyodide bridge: the "Create" menu lists signal-generation types
    // whose labels come straight from Sigima's gettext catalog. With
    // ``LANG=fr`` the "Gaussian" type renders as "Gaussienne".
    await menubar.getByText("Créer", { exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: /Gaussienne/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("translates the workspace chrome (tabs, side panel, welcome page)", async ({
    page,
  }) => {
    await page.goto("/?lang=fr");
    await waitForRuntimeReady(page);

    // Left-panel object-kind tabs.
    await expect(page.getByRole("tab", { name: "Signaux" })).toBeVisible();

    // Central-view tabs (plot / macros / notebooks).
    await expect(page.getByRole("tab", { name: "Graphique" })).toBeVisible();

    // Right-hand side-panel tabs.
    await expect(page.getByRole("tab", { name: "Création" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Propriétés" })).toBeVisible();

    // Welcome page on the empty workspace.
    await expect(page.getByText("Pour commencer")).toBeVisible();
    await expect(page.getByText("Suivre la visite guidée")).toBeVisible();
  });
});
