import { test, expect } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

/**
 * Phase 4.2 — verify the bundled "Quickstart" notebook template loads
 * on first boot when the browser has no saved notebooks and no
 * ``openIds`` localStorage entry.
 */

test.describe("Quickstart notebook template", () => {
  test("loads on first boot in a fresh browser context", async ({ page }) => {
    // Intentionally do NOT call ``disableQuickstartTemplate``: this is
    // the first-boot scenario.
    await page.goto("/");
    await waitForRuntimeReady(page);
    await page.getByRole("tab", { name: "Notebooks" }).click();
    await expect(page.locator(".nb-toolbar-status")).toContainText(
      /Kernel idle|Kernel running/,
      { timeout: 180_000 },
    );
    // Active tab should be named "Quickstart".
    await expect(page.locator(".nb-tab.active .nb-tab-title")).toHaveText(
      "Quickstart",
    );
    // The template ships with 5 cells (3 markdown + 2 code).
    await expect(page.locator(".nb-cell")).toHaveCount(5);
    // First markdown cell renders the H1 "Welcome to DataLab Web Notebooks".
    const firstRendered = page.locator(".nb-cell-markdown-rendered").first();
    await expect(firstRendered.locator("h1")).toContainText(
      "Welcome to DataLab Web Notebooks",
    );
  });
});
