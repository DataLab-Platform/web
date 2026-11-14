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

test("step wedge example runs without optional radiographs to map", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);
  await page.getByRole("menuitem", { name: "Applications…" }).click();

  const applications = page.getByRole("dialog", { name: "Applications" });
  await applications
    .getByRole("button")
    .filter({ hasText: "X-ray Radiography & NDT" })
    .click();
  const recipe = applications.locator(
    `[data-recipe-id="${RADIOGRAPHY}:step-wedge-calibration"]`,
  );
  await recipe.locator("summary").click();
  await recipe
    .locator('[data-example-id="simulated-step-wedge"]')
    .getByRole("button", { name: "Try with this example" })
    .click();

  const inputs = page.getByRole("dialog", { name: "Recipe inputs" });
  await expect(inputs).toBeVisible({ timeout: 120_000 });
  const optional = inputs
    .locator("fieldset")
    .filter({ hasText: "Radiographs to map" });
  await expect(optional).toContainText("optional");
  await expect(optional.locator("input:checked")).toHaveCount(0);
  const continueButton = inputs.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeEnabled({ timeout: 60_000 });
  await continueButton.click();

  const parameters = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Step wedge thickness calibration",
    }),
  });
  await expect(parameters).toBeVisible();
  await parameters.getByRole("button", { name: "OK" }).click();
  await expect(applications.locator(".applications-status")).toHaveText(
    "Created 2 objects",
    { timeout: 180_000 },
  );
  await applications
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("tab", { name: "Signals" }).click();
  await expect(
    page
      .locator(".object-tree-item")
      .filter({ hasText: "Thickness calibration" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Images" }).click();
  await expect(
    page
      .locator(".object-tree-item")
      .filter({ hasText: "Thickness of Step wedge" }),
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});

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
