import { test, expect } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

import type { DataLabRuntime } from "../../src/runtime/runtime";

declare global {
  interface Window {
    runtime: DataLabRuntime;
  }
}

/**
 * UX-level safety nets for the "HDF5 = single durable source of
 * truth" persistence model (PR 2). Round-trip data integrity is
 * covered by ``workspace_persistence_roundtrip``; this spec drives
 * the user-facing surfaces:
 *
 *   * the cold-start ``RecoveryBanner`` appears when the IndexedDB
 *     "Recent…" cache holds macros / notebooks the panels silently
 *     rehydrated, and disappears after Save or Dismiss,
 *   * the ``beforeunload`` guard fires when (and only when) the
 *     workspace is dirty,
 *   * ``Dismiss`` keeps the "(recovered)" hint in the document title
 *     until the user saves an HDF5 — the underlying state is still
 *     non-durable.
 */

test.describe("Workspace persistence UX (PR 2)", () => {
  test("recovery banner appears on cold start when the recent cache holds entries", async ({
    page,
  }) => {
    // -- 1. Warm-up pass: create a uniquely-titled macro, let the
    //       MacroPanel write it to the IndexedDB recent cache. --
    await page.goto("/");
    await waitForRuntimeReady(page);
    const macroTitle = `recovery-${Date.now()}`;
    await page.evaluate(async (t) => {
      await window.runtime.createMacro(t, "# recovery probe\n");
    }, macroTitle);
    // The MacroPanel writes to the cache via the panel's effects, so
    // make sure it has mounted at least once.
    await page.getByRole("tab", { name: "Macros" }).click();
    // The Recent… menu only appears once recordRecent has resolved;
    // wait for the cache to settle.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const { listRecent } = await import("/src/storage/recentStore.ts");
            const r = await listRecent("macro");
            return r.length;
          }),
        { timeout: 15_000, intervals: [200, 500] },
      )
      .toBeGreaterThan(0);

    // -- 2. Cold reload — Pyodide is wiped but the IndexedDB cache
    //       survives. The MacroPanel will silently rehydrate from it
    //       and App.tsx will surface the recovery banner. --
    await page.reload();
    await waitForRuntimeReady(page);

    const banner = page.getByTestId("recovery-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText(/Recovered/i);
    await expect(banner).toContainText(/macro/i);

    // Title carries the "(recovered)" hint until the user saves.
    await expect.poll(() => page.title()).toContain("(recovered)");

    // -- 3. Dismiss hides the banner but keeps the (recovered) hint
    //       (the workspace is still non-durable). --
    await banner.getByRole("button", { name: /Dismiss/i }).click();
    await expect(banner).toBeHidden();
    await expect.poll(() => page.title()).toContain("(recovered)");

    // -- 4. After a Save HDF5, the (recovered) hint clears. --
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "File" }).first().click();
    await page.getByRole("menuitem", { name: /Save HDF5 workspace/i }).click();
    const dl = await downloadPromise;
    const filename = dl.suggestedFilename();
    await dl.saveAs(test.info().outputPath(filename));
    await expect.poll(() => page.title()).not.toContain("(recovered)");
    await expect.poll(() => page.title()).toContain(filename);
  });

  test("recovery banner Save button promotes the recovered state to durable", async ({
    page,
  }) => {
    // Seed the cache with a notebook this time. We persist the
    // notebook in the Python store *and* explicitly seed the
    // IndexedDB recent cache, mirroring what NotebookPanel's
    // autosave does once a user touches a notebook (pristine
    // empties are intentionally not recorded — see Bug 1 contract).
    await page.goto("/");
    await waitForRuntimeReady(page);
    const nbContent = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [
        {
          cell_type: "code",
          id: "c1",
          source: "# recovery-nb-probe",
          metadata: {},
          outputs: [],
          execution_count: null,
        },
      ],
    });
    await page.evaluate(async (content) => {
      const rec = await window.runtime.createNotebook("recovery-nb", content);
      const { recordRecent } = await import("/src/storage/recentStore.ts");
      await recordRecent("notebook", {
        id: rec.id,
        title: rec.title,
        content,
      });
    }, nbContent);
    await page.getByRole("tab", { name: "Notebooks" }).click();
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const { listRecent } = await import("/src/storage/recentStore.ts");
            const r = await listRecent("notebook");
            return r.length;
          }),
        { timeout: 30_000, intervals: [250, 500] },
      )
      .toBeGreaterThan(0);

    // Cold reload → banner appears.
    await page.reload();
    await waitForRuntimeReady(page);
    const banner = page.getByTestId("recovery-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText(/notebook/i);

    // Click "Save HDF5 workspace…" inside the banner.
    const downloadPromise = page.waitForEvent("download");
    await banner.getByRole("button", { name: /Save HDF5 workspace/i }).click();
    const dl = await downloadPromise;
    expect(dl.suggestedFilename()).toMatch(/^workspace-.*\.h5$/);
    await dl.saveAs(test.info().outputPath(dl.suggestedFilename()));

    // Banner disappears, title is clean and titled.
    await expect(banner).toBeHidden();
    await expect.poll(() => page.title()).not.toContain("(recovered)");
    await expect.poll(() => page.title()).not.toContain("•");
  });

  test("beforeunload prompt fires only when the workspace is dirty", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForRuntimeReady(page);

    // -- Clean state: navigate away → no prompt. --
    let dialogTriggered = false;
    page.on("dialog", (d) => {
      dialogTriggered = true;
      void d.dismiss();
    });
    // Simulate an in-page ``beforeunload`` directly: dispatching the
    // event is the same path the browser takes on real navigation.
    const cleanReturnValue = await page.evaluate(() => {
      const ev = new Event("beforeunload", { cancelable: true });
      Object.defineProperty(ev, "returnValue", {
        configurable: true,
        writable: true,
        value: "",
      });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(cleanReturnValue).toBe(false);
    expect(dialogTriggered).toBe(false);

    // -- Dirty state: same probe must call preventDefault(). --
    await page.evaluate(async () => {
      await window.runtime.createSignalTyped("sine");
    });
    await expect.poll(() => page.title()).toContain("•");

    const dirtyDefaultPrevented = await page.evaluate(() => {
      const ev = new Event("beforeunload", { cancelable: true });
      Object.defineProperty(ev, "returnValue", {
        configurable: true,
        writable: true,
        value: "",
      });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(dirtyDefaultPrevented).toBe(true);
  });
});
