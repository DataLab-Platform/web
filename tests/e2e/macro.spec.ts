import { test, expect } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

/**
 * End-to-end coverage for the **Macro panel** Run flow.
 *
 * The macro panel uses a dedicated Pyodide worker (``MacroRuntime``)
 * separate from the main runtime; user-facing bugs in this code path
 * (worker boot failures, console wiring, Run/Stop button state) are
 * not catchable from any other layer because the same
 * ``MacroRuntime`` instance is what the user actually drives.
 *
 * What we cover:
 *
 *   * a fresh boot opens the Macros tab with a default macro and an
 *     idle status label,
 *   * typing source into the editor + clicking ▶ Run streams stdout
 *     into the console panel,
 *   * the running indicator returns to idle after the run completes.
 */
test("macro UI: type, run, see output", async ({ page }) => {
  await page.goto("/");
  await waitForRuntimeReady(page);

  // Open the Macros panel — a default empty macro is auto-created on
  // first boot, so a tab is already present.
  await page.getByRole("tab", { name: "Macros" }).click();
  await expect(page.locator(".macro-tab")).toHaveCount(1);
  await expect(page.locator(".macro-tab.active")).toHaveCount(1);

  // The Run button is enabled once an active macro exists.
  const runBtn = page.getByRole("button", { name: /^▶ Run/ });
  await expect(runBtn).toBeEnabled({ timeout: 10_000 });

  // Type a print statement into the editor (CodeMirror).
  // The default macro ships with a sample template; select all + delete
  // first so we don't end up appending into the middle of existing code.
  const editor = page.locator(".macro-editor .cm-content").first();
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  const marker = `hello-from-macro-${Date.now()}`;
  await page.keyboard.type(`print(${JSON.stringify(marker)})`);

  // Click Run.  The macro worker boots its own Pyodide instance and
  // installs Sigima on first use, so the first run can take up to ~3
  // minutes on a cold cache; the assertion timeouts below mirror the
  // notebook spec budget.
  await runBtn.click();

  // The console must surface the marker on stdout.
  const stdoutLines = page.locator(".macro-console-line.stdout");
  await expect(stdoutLines.filter({ hasText: marker })).toBeVisible({
    timeout: 180_000,
  });

  // Run status returns to idle (the Run button becomes enabled again).
  await expect(runBtn).toBeEnabled({ timeout: 30_000 });
});
