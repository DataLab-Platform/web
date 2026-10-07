import { expect, type Page } from "@playwright/test";
import { dismissAnyDialog, test } from "./fixtures-warm";

// Instrument tools of the bundled applications: the window drawn by DataLab
// shows a live view, greys out settings, and acquires objects ready for the
// application methods.

async function openPluginTool(page: Page, application: string, tool: string) {
  await page.getByRole("menuitem", { name: "Plugins", exact: true }).click();
  await page
    .locator(".menu-item-submenu")
    .filter({ hasText: application })
    .hover();
  await page.getByRole("menuitem", { name: tool }).click();
}

function formRow(page: Page, label: string) {
  return page
    .locator(".instrument-window .dataset-form-row")
    .filter({ has: page.locator(".dataset-form-label", { hasText: label }) });
}

async function expectMethodReady(
  page: Page,
  application: string,
  recipeId: string,
) {
  await page.getByRole("menuitem", { name: "Applications…" }).click();
  const applications = page.getByRole("dialog", { name: "Applications" });
  await expect(applications).toBeVisible();
  await applications
    .locator(".applications-list button")
    .filter({ hasText: application })
    .click();
  await expect(
    applications.locator(`[data-recipe-id="${recipeId}"] [data-readiness]`),
  ).toHaveAttribute("data-readiness", "ready", { timeout: 30_000 });
  await expect(applications.locator(".application-tools summary")).toHaveText(
    "Tools (1)",
  );
  await applications.getByRole("button", { name: "Close" }).click();
}

test("Oscilloscope simulator acquires delayed pulse pairs", async ({
  warmPage: page,
}) => {
  test.setTimeout(240_000);
  await dismissAnyDialog(page);
  await page.evaluate(() => window.runtime.resetAll());
  await page.getByRole("tab", { name: "Signals" }).click();

  await openPluginTool(
    page,
    "Pulse & Transient Characterization",
    "Oscilloscope simulator",
  );
  const instrument = page.getByRole("dialog", {
    name: "Oscilloscope simulator",
  });
  await expect(instrument).toBeVisible();
  const traces = instrument.locator(".instrument-plot .scatterlayer .trace");
  await expect(traces).toHaveCount(1, { timeout: 60_000 });
  await expect(instrument.locator(".instrument-summary")).toContainText(
    "CH1: peak",
  );

  await formRow(page, "Source").locator("select").selectOption("pulse-pair");
  await expect(traces).toHaveCount(2, { timeout: 30_000 });
  await expect(instrument.locator(".instrument-summary")).toContainText(
    "CH2: peak",
  );
  await expect(formRow(page, "Detector delay").locator("input")).toBeEnabled({
    timeout: 30_000,
  });
  await expect(
    formRow(page, "Natural frequency").locator("input"),
  ).toBeDisabled();

  await instrument
    .locator(".dataset-form-tab-bar button", { hasText: "Oscilloscope" })
    .click();
  await formRow(page, "Triggers per acquisition").locator("input").fill("20");
  await instrument.getByRole("button", { name: "Acquire" }).click();
  const group = "Oscilloscope - Pulse pair - acquisition 001";
  await expect(instrument.locator(".applications-status")).toHaveText(
    `40 objects added to group '${group}'`,
    { timeout: 60_000 },
  );
  await expect(
    page.locator(".object-tree-group-name", { hasText: group }),
  ).toBeVisible();

  await instrument.getByRole("button", { name: "Close" }).click();
  await expect(instrument).toBeHidden();
  await expectMethodReady(
    page,
    "Pulse & Transient Characterization",
    "org.datalab.pulse-characterization:two-channel-delay",
  );
});

test("Camera simulator acquires a photon transfer sequence", async ({
  warmPage: page,
}) => {
  test.setTimeout(240_000);
  await dismissAnyDialog(page);
  await page.evaluate(() => window.runtime.resetAll());
  await page.getByRole("tab", { name: "Images" }).click();

  await openPluginTool(
    page,
    "Camera & Detector Characterization",
    "Scientific camera simulator",
  );
  const instrument = page.getByRole("dialog", {
    name: "Scientific camera simulator",
  });
  await expect(instrument).toBeVisible();
  await expect(instrument.locator(".instrument-plot svg image")).toHaveCount(
    1,
    { timeout: 60_000 },
  );
  await expect(instrument.locator(".instrument-summary")).toContainText(
    "Flat frame, 10 ms",
  );

  const sequence = formRow(page, "Exposure times").locator("input");
  await expect(sequence).toBeDisabled();
  await formRow(page, "Mode").locator("select").selectOption("sequence");
  await expect(sequence).toBeEnabled({ timeout: 30_000 });
  await expect(instrument.locator(".instrument-summary")).toContainText(
    "Flat frame, 136 ms",
    { timeout: 30_000 },
  );

  await instrument.getByRole("button", { name: "Acquire" }).click();
  const group = "Camera SN 20261007 - acquisition 001";
  await expect(instrument.locator(".applications-status")).toHaveText(
    `28 objects added to group '${group}'`,
    { timeout: 60_000 },
  );
  await expect(
    page.locator(".object-tree-group-name", { hasText: group }),
  ).toBeVisible();

  await instrument.getByRole("button", { name: "Close" }).click();
  await expectMethodReady(
    page,
    "Camera & Detector Characterization",
    "org.datalab.camera-characterization:photon-transfer",
  );
});
