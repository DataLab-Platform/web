import { expect, test } from "@playwright/test";

import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

const PULSE_LINK = new URLSearchParams({
  plugin: "org.datalab.pulse-characterization",
  pluginVersion: "0.1.0",
  recipe: "org.datalab.pulse-characterization:single-channel-campaign",
  recipeVersion: "1.1.0",
  example: "demo",
});

test("Pulse example analysis completes through the Applications UI", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  const duplicateKeyWarnings: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.text().includes("Encountered two children with the same key")) {
      duplicateKeyWarnings.push(message.text());
    }
  });

  await disableQuickstartTemplate(page);
  await page.goto(`/?${PULSE_LINK.toString()}`);
  await waitForRuntimeReady(page);

  const applications = page.getByRole("dialog", { name: "Applications" });
  await expect(applications).toBeVisible();
  await expect(page.locator(".object-tree-item")).toHaveCount(500);
  await expect(page.locator(".object-tree-item.selected")).toHaveCount(1);

  await applications.getByRole("button", { name: "Start analysis…" }).click();
  const parameters = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Single-channel pulse campaign",
    }),
  });
  await expect(parameters).toBeVisible();
  await parameters.getByRole("button", { name: "OK" }).click();

  const counts = await page.evaluate(async () => {
    const tree = await window.runtime.getPanelTree("signal");
    return {
      signals: (await window.runtime.listSignals()).length,
      treeObjects: tree.groups.reduce(
        (count, group) => count + group.objects.length,
        0,
      ),
    };
  });
  expect(counts).toEqual({ signals: 503, treeObjects: 503 });
  await expect(page.locator(".object-tree-item")).toHaveCount(503);
  await expect(page.locator(".applications-status")).toHaveText(
    "Created 3 objects",
  );
  await expect(page.getByRole("tab", { name: "Signals" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page
      .locator(".object-tree-item")
      .filter({ hasText: "Pulse amplitude vs shot" }),
  ).toBeVisible({ timeout: 120_000 });
  expect(pageErrors).toEqual([]);
  expect(duplicateKeyWarnings).toEqual([]);
});
