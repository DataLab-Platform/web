import { test, expect } from "@playwright/test";
import { waitForSigimaReady, disableQuickstartTemplate } from "./fixtures";

/**
 * End-to-end tests for the Notebook panel.
 *
 * These tests guard the (surprisingly easy to break) invariant that
 * cell sources, outputs and execution counters survive a round-trip
 * through another panel — both because users will expect that and
 * because losing them silently was the regression that motivated this
 * file in the first place.
 */

test.describe("Notebook panel", () => {
  test.beforeEach(async ({ page }) => {
    await disableQuickstartTemplate(page);
    await page.goto("/");
    await waitForSigimaReady(page);
  });

  test("cell content survives a panel round-trip", async ({ page }) => {
    // Switch to the Notebooks tab.
    await page.getByRole("tab", { name: "Notebooks" }).click();

    // Wait until the kernel preload has at least started (the panel
    // mounts immediately; the "Kernel loading…" status appears as soon
    // as the worker boot is initiated).
    const status = page.locator(".nb-toolbar-status");
    await expect(status).toBeVisible();
    // Wait for kernel to reach idle (post-preload) — generous because
    // the notebook worker downloads & installs Sigima on cold start.
    await expect(status).toContainText(/Kernel idle|Kernel running/, {
      timeout: 180_000,
    });

    // Type a small program into the only cell. CodeMirror must be
    // focused first; clicking the cell editor area takes care of that.
    const cellEditor = page.locator(".nb-cell-editor .cm-content").first();
    await cellEditor.click();
    const cellSource = [
      "x = np.linspace(-10, 10, 500)",
      "y = np.sin(x) / (x + 1e-9)",
      'oid = await proxy.add_signal("sinc", x, y)',
      'print(f"Created signal {oid}")',
    ].join("\n");
    await page.keyboard.type(cellSource);

    // Run with Ctrl+Enter (executes without inserting a new cell).
    await page.keyboard.press("Control+Enter");

    // Wait until the cell shows an execution counter [1] and prints.
    const prompt = page.locator(".nb-cell-prompt").first();
    await expect(prompt).toContainText("[1]", { timeout: 60_000 });
    const stdout = page.locator(".nb-output-stdout").first();
    await expect(stdout).toContainText("Created signal", { timeout: 30_000 });

    // Manually switch to the Signals panel — proxy.add_signal does NOT
    // change the active panel by itself (only the explicit
    // ``proxy.set_current_panel`` does). The signal must however be
    // visible in the tree.
    await page.getByRole("tab", { name: "Signals" }).click();
    await expect(page.locator(".panel-header")).toContainText("Signals");
    await expect(
      page.locator(".object-tree-item").filter({ hasText: "sinc" }),
    ).toBeVisible({ timeout: 10_000 });

    // Switch back to the Notebooks tab — this is THE regression test:
    // the cell content, execution counter and stdout must all survive.
    await page.getByRole("tab", { name: "Notebooks" }).click();
    await expect(page.locator(".panel-header")).toContainText("Notebooks");

    // The cell editor must still hold the source we typed.
    const restored = await page
      .locator(".nb-cell-editor .cm-content")
      .first()
      .innerText();
    // CodeMirror collapses lines to its own DOM; just check our
    // distinctive tokens survived.
    expect(restored).toContain("np.linspace(-10, 10, 500)");
    expect(restored).toContain('proxy.add_signal("sinc"');

    // The execution counter and stdout output must also still be there
    // (they live in the CellModel, not in CodeMirror).
    await expect(page.locator(".nb-cell-prompt").first()).toContainText("[1]");
    await expect(page.locator(".nb-output-stdout").first()).toContainText(
      "Created signal",
    );
  });

  test("a new cell can be added and it gets execution counter [2]", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Notebooks" }).click();
    await expect(page.locator(".nb-toolbar-status")).toContainText(
      /Kernel idle|Kernel running/,
      { timeout: 180_000 },
    );

    // Run an empty first cell so it gets [1].
    const editor = page.locator(".nb-cell-editor .cm-content").first();
    await editor.click();
    await page.keyboard.type("a = 41");
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".nb-cell-prompt").first()).toContainText("[1]", {
      timeout: 60_000,
    });

    // Insert a code cell via the toolbar button and run "print(a + 1)".
    await page.getByRole("button", { name: "+ Code" }).click();
    const cells = page.locator(".nb-cell");
    await expect(cells).toHaveCount(2);
    const newEditor = page.locator(".nb-cell-editor .cm-content").nth(1);
    await newEditor.click();
    await page.keyboard.type("print(a + 1)");
    await page.keyboard.press("Control+Enter");

    // Second cell shows [2] and prints "42" to stdout.
    await expect(page.locator(".nb-cell-prompt").nth(1)).toContainText("[2]", {
      timeout: 60_000,
    });
    await expect(
      page.locator(".nb-cell").nth(1).locator(".nb-output-stdout"),
    ).toContainText("42", { timeout: 10_000 });
  });
});
