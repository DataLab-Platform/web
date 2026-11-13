import { expect, test } from "@playwright/test";

import type { DataLabRuntime } from "../../src/runtime/runtime";
import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

declare global {
  interface Window {
    runtime: DataLabRuntime;
  }
}

const RADIOGRAPHY = "org.datalab.radiography";
const MAGNIFICATIONS_KEY = "plugin.org.datalab.radiography.magnifications";

test("Radiography magnification tool edits its parameters in a browser dialog", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);

  const weldId = await page.evaluate(async (pluginId) => {
    const opened = await window.runtime.openPluginExample(
      pluginId,
      "simulated-weld",
    );
    return opened.selected_ids[0];
  }, RADIOGRAPHY);
  await page.getByRole("tab", { name: "Images" }).click();
  await page
    .locator(".object-tree-item")
    .filter({ hasText: "Weld" })
    .first()
    .click();

  await page.getByRole("menuitem", { name: "Plugins" }).click();
  await page.getByRole("menuitem", { name: "X-ray Radiography & NDT" }).hover();
  await page.getByRole("menuitem", { name: "Magnification value..." }).click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Magnification from its value" }),
  });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  const name = dialog.getByRole("textbox").first();
  await name.fill("Browser plane");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(
      async () =>
        page.evaluate(
          async ({ oid, key }) => {
            const entries = await window.runtime.listObjectMetadata(oid);
            const entry = entries.find((item) => item.key === key);
            return entry ? String(entry.value) : "";
          },
          { oid: weldId, key: MAGNIFICATIONS_KEY },
        ),
      { timeout: 60_000 },
    )
    .toContain("Browser plane");
  expect(pageErrors).toEqual([]);
});
