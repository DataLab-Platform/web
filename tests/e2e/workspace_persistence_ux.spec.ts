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
 *     workspace is dirty,
 *   * edits that bypass the processing pipeline (array editors,
 *     duplication, reordering, ROI paste, display settings) raise the
 *     dirty flag too.
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

  for (const mode of ["ram", "disk"] as const) {
    test(`editing, duplicating and reordering objects mark the workspace dirty (${mode})`, async ({
      page,
    }) => {
      await page.goto("/");
      await waitForRuntimeReady(page);
      if (mode === "disk") {
        test.skip(
          !(await page.evaluate(() => window.runtime.isDiskStorageSupported())),
          "OPFS is not available in this browser",
        );
      }

      // Each call below changes state saved with the workspace: the runtime
      // must notify a workspace mutation, which raises the dirty flag.
      const result = await page.evaluate(async (storage) => {
        const rt = window.runtime;
        await rt.setStorageMode(storage);
        const sig = await rt.createSignalTyped("sine");
        await rt.setSignalRoi(sig, [{ xmin: 1, xmax: 2, title: "r" }]);
        await rt.copyObjectRoi(sig);
        const img = await rt.createImageTyped("ramp");
        const names: string[] = [];
        const unsubscribe = rt.onWorkspaceMutation((name) => names.push(name));
        try {
          const dup = await rt.duplicateObject(sig);
          await rt.moveObjectInGroup(dup, -1);
          await rt.setSignalData(sig, [0, 1, 2], [3, 4, 5]);
          await rt.pasteObjectRoi([dup]);
          await rt.setImageData(img, [
            [1, 2],
            [3, 4],
          ]);
          await rt.setResampleMethod(img, "max");
        } finally {
          unsubscribe();
        }
        const spilled = rt.getSpilledCount();
        const edited = await rt.getSignalData(sig);
        await rt.setStorageMode("ram");
        return { names, spilled, y: Array.from(edited.y) };
      }, mode);
      expect(result.names).toEqual([
        "duplicate_object",
        "move_object_in_group",
        "set_signal_xydata",
        "paste_object_roi",
        "set_image_data",
        "set_resample_method",
      ]);
      // In disk mode, every object (signal, duplicate, image) is back on
      // disk with its edited data.
      expect(result.spilled).toBe(mode === "disk" ? 3 : 0);
      expect(result.y).toEqual([3, 4, 5]);
      await expect.poll(() => page.title()).toContain("•");
    });
  }
});
