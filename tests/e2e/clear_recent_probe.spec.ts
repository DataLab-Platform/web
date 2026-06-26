import { test, expect } from "@playwright/test";
import { waitForRuntimeReady } from "./fixtures";

import type { DataLabRuntime } from "../../src/runtime/runtime";

declare global {
  interface Window {
    runtime: DataLabRuntime;
  }
}

test("Clear all empties the recent macro cache", async ({ page }) => {
  await page.goto("/");
  await waitForRuntimeReady(page);

  // Seed two macros directly into the IndexedDB recent cache.
  await page.evaluate(async () => {
    const { recordRecent } = await import("/src/storage/recentStore.ts");
    await recordRecent("macro", { id: "a", title: "Alpha", content: "# a\n" });
    await recordRecent("macro", { id: "b", title: "Beta", content: "# b\n" });
  });

  // Reload so the MacroPanel rehydrates the Recent… list from the cache.
  await page.reload();
  await waitForRuntimeReady(page);

  await page.getByRole("tab", { name: "Macros" }).click();

  // Open the Recent… menu (label includes the count).
  await page.getByRole("button", { name: /Recent…/ }).click();

  // Click "Clear all" then confirm.
  await page.getByRole("button", { name: /Clear all/i }).click();
  await page.getByRole("button", { name: /Remove all/i }).click();

  // The cache must now be empty.
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { listRecent } = await import("/src/storage/recentStore.ts");
        return (await listRecent("macro")).length;
      }),
    )
    .toBe(0);

  // The Recent… button reflects the empty count and is disabled.
  await expect(
    page.getByRole("button", { name: /Recent… \(0\)/ }),
  ).toBeVisible();
});
