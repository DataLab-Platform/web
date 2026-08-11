import { expect, test } from "@playwright/test";

import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

test("Applications and application plugin menus follow desktop placement", async ({
  page,
}) => {
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);

  const topEntries = await page
    .locator(".menubar-nav > [data-menu-top]")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-menu-top")),
    );
  const applicationsIndex = topEntries.indexOf("Applications");
  const pluginsIndex = topEntries.indexOf("Plugins");
  expect(applicationsIndex).toBeGreaterThan(-1);
  expect(pluginsIndex).toBeGreaterThan(applicationsIndex);

  const applicationsButton = page.getByRole("menuitem", {
    name: "Applications…",
  });
  await expect(applicationsButton.locator("img")).toBeVisible();
  await expect(applicationsButton).not.toContainText("Applications…");
  const launcherIconSource = await applicationsButton
    .locator("img")
    .getAttribute("src");
  expect(launcherIconSource).toBeTruthy();

  await page.getByRole("menuitem", { name: "Plugins", exact: true }).click();
  const cameraMenu = page
    .locator(".menu-item-submenu")
    .filter({ hasText: "Camera & Detector Characterization" });
  await cameraMenu.hover();
  await expect(
    page.getByRole("menuitem", { name: "Relative Camera characterization" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Synthetic camera characterization" }),
  ).toBeVisible();

  const pulseMenu = page
    .locator(".menu-item-submenu")
    .filter({ hasText: "Pulse & Transient Characterization" });
  await pulseMenu.hover();
  await expect(
    page.getByRole("menuitem", { name: "Single-channel pulse campaign" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Synthetic pulse campaign" }),
  ).toBeVisible();

  await applicationsButton.click();
  const applications = page.getByRole("dialog", { name: "Applications" });
  await expect(applications).toBeVisible();
  await expect(applications).not.toHaveAttribute("aria-modal", "true");
  const dialogIcon = applications.locator(".applications-header-icon");
  await expect(dialogIcon).toBeVisible();
  await expect(dialogIcon).toHaveAttribute("src", launcherIconSource!);

  await page.getByRole("tab", { name: "Images" }).click();
  await expect(page.getByRole("tab", { name: "Images" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(applications).toBeVisible();
});
