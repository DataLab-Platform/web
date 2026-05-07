/* POC: worker-scoped Playwright fixture that reuses a single Pyodide
 * boot across multiple tests.
 *
 * Tradeoffs documented in `doc/testing-strategy.md`:
 *  - Pros: skip Pyodide cold boot (~25 s) and Sigima micropip install
 *    (~30 s) for every test except the first one in the worker.
 *  - Cons: tests share Python state, IndexedDB, localStorage and the
 *    React component tree. Each spec that opts in MUST be safe against
 *    leftover state from previous tests, either by self-cleaning or
 *    by relying on the generic `resetWarmWorkspace` helper below.
 *
 * Tests that fundamentally depend on a cold boot (Quickstart auto-load,
 * recovery banner cold start, install-time error paths) MUST keep the
 * default per-test page from the standard `@playwright/test` import.
 */

import { test as base, expect, Page } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

type WarmFixtures = {
  /** Shared page that boots Pyodide once per worker. */
  warmPage: Page;
};

export const test = base.extend<{}, WarmFixtures>({
  warmPage: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      // Suppress the Quickstart template so the first test starts
      // with a single Untitled notebook (matches the cold-boot spec
      // contract used historically).
      await page.addInitScript(() => {
        try {
          const KEY = "datalab-web.notebooks.openIds";
          if (window.localStorage.getItem(KEY) === null) {
            window.localStorage.setItem(KEY, "[]");
          }
        } catch {
          // ignore
        }
      });
      await page.goto("/");
      await waitForRuntimeReady(page);
      await use(page);
      await context.close();
    },
    { scope: "worker" },
  ],
});

export { expect };

/**
 * Dismiss any leftover modal dialog from a previous warm test.
 *
 * Best-effort: tries Escape first (fast for dialogs that handle it),
 * then falls back to clicking a Cancel button if the dialog is still
 * visible. Safe to call when no dialog is open.
 */
export async function dismissAnyDialog(page: Page): Promise<void> {
  const dialog = page.locator("[role=dialog]");
  if ((await dialog.count()) === 0) return;
  if (!(await dialog.first().isVisible().catch(() => false))) return;
  await page.keyboard.press("Escape").catch(() => {});
  if (!(await dialog.first().isVisible().catch(() => false))) return;
  const cancel = page.getByRole("button", { name: /^Cancel$/ });
  if ((await cancel.count()) > 0) {
    await cancel.first().click({ timeout: 2_000 }).catch(() => {});
  }
  await dialog.first().waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
}

/**
 * Bring the warm page back to a clean Notebook-panel state without
 * reloading (which would re-cost a Pyodide boot).
 *
 * The reset is intentionally LIGHTWEIGHT: previous tests may leave
 * residual notebook tabs and Python state. Rather than fighting with
 * autosave/persist races to fully tear down state, we:
 *
 *   1. Wipe the Python in-memory store (signals/images/macros/notebooks)
 *      via :meth:`Runtime.resetAll`. The React panel keeps stale tabs
 *      visible but their backing Python rows are gone.
 *   2. Clear notebook-related localStorage keys and the recent
 *      IndexedDB store so the panel's ``Recent…`` menu starts empty.
 *   3. Open a fresh ``Empty notebook`` via the ``+`` toolbar button.
 *      Tests work against this newest tab as the *active* notebook.
 *
 * Caller MUST register a ``page.on("dialog", d => d.accept())``
 * listener BEFORE invoking this helper if it intends to close any
 * leftover tab during the test body.
 */
export async function resetWarmNotebookPanel(page: Page): Promise<void> {
  // Tests from another spec may have left the panel switcher on a
  // different panel — make sure we're on Notebooks before any
  // notebook-specific selector is used.
  await dismissAnyDialog(page);
  await page.getByRole("tab", { name: "Notebooks" }).click();
  await page.evaluate(async () => {
    // 1. Python wipe (signals/images/macros/notebooks).
    await window.runtime.resetAll();
    // 2a. Notebook-related localStorage keys.
    try {
      window.localStorage.removeItem("datalab-web.notebooks.openIds");
      window.localStorage.removeItem("datalab-web.notebooks.activeId");
    } catch {
      // ignore
    }
    // 2b. Recent IndexedDB store. ``deleteDatabase`` blocks while the
    // app keeps an open connection — clearing the object store inside
    // an open transaction has the right side-effect.
    try {
      await new Promise<void>((resolve) => {
        const req = indexedDB.open("datalab-web.recent");
        req.onsuccess = () => {
          const db = req.result;
          try {
            const tx = db.transaction("entries", "readwrite");
            tx.objectStore("entries").clear();
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              resolve();
            };
          } catch {
            db.close();
            resolve();
          }
        };
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
        req.onupgradeneeded = () => {
          req.result.close();
          resolve();
        };
      });
    } catch {
      // ignore
    }
  });
  // 3. Spawn a fresh Empty notebook and ensure it is the active tab.
  await page.locator(".nb-tab-new").click();
  await page.getByRole("menuitem", { name: /Empty notebook/ }).click();
  await expect(page.locator(".nb-tab.active .nb-tab-title")).toHaveText(
    "Untitled",
    { timeout: 10_000 },
  );
  await expect(page.locator(".nb-toolbar-status")).toContainText(
    /Kernel idle|Kernel running/,
    { timeout: 60_000 },
  );
}
