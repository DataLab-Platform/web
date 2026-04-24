import { test, expect } from "@playwright/test";
import { waitForSigimaReady, disableQuickstartTemplate } from "./fixtures";

/**
 * Phase 4 — verify the File → Notebook submenu actions are wired and
 * trigger the same code paths as the in-panel toolbar.
 */

async function openFileNotebookMenu(page: import("@playwright/test").Page) {
  // Click the "File" top-level entry, then hover/click the "Notebook"
  // submenu to expose its leaves.
  await page.getByRole("menuitem", { name: "File" }).first().click();
  await page.getByRole("menuitem", { name: "Notebook" }).first().hover();
}

test.describe("Phase 4 — File → Notebook menu", () => {
  test.beforeEach(async ({ page }) => {
    await disableQuickstartTemplate(page);
    await page.goto("/");
    await waitForSigimaReady(page);
    // Pre-warm notebook panel so the kernel is loaded.
    await page.getByRole("tab", { name: "Notebooks" }).click();
    await expect(page.locator(".nb-toolbar-status")).toContainText(
      /Kernel idle|Kernel running/,
      { timeout: 180_000 },
    );
    await expect(page.locator(".nb-tab")).toHaveCount(1);
  });

  test("New notebook menu entry opens a new tab", async ({ page }) => {
    // Switch back to Signal panel to verify menu also switches panel.
    await page.getByRole("tab", { name: "Signals" }).click();
    await openFileNotebookMenu(page);
    await page.getByRole("menuitem", { name: /New notebook/ }).click();
    // Notebook panel is active again and there are 2 tabs.
    await expect(page.locator(".nb-tab")).toHaveCount(2);
  });

  test("Save notebook as… menu entry triggers .ipynb download", async ({
    page,
  }) => {
    // Type something in the active code cell so the notebook is touched.
    const editor = page.locator(".nb-cell .cm-content").first();
    await editor.click();
    await page.keyboard.type("x = 1");

    await openFileNotebookMenu(page);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /Save notebook as/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.ipynb$/);
  });

  test("Rename notebook menu entry shows inline rename input", async ({
    page,
  }) => {
    await openFileNotebookMenu(page);
    await page.getByRole("menuitem", { name: /Rename notebook/ }).click();
    const renameInput = page.locator(".nb-tab.active .nb-tab-rename-input");
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toBeFocused();
  });
});
