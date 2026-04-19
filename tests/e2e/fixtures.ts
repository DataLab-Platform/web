import { expect, Page } from "@playwright/test";

/**
 * Wait for the Sigima runtime to finish booting in Pyodide.
 *
 * The root ``<div class="app">`` exposes ``data-sigima-status`` which moves
 * from ``loading`` → ``ready`` once bootstrap.py has been executed.
 */
export async function waitForSigimaReady(page: Page): Promise<void> {
  // First load installs Sigima/guidata via micropip (network) and runs the
  // ~MB-sized bootstrap.py.  On CI or slow PyPI this can exceed 90 s, so we
  // give it 3 minutes with a safety margin.
  await expect(page.locator(".app")).toHaveAttribute(
    "data-sigima-status",
    "ready",
    { timeout: 180_000 },
  );
}
