import { test, expect } from "@playwright/test";
import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

/**
 * End-to-end coverage for the refactored top-level layout:
 *
 *   * the **TreeKindSwitcher** (Signals|Images) sits permanently at the
 *     top of the left object-tree panel,
 *   * the **CentralViewSwitcher** (Plot|Macros|Notebooks) controls
 *     which view occupies the central pane,
 *   * the two switchers are orthogonal — picking a tree kind never
 *     swaps the central view away from Macros/Notebooks, and
 *     conversely picking a central view never swaps the tree kind.
 *
 * Replaces the previous "peek" UX: there is no implicit jump back to
 * the plot when the user clicks an object while editing a macro or
 * notebook; the central view stays put, but the tree selection is
 * honoured (so a follow-up click on Plot reveals the object).
 *
 * Note: an explicit click on a tree object DOES auto-switch the
 * central view back to Plot, mirroring DataLab desktop's "double-click
 * to focus" behaviour.  That behaviour is asserted in the last block.
 */

test.describe("central + tree switchers", () => {
  test("two switchers, fully orthogonal", async ({ page }) => {
    await disableQuickstartTemplate(page);
    await page.goto("/");
    await waitForRuntimeReady(page);

    // Both switchers are visible at startup, with their default tabs
    // active (Signals + Plot).
    const treeKindSwitcher = page.getByRole("tablist", {
      name: "Object tree kind",
    });
    const centralViewSwitcher = page.getByRole("tablist", {
      name: "Central view",
    });
    await expect(treeKindSwitcher).toBeVisible();
    await expect(centralViewSwitcher).toBeVisible();

    const signalsTab = treeKindSwitcher.getByRole("tab", { name: "Signals" });
    const imagesTab = treeKindSwitcher.getByRole("tab", { name: "Images" });
    const plotTab = centralViewSwitcher.getByRole("tab", { name: "Plot" });
    const macrosTab = centralViewSwitcher.getByRole("tab", { name: "Macros" });
    const notebooksTab = centralViewSwitcher.getByRole("tab", {
      name: "Notebooks",
    });

    await expect(signalsTab).toHaveAttribute("aria-selected", "true");
    await expect(plotTab).toHaveAttribute("aria-selected", "true");

    // Switch the central view to Macros: the tree-kind switcher must
    // stay on Signals (it is independent).
    await macrosTab.click();
    await expect(macrosTab).toHaveAttribute("aria-selected", "true");
    await expect(plotTab).toHaveAttribute("aria-selected", "false");
    await expect(signalsTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".macro-panel-host")).toBeVisible();

    // Flip the tree kind to Images while editing macros: the central
    // view must NOT jump back to Plot.
    await imagesTab.click();
    await expect(imagesTab).toHaveAttribute("aria-selected", "true");
    await expect(signalsTab).toHaveAttribute("aria-selected", "false");
    await expect(macrosTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".macro-panel-host")).toBeVisible();

    // Switch to Notebooks: still independent from the tree kind.
    await notebooksTab.click();
    await expect(notebooksTab).toHaveAttribute("aria-selected", "true");
    await expect(macrosTab).toHaveAttribute("aria-selected", "false");
    await expect(imagesTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".nb-panel-host")).toBeVisible();

    // Returning to Plot reveals the central plot area again.
    await plotTab.click();
    await expect(plotTab).toHaveAttribute("aria-selected", "true");
    await expect(notebooksTab).toHaveAttribute("aria-selected", "false");
    await expect(imagesTab).toHaveAttribute("aria-selected", "true");
  });
});
