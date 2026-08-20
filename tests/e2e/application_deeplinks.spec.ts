import { expect, test } from "@playwright/test";

import type { DataLabRuntime } from "../../src/runtime/runtime";
import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

declare global {
  interface Window {
    runtime: DataLabRuntime;
  }
}

function applicationUrl(values: {
  plugin: string;
  pluginVersion: string;
  recipe: string;
  recipeVersion: string;
  example: string;
}): string {
  return `/?${new URLSearchParams(values).toString()}`;
}

const CAMERA_LINK = {
  plugin: "org.datalab.camera-characterization",
  pluginVersion: "0.1.0",
  recipe: "org.datalab.camera-characterization:relative-dn-characterization",
  recipeVersion: "1.1.0",
  example: "quickstart",
};

const PULSE_LINK = {
  plugin: "org.datalab.pulse-characterization",
  pluginVersion: "0.1.0",
  recipe: "org.datalab.pulse-characterization:single-channel-campaign",
  recipeVersion: "1.1.0",
  example: "demo",
};

test("Camera deep link validates the bundle and opens its visible quickstart", async ({
  page,
}) => {
  await disableQuickstartTemplate(page);
  await page.goto(applicationUrl(CAMERA_LINK));
  await waitForRuntimeReady(page);

  await expect(page.locator(".toast-success")).toContainText(
    "Opened bundled example quickstart.",
  );
  const applications = page.getByRole("dialog", { name: "Applications" });
  await expect(applications).toBeVisible();
  await expect(
    applications.locator(`[data-recipe-id="${CAMERA_LINK.recipe}"]`),
  ).toHaveClass(/focused/);
  await expect(page.getByRole("tab", { name: "Images" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".object-tree-item").first()).toBeVisible();
  const counts = await page.evaluate(async () => ({
    images: (await window.runtime.listImages()).length,
    signals: (await window.runtime.listSignals()).length,
  }));
  expect(counts.images).toBeGreaterThan(0);
  expect(counts.signals).toBe(0);
  await expect(
    page.locator(".object-tree-item").filter({ hasText: "Camera response" }),
  ).toHaveCount(0);
});

test("Pulse deep link validates the bundle and opens its visible demo", async ({
  page,
}) => {
  await disableQuickstartTemplate(page);
  await page.goto(applicationUrl(PULSE_LINK));
  await waitForRuntimeReady(page);

  await expect(page.locator(".toast-success")).toContainText(
    "Opened bundled example demo.",
  );
  const applications = page.getByRole("dialog", { name: "Applications" });
  await expect(applications).toBeVisible();
  await expect(
    applications.locator(`[data-recipe-id="${PULSE_LINK.recipe}"]`),
  ).toHaveClass(/focused/);
  await expect(page.getByRole("tab", { name: "Signals" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".object-tree-item").first()).toBeVisible();
  expect(
    await page.evaluate(
      async () => (await window.runtime.listSignals()).length,
    ),
  ).toBe(500);
  await expect(
    page
      .locator(".object-tree-item")
      .filter({ hasText: "Pulse amplitude vs shot" }),
  ).toHaveCount(0);
});

test("deep link rejects a plugin version absent from the bundle", async ({
  page,
}) => {
  await disableQuickstartTemplate(page);
  await page.goto(applicationUrl({ ...CAMERA_LINK, pluginVersion: "9.0.0" }));
  await waitForRuntimeReady(page);

  await expect(page.locator(".toast-error")).toContainText(
    "requested pluginVersion 9.0.0, but this bundle provides 0.1.0",
  );
  await expect(page.locator(".object-tree-item")).toHaveCount(0);
  expect(
    await page.evaluate(async () => (await window.runtime.listImages()).length),
  ).toBe(0);
});
