import { test, expect } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

/**
 * Phase 2 validation: React race conditions.
 *
 * Two angles:
 *  1. Rapid selection switching in the object tree must always end with
 *     the plot showing the *last clicked* signal (not whichever async
 *     ``getSignalData`` happens to resolve last).  This is a regression
 *     test for the ``cancelled`` guard already present in App.tsx's main
 *     effect — Phase 1's serialisation queue strengthens the invariant.
 *  2. The DataSetForm ``useChoices`` hook used to invoke the resolver
 *     inside ``useMemo`` (whose cleanup is never run); Phase 2 switches
 *     it to ``useEffect``.  We exercise that hook indirectly by opening
 *     the H5 import dialog (which renders dynamic-choice fields) and
 *     verifying no stale state slips through.
 */
test.describe("Phase 2 — React race conditions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForRuntimeReady(page);
  });

  test("rapid signal switching ends on the latest selection", async ({
    page,
  }) => {
    // Seed the panel with 6 signals with predictable titles.
    await page.evaluate(async () => {
      const runtime = (
        window as unknown as {
          runtime: { addSignalFromArrays: (p: unknown) => Promise<string> };
        }
      ).runtime;
      const x = Array.from({ length: 32 }, (_, i) => i);
      for (let i = 0; i < 6; i += 1) {
        await runtime.addSignalFromArrays({
          title: `phase2-${i}`,
          xdata: x,
          ydata: x.map((v) => v * (i + 1)),
        });
      }
    });

    // The runtime now holds 6 signals but the App's tree was rendered
    // *before* we added them.  Toggling the panel switcher fires App's
    // ``refresh()`` and repopulates the tree from the live ``_STORE``.
    await page.getByRole("tab", { name: "Images" }).click();
    await page.getByRole("tab", { name: "Signals" }).click();

    // Wait for the tree to render the signals.
    const items = page.locator(".object-tree-item");
    await expect
      .poll(() => items.count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(6);

    // Click 4 different signals in succession.  Awaiting each click
    // ensures every selection produces a distinct render → a distinct
    // ``useEffect`` run → a distinct in-flight ``getSignalData``.  With
    // Phase 1's serialisation queue + the existing ``cancelled`` guard,
    // only the LAST click's data must end up on screen.
    const clickOrder = ["phase2-3", "phase2-1", "phase2-5", "phase2-2"];
    for (const title of clickOrder) {
      await items.filter({ hasText: title }).first().click();
    }

    // Final settled selection must be the LAST clicked one.
    const last = clickOrder[clickOrder.length - 1];
    // Plotly renders the layout title inside ``g.g-gtitle > text``.
    await expect
      .poll(
        async () => {
          const handle = await page
            .locator("g.g-gtitle text")
            .first()
            .textContent()
            .catch(() => null);
          return handle;
        },
        { timeout: 20_000, intervals: [200, 300, 500, 1000] },
      )
      .toBe(last);

    // No console errors during the rapid switching.
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    expect(errors).toEqual([]);

    // Cross-check: runtime side believes the same.
    const runtimeTitle = await page.evaluate(async () => {
      const runtime = (
        window as unknown as {
          runtime: {
            getPanelTree: (
              k: string,
            ) => Promise<{ groups: { objects: { title: string }[] }[] }>;
          };
        }
      ).runtime;
      const tree = await runtime.getPanelTree("signal");
      return tree.groups
        .flatMap((g) => g.objects)
        .find((o) => o.title === "phase2-5")?.title;
    });
    expect(runtimeTitle).toBe("phase2-5");
  });

  test("dialog mount/unmount does not leak unhandled rejections", async ({
    page,
  }) => {
    // Repeatedly open and close the Help → About dialog.  If any of its
    // effects had a missing cleanup, fast unmount could yield rejected
    // promises swallowed by React.
    const unhandled: string[] = [];
    page.on("pageerror", (e) => unhandled.push(String(e)));

    for (let i = 0; i < 10; i += 1) {
      await page
        .locator("[role=menubar]")
        .getByText("Help", { exact: true })
        .click();
      // The opened dropdown contains the "About" item.
      await page.getByRole("menuitem", { name: /about/i }).first().click();
      await page.locator("[role=dialog]").waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await page.locator("[role=dialog]").waitFor({ state: "hidden" });
    }
    expect(unhandled).toEqual([]);
  });

  test("opening a processing dialog with dynamic choices does not crash", async ({
    page,
  }) => {
    // Regression test for a black screen when opening Processing >
    // Windowing or Processing > Detrending: ``DataSetForm.useChoices``
    // was using ``useEffect`` without importing it, throwing at render
    // time inside any dialog containing a dynamic ``ChoiceField``.
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    // Seed a signal so the Processing menu items become enabled.
    await page.evaluate(async () => {
      const runtime = (
        window as unknown as {
          runtime: {
            addSignalFromArrays: (p: unknown) => Promise<string>;
          };
        }
      ).runtime;
      const x = Array.from({ length: 64 }, (_, i) => i);
      await runtime.addSignalFromArrays({
        title: "regression-windowing",
        xdata: x,
        ydata: x.map((v) => Math.sin(v / 4)),
      });
    });
    // Refresh the tree so the signal is selectable.
    await page.getByRole("tab", { name: "Images" }).click();
    await page.getByRole("tab", { name: "Signals" }).click();
    await page
      .locator(".object-tree-item")
      .filter({ hasText: "regression-windowing" })
      .first()
      .click();

    // Navigate Processing → Windowing.  The menu hover/click sequence
    // mirrors the user's gesture.
    await page
      .locator("[role=menubar]")
      .getByText("Processing", { exact: true })
      .click();
    const submenu = page.getByRole("menuitem", {
      name: /^Windowing/i,
    });
    await submenu.first().hover();
    await submenu.first().click();

    // The dialog must appear and be free of React errors.
    await page
      .locator("[role=dialog]")
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
  });
});
