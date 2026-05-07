import { test, expect } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

test.describe("DataLab-Web smoke", () => {
  test("loads the application, boots Pyodide and renders top-level menus", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForRuntimeReady(page);

    // Top-level menu bar is always rendered with the File and Help menus.
    const menubar = page.locator("[role=menubar]");
    await expect(menubar).toBeVisible();
    await expect(menubar.getByText("File", { exact: true })).toBeVisible();
    await expect(menubar.getByText("Help", { exact: true })).toBeVisible();

    // Status reports ``Ready`` once the runtime has booted.
    await expect(page.locator(".status")).toHaveText("Ready");
  });
});
