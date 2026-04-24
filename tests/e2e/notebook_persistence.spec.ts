import { test, expect } from "@playwright/test";
import { waitForRuntimeReady, disableQuickstartTemplate } from "./fixtures";

/**
 * End-to-end coverage for Phase 3 — notebook persistence (IndexedDB
 * autosave + ``.ipynb`` download) and the multi-tab UI.
 *
 * Each test gets a fresh browser context, so IndexedDB starts empty.
 * A clean fresh-load opens the panel with exactly one blank notebook.
 */

test.describe("Notebook persistence (Phase 3)", () => {
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

  test("autosaves cell edits and restores them after a full page reload", async ({
    page,
  }) => {
    // Type a distinctive marker into the cell.
    const marker = `# autosave-test ${Date.now()}`;
    const editor = page.locator(".nb-cell-editor .cm-content").first();
    await editor.click();
    await page.keyboard.type(marker);

    // Wait long enough for the 600 ms debounce + IndexedDB write.
    await page.waitForTimeout(1500);

    // Hard-reload the whole page — clears in-memory state but not
    // IndexedDB. Pyodide will boot afresh; the notebook content must
    // come back from storage.
    await page.reload();
    await waitForRuntimeReady(page);
    await page.getByRole("tab", { name: "Notebooks" }).click();
    await expect(page.locator(".nb-toolbar-status")).toContainText(
      /Kernel idle|Kernel running/,
      { timeout: 180_000 },
    );

    // Marker must have survived the reload. Restore happens
    // asynchronously after kernel ready, so poll the editor until it
    // contains the marker (or timeout).
    await expect
      .poll(
        async () =>
          page.locator(".nb-cell-editor .cm-content").first().innerText(),
        { timeout: 30_000, intervals: [200, 500, 1000] },
      )
      .toContain(marker);
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

  test("Save as… triggers a .ipynb download with valid nbformat content", async ({
    page,
  }) => {
    // Add a marker line so the downloaded payload is identifiable.
    const editor = page.locator(".nb-cell-editor .cm-content").first();
    await editor.click();
    await page.keyboard.type("print('download-me')");
    await page.waitForTimeout(800);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Save as/ }).click(),
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
