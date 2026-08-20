import { expect, test } from "@playwright/test";

import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

test("plugin DataSet.edit_async uses the native guidata dialog backend", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);

  await page.getByRole("tab", { name: "Images" }).click();
  await page.getByRole("menuitem", { name: "Plugins", exact: true }).click();
  const testDataMenu = page
    .locator(".menu-item-submenu")
    .filter({ hasText: "Test data" });
  await testDataMenu.hover();
  await page
    .getByRole("menuitem", { name: "Create image with peaks", exact: true })
    .click();

  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Image with peaks" }),
  });
  await expect(dialog).toBeVisible();
  const sizeRow = dialog.locator(".dataset-form-row").filter({
    has: page.locator(".dataset-form-label", { hasText: /^Size$/ }),
  });
  await expect(sizeRow).toBeVisible();
  await sizeRow.locator('input[type="number"]').fill("64");
  await dialog.getByRole("button", { name: "OK" }).click();

  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.locator(".object-tree-item")).toHaveCount(1, {
    timeout: 30_000,
  });
  expect(pageErrors).toEqual([]);
});
