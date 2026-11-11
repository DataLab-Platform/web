import type { Page } from "@playwright/test";

/**
 * UI helpers of the scripted end-to-end demos (the marketing GIF recording,
 * ``demo/demo.spec.ts``). They drive the real DataLab-Web UI the way a user
 * would (menus, parameter dialogs) and are free of any recording concern.
 * The in-app Showcase mode (``src/showcase/engine.ts``) follows the same
 * ``openTopMenu`` logic with synthetic events.
 */

/** Hold a readable beat on the current UI state (the GIF needs each step
 *  to linger long enough for a viewer to register it). */
export async function hold(page: Page, ms = 750): Promise<void> {
  await page.waitForTimeout(ms);
}

/** Click the OK button of the auto-generated parameter dialog when one
 *  appears. Many Sigima processings open a DataSet dialog *after* a short
 *  Pyodide round-trip (schema generation), so we wait for it rather than
 *  probing immediately; if none shows up within ``timeout`` we assume the
 *  processing had no parameters and ran straight away. */
export async function confirmDialogIfAny(
  page: Page,
  timeout = 4000,
): Promise<void> {
  const dialog = page.locator(".dataset-dialog");
  try {
    await dialog.waitFor({ state: "visible", timeout });
  } catch {
    return; // no parameter dialog — nothing to confirm
  }
  await hold(page, 600);
  await dialog.getByRole("button", { name: "OK" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
}

/** Open a top-level menu by its canonical (English) key, independent of the
 *  current UI language.
 *
 *  Robust to whether another top menu is already open: hovering opens the
 *  dropdown when a sibling is open (the menu bar switches on hover), while a
 *  click is needed to open the first one. We must *not* click when a sibling
 *  is open, because the bar pre-selects the hovered item on ``mouseenter`` and
 *  a subsequent click would toggle it straight back closed. */
export async function openTopMenu(page: Page, key: string): Promise<void> {
  const top = page.locator(`[data-menu-top="${key}"]`);
  await top.hover();
  await page.waitForTimeout(120);
  if ((await top.getAttribute("aria-expanded")) !== "true") {
    await top.click();
    await page.waitForTimeout(120);
  }
}
