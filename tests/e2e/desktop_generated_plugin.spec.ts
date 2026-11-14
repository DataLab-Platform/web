import path from "node:path";
import { expect, test } from "@playwright/test";
import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

test("a Desktop-generated plugin appears and processes a signal", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);

  await page.getByRole("menuitem", { name: "Plugins", exact: true }).click();
  await page.getByRole("menuitem", { name: "Manage plugins…" }).click();
  await page
    .locator('input[type="file"][accept=".py"]')
    .setInputFiles(path.resolve("tests", "fixtures", "datalab_issue94.py"));
  await page.getByRole("button", { name: "Trust & load" }).click();
  const row = page
    .getByRole("row")
    .filter({ hasText: "Generated & portable/demo" });
  await expect(row).toContainText("loaded");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  const pluginsMenu = page.getByRole("menuitem", {
    name: "Plugins",
    exact: true,
  });
  await pluginsMenu.click();
  const submenu = page.getByRole("menuitem", {
    name: /Generated & portable\/demo/,
  });
  await submenu.hover();
  const processing = page.getByRole("menuitem", {
    name: "Sample processing",
    exact: true,
  });
  await expect(processing).toHaveCount(1);
  await expect(processing).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  const sourceId = await page.evaluate(() =>
    window.runtime.addSignalFromArrays({
      title: "plugin source",
      xdata: [0, 1, 2],
      ydata: [-1, 0, 2],
    }),
  );
  await page.getByRole("tab", { name: "Images" }).click();
  await page.getByRole("tab", { name: "Signals" }).click();
  await page
    .locator(".object-tree-item")
    .filter({ hasText: "plugin source" })
    .click();

  await pluginsMenu.click();
  await submenu.hover();
  await expect(processing).toHaveCount(1);
  await expect(processing).toHaveAttribute("aria-disabled", "false");
  await processing.click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.runtime.listSignals())).length,
    )
    .toBe(2);
  const result = await page.evaluate(async (source) => {
    const signals = await window.runtime.listSignals();
    const output = signals.find((signal) => signal.id !== source);
    if (!output) throw new Error("The plugin did not create an output signal");
    return Array.from((await window.runtime.getSignalData(output.id)).y);
  }, sourceId);
  expect(result).toEqual([0, 0, 2]);

  await pluginsMenu.click();
  await page.getByRole("menuitem", { name: "Reload all plugins" }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        async () =>
          (await window.runtime.listPluginMenuActions()).filter(
            (action) =>
              action.action_type === "feature" &&
              action.feature_id === "org.example.issue94:sample-processing",
          ).length,
      ),
    )
    .toBe(1);
  await pluginsMenu.click();
  await submenu.hover();
  await expect(processing).toHaveCount(1);
});
