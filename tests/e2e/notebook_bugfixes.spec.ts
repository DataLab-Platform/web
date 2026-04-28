import { test, expect } from "@playwright/test";
import { waitForRuntimeReady, disableQuickstartTemplate } from "./fixtures";

/**
 * End-to-end coverage for the four bugs reported by the user against
 * the Phase 3 notebook MVP:
 *
 *   1. Browser-store menu shows duplicates and clicking does nothing
 *   2. Re-opening a previously-saved ``.ipynb`` from disk does nothing
 *   3. Markdown cells don't render their source as HTML
 *   4. There is no obvious way to rename a notebook
 */

test.describe("Notebook bug fixes (Phase 3.1)", () => {
  test.beforeEach(async ({ page }) => {
    await disableQuickstartTemplate(page);
    await page.goto("/");
    await waitForRuntimeReady(page);
    await page.getByRole("tab", { name: "Notebooks" }).click();
    await expect(page.locator(".nb-toolbar-status")).toContainText(
      /Kernel idle|Kernel running/,
      { timeout: 180_000 },
    );
    await expect(page.locator(".nb-tab")).toHaveCount(1);
  });

  test("Bug 3 — markdown cells render Markdown to HTML", async ({ page }) => {
    // Insert a markdown cell.
    await page.getByRole("button", { name: /\+ Markdown/ }).click();
    // The new markdown cell starts in editing mode (empty source).
    const cells = page.locator(".nb-cell");
    await expect(cells).toHaveCount(2);
    const mdEditor = cells.nth(1).locator(".nb-cell-editor .cm-content");
    await mdEditor.click();
    await page.keyboard.type(
      "# Hello world\n\nThis is **bold** and *italic*.\n\n- item 1\n- item 2",
    );
    // Commit (Ctrl+Enter) — leaves edit mode for markdown cells.
    await page.keyboard.press("Control+Enter");

    const rendered = cells.nth(1).locator(".nb-cell-markdown-rendered");
    await expect(rendered).toBeVisible();
    await expect(rendered.locator("h1")).toHaveText("Hello world");
    await expect(rendered.locator("strong")).toHaveText("bold");
    await expect(rendered.locator("em")).toHaveText("italic");
    await expect(rendered.locator("li")).toHaveCount(2);
  });

  test("Bug 4 — Rename toolbar button updates the active tab title", async ({
    page,
  }) => {
    // Initial name is "Untitled".
    await expect(page.locator(".nb-tab.active .nb-tab-title")).toHaveText(
      "Untitled",
    );
    await page.getByRole("button", { name: /Rename/ }).click();
    // Inline input appears in the active tab.
    const renameInput = page.locator(".nb-tab.active .nb-tab-rename-input");
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toBeFocused();
    // Clear and type the new name, commit with Enter.
    await renameInput.fill("My Spectroscopy Notes");
    await renameInput.press("Enter");
    await expect(page.locator(".nb-tab.active .nb-tab-title")).toHaveText(
      "My Spectroscopy Notes",
    );
    // Type something so autosave kicks in (the rename of an empty
    // notebook is intentionally not persisted on its own), then verify
    // the browser store reflects the new name.
    const editor = page.locator(".nb-cell-editor .cm-content").first();
    await editor.click();
    await page.keyboard.type("# spec");
    await page.waitForTimeout(1200);
    const stored = await page.evaluate(async () => {
      const req = indexedDB.open("datalab-web.notebooks");
      const db: IDBDatabase = await new Promise((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const tx = db.transaction("notebooks", "readonly");
      const all = await new Promise<{ name: string }[]>((res, rej) => {
        const r = tx.objectStore("notebooks").getAll();
        r.onsuccess = () => res(r.result as { name: string }[]);
        r.onerror = () => rej(r.error);
      });
      return all.map((r) => r.name);
    });
    expect(stored).toContain("My Spectroscopy Notes");
  });

  test("Bug 4b — Escape cancels the rename without changing the name", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Rename/ }).click();
    const renameInput = page.locator(".nb-tab.active .nb-tab-rename-input");
    await expect(renameInput).toBeVisible();
    await renameInput.fill("Aborted Name");
    await renameInput.press("Escape");
    await expect(page.locator(".nb-tab-rename-input")).toHaveCount(0);
    await expect(page.locator(".nb-tab.active .nb-tab-title")).toHaveText(
      "Untitled",
    );
  });

  test("Bug 2 — re-opening a saved .ipynb from disk loads the notebook", async ({
    page,
  }) => {
    // Type something distinctive, save, then re-open.
    const marker = "print('reopen-me')";
    const editor = page.locator(".nb-cell-editor .cm-content").first();
    await editor.click();
    await page.keyboard.type(marker);
    await page.waitForTimeout(800);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Save as/ }).click(),
    ]);
    const path = await download.path();
    expect(path).toBeTruthy();

    // Open the file back through the hidden file input.
    const fileInput = page.locator('input[type="file"][accept*=".ipynb"]');
    await fileInput.setInputFiles(path!);

    // A second tab must appear, focused on the loaded notebook.
    await expect(page.locator(".nb-tab")).toHaveCount(2);
    // The marker text from the saved file is in the active editor.
    const restored = await page
      .locator(".nb-cell-editor .cm-content")
      .first()
      .innerText();
    expect(restored).toContain("reopen-me");
  });

  test("Bug 1 — browser-store menu lists notebooks and opening focuses tab", async ({
    page,
  }) => {
    // Fresh-start contract: an untouched notebook must NOT appear in
    // browser storage. The "Browser…" button is therefore disabled.
    await expect(page.getByRole("button", { name: /Browser…/ })).toBeDisabled();

    // Type something so the current notebook is persisted, then create
    // a brand-new tab (also untouched ⇒ not persisted yet).
    const editor = page.locator(".nb-cell-editor .cm-content").first();
    await editor.click();
    await page.keyboard.type("first-marker");
    await page.waitForTimeout(1000);

    // The Browser… button now has exactly one entry (the touched one).
    const browserBtn = page.getByRole("button", { name: /Browser…\s*\(\d+\)/ });
    await expect(browserBtn).toBeEnabled();
    await expect(browserBtn).toContainText("(1)");

    // Open the menu — the entry shows the name and a timestamp, and
    // is marked as already open (we're sitting on it).
    await browserBtn.click();
    const items = page.locator(".nb-open-menu-item");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toHaveClass(/nb-open-menu-item-open/);
    await expect(
      items.first().locator(".nb-open-menu-name-when"),
    ).toBeVisible();

    // Click the entry — should refocus the existing tab (no second tab
    // is added) and close the menu.
    await items.first().locator(".nb-open-menu-name").click();
    await expect(page.locator(".nb-open-menu")).toHaveCount(0);
    await expect(page.locator(".nb-tab")).toHaveCount(1);

    // Now create a second tab, type into it, and verify the store
    // grows to two entries with both visible.
    await page.locator(".nb-tab-new").click();
    await page.getByRole("menuitem", { name: /Empty notebook/ }).click();
    const editor2 = page.locator(".nb-cell-editor .cm-content").first();
    await editor2.click();
    await page.keyboard.type("second-marker");
    await page.waitForTimeout(1000);

    await browserBtn.click();
    await expect(page.locator(".nb-open-menu-item")).toHaveCount(2);
    // Both entries are marked as already open since both tabs are open.
    await expect(
      page.locator(".nb-open-menu-item.nb-open-menu-item-open"),
    ).toHaveCount(2);
  });
});
