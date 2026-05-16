import { expect } from "@playwright/test";
import { test, dismissAnyDialog } from "./fixtures-warm";

/**
 * Computation titles like ``average(a3f5b2c1, b9e2d104)`` carry their
 * sources' short ids inline (see ``patch_title_with_ids`` in
 * ``src/runtime/bootstrap.py``). DataLab-Web renders each *resolvable*
 * hex token as a clickable button via :class:`TitleWithLinks` — clicking
 * one must select the corresponding source row.
 */
test.describe.serial("Title hex links", () => {
  test.beforeEach(async ({ warmPage: page }) => {
    await dismissAnyDialog(page);
    await page.evaluate(async () => {
      await (window as any).runtime.resetAll();
    });
    // Force React to re-pull the panel trees (objects created via
    // ``window.runtime`` bypass React state otherwise).
    await page.getByRole("tab", { name: "Images" }).click();
    await page.getByRole("tab", { name: "Signals" }).click();
  });

  test("clicking a hex link in a result title selects the source", async ({
    warmPage: page,
  }) => {
    const ids = await page.evaluate(async () => {
      const runtime = (window as any).runtime;
      const x = Array.from({ length: 16 }, (_, i) => i / 16);
      const a = await runtime.addSignalFromArrays({
        title: "src-a",
        xdata: x,
        ydata: x.map((v: number) => v),
      });
      const b = await runtime.addSignalFromArrays({
        title: "src-b",
        xdata: x,
        ydata: x.map(() => 0.5),
      });
      const aId = (a as any).id ?? a;
      const bId = (b as any).id ?? b;
      await runtime.applyFeature("average", [aId, bId]);
      return { aId, bId };
    });

    // Bounce panels so the React tree re-pulls from the runtime
    // (direct ``window.runtime`` calls bypass the usual refresh path).
    await page.getByRole("tab", { name: "Images" }).click();
    await page.waitForTimeout(150);
    await page.getByRole("tab", { name: "Signals" }).click();
    await page.waitForTimeout(300);

    // The 3rd row is the average result; its title contains the two
    // hex links. Click the one for ``aId``.
    const link = page.locator(`button.title-oid-link:has-text("${ids.aId}")`);
    await expect(link).toBeVisible();
    await link.first().click();

    // Source A's row must now carry the ``current`` selection class.
    const srcRow = page.locator(
      `.object-tree-item.current:has-text("${ids.aId}")`,
    );
    await expect(srcRow).toBeVisible();
    await expect(srcRow).toContainText("src-a");
  });
});
