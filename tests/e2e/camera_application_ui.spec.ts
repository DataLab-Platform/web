import { expect, test } from "@playwright/test";

import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

const CAMERA_LINK = new URLSearchParams({
  plugin: "org.datalab.camera-characterization",
  pluginVersion: "0.2.0",
  recipe: "org.datalab.camera-characterization:relative-dn-characterization",
  recipeVersion: "1.1.0",
  example: "quickstart",
});

test("Camera recipe reveals its primary signal output", async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await disableQuickstartTemplate(page);
  await page.goto(`/?${CAMERA_LINK.toString()}`);
  await waitForRuntimeReady(page);

  const applications = page.getByRole("dialog", { name: "Applications" });
  const card = applications.locator(
    `[data-recipe-id="${CAMERA_LINK.get("recipe")}"]`,
  );
  await expect(card.locator("[data-readiness]")).toHaveAttribute(
    "data-readiness",
    "ready",
    { timeout: 120_000 },
  );
  await card.getByRole("button", { name: "Run on selection…" }).click();
  const parameters = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Relative Camera characterization",
    }),
  });
  await expect(parameters).toBeVisible();
  await parameters.getByRole("button", { name: "OK" }).click();

  await expect(page.getByRole("tab", { name: "Signals" })).toHaveAttribute(
    "aria-selected",
    "true",
    { timeout: 120_000 },
  );
  await expect(
    page.locator(".object-tree-item").filter({ hasText: "Camera response" }),
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});
