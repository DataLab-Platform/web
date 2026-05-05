import { test, expect } from "@playwright/test";
import { waitForRuntimeReady, disableQuickstartTemplate } from "./fixtures";

/**
 * End-to-end coverage for the notebook panel's user-facing surface
 * (multi-tab UI, ``.ipynb`` download).
 *
 * Cross-session persistence is exercised by ``notebook_hdf5_roundtrip``
 * — under the Phase 4+ design, the HDF5 workspace is the source of
 * truth for notebooks, and IndexedDB is just a roll-over cache. A
 * "type in a cell, hit reload, expect the content back" probe would
 * encode the *old* invariant and is intentionally absent here.
 */

test.describe("Notebook UI", () => {
  test.beforeEach(async ({ page }) => {
    await disableQuickstartTemplate(page);
    await page.goto("/");
    await waitForRuntimeReady(page);
    await page.getByRole("tab", { name: "Notebooks" }).click();
    // Wait for kernel preload + restore to settle.
    await expect(page.locator(".nb-toolbar-status")).toContainText(
      /Kernel idle|Kernel running/,
      { timeout: 180_000 },
    );
    await expect(page.locator(".nb-tab")).toHaveCount(1);
  });

  test("creating a new notebook adds a tab and switches to it", async ({
    page,
  }) => {
    await page.locator(".nb-tab-new").click();
    await page.getByRole("menuitem", { name: /Empty notebook/ }).click();
    // Two tabs now, second is active.
    await expect(page.locator(".nb-tab")).toHaveCount(2);
    await expect(page.locator(".nb-tab.active")).toHaveCount(1);
    await expect(page.locator(".nb-tab").nth(1)).toHaveClass(/active/);
  });

  test("Export… triggers a .ipynb download with valid nbformat content", async ({
    page,
  }) => {
    // Add a marker line so the downloaded payload is identifiable.
    const editor = page.locator(".nb-cell-editor .cm-content").first();
    await editor.click();
    await page.keyboard.type("print('download-me')");
    await page.waitForTimeout(800);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Export/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.ipynb$/);

    // Read the downloaded file and validate basic nbformat structure.
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(path!, "utf-8");
    const json = JSON.parse(text) as {
      nbformat: number;
      nbformat_minor: number;
      cells: Array<{ cell_type: string; source: string | string[] }>;
    };
    expect(json.nbformat).toBe(4);
    expect(json.nbformat_minor).toBe(5);
    expect(json.cells.length).toBeGreaterThanOrEqual(1);
    const sources = json.cells.map((c) =>
      Array.isArray(c.source) ? c.source.join("") : c.source,
    );
    expect(sources.join("\n")).toContain("download-me");
  });
});
