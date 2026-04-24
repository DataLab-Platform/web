import { test, expect } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

test.describe("DataLab-Web smoke", () => {
  test("loads the application and boots Pyodide", async ({ page }) => {
    await page.goto("/");
    await waitForRuntimeReady(page);

    // Top-level menu bar is always rendered.
    await expect(page.locator("[role=menubar]")).toBeVisible();

    // Status reports ``Ready`` once the runtime has booted.
    await expect(page.locator(".status")).toHaveText("Ready");
  });

  test("exposes the File and Help top-level menus", async ({ page }) => {
    await page.goto("/");
    await waitForRuntimeReady(page);

    const menubar = page.locator("[role=menubar]");
    await expect(menubar.getByText("File", { exact: true })).toBeVisible();
    await expect(menubar.getByText("Help", { exact: true })).toBeVisible();
  });
});
