import { test, expect } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

test.describe("DataLab-Web smoke", () => {
  test("loads the application, boots Pyodide and renders top-level menus", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await waitForRuntimeReady(page);

    // Top-level menu bar is always rendered with the File and Help menus.
    const menubar = page.locator("[role=menubar]");
    await expect(menubar).toBeVisible();
    await expect(menubar.getByText("File", { exact: true })).toBeVisible();
    await expect(menubar.getByText("Help", { exact: true })).toBeVisible();

    // Status reports ``Ready`` once the runtime has booted.
    await expect(page.locator(".status")).toHaveText("Ready");

    // Installation diagnostics make a real round-trip through the default
    // worker-backed runtime and expose the result as a copyable bug report.
    await menubar.getByText("Help", { exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Installation and configuration" })
      .click();

    const dialog = page.getByRole("dialog", {
      name: "Installation and configuration",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Python and Pyodide")).toBeVisible();
    await expect(dialog.getByText("Pyodide", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("cell", { name: /sigima/i })).toBeVisible();

    await dialog.getByRole("button", { name: "Copy report" }).click();
    await expect(dialog.getByText("Copied!", { exact: true })).toBeVisible();
    const copiedReport = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(copiedReport).toContain("## DataLab Web environment");
    expect(copiedReport).toMatch(/\| Sigima \| \d+/i);
  });
});
