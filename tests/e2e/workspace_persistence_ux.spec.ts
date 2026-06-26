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
 * truth" persistence model. Round-trip data integrity is covered by
 * ``workspace_persistence_roundtrip``; this spec drives the
 * user-facing surfaces:
 *
 *   * the cold-start ``RecoveryBanner`` appears when the IndexedDB
 *     "Recent…" cache holds edited macros / notebooks, points the user
 *     at each panel's "Recent…" menu, and disappears after Dismiss.
 *     Macros and notebooks are NOT silently restored, so the workspace
 *     stays clean (no "(recovered)" title hint),
 *   * the ``beforeunload`` guard fires when (and only when) the
 *     workspace is dirty.
 */

test.describe("Workspace persistence UX", () => {
  test("Recent… hint banner appears on cold start when the cache holds entries", async ({
    page,
  }) => {
    // -- 1. Warm-up: seed the IndexedDB recent cache with an edited
    //       macro. This mirrors MacroPanel's ``persistMirror`` on a
    //       *touched* macro — pristine, auto-created sample macros are
    //       deliberately never cached (option C). --
    await page.goto("/");
    await waitForRuntimeReady(page);
    const macroTitle = `recent-${Date.now()}`;
    await page.evaluate(async (title) => {
      const { recordRecent } = await import("/src/storage/recentStore.ts");
      await recordRecent("macro", {
        id: `m-${Date.now()}`,
        title,
        content: "# recent probe\n",
      });
    }, macroTitle);

    // -- 2. Cold reload — Pyodide is wiped but the IndexedDB cache
    //       survives. Macros are NOT auto-restored; App.tsx surfaces an
    //       informational banner pointing at the "Recent…" menus. --
    await page.reload();
    await waitForRuntimeReady(page);

    const banner = page.getByTestId("recovery-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText(/Recent/i);
    await expect(banner).toContainText(/macro/i);

    // The workspace stays clean / non-recovered: no "(recovered)" hint
    // (nothing was silently restored into the workspace).
    await expect.poll(() => page.title()).not.toContain("(recovered)");

    // -- 3. Dismiss hides the banner for the session. --
    await banner.getByRole("button", { name: /Dismiss/i }).click();
    await expect(banner).toBeHidden();
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
