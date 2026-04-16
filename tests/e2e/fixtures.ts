import { expect, Page } from "@playwright/test";

/**
 * Wait for the Sigima runtime to finish booting in Pyodide.
 *
 * The root ``<div class="app">`` exposes ``data-sigima-status`` which moves
 * from ``loading`` → ``ready`` once bootstrap.py has been executed.
 */
export async function waitForSigimaReady(page: Page): Promise<void> {
  await expect(page.locator(".app")).toHaveAttribute(
    "data-sigima-status",
    "ready",
    { timeout: 90_000 },
  );
}
