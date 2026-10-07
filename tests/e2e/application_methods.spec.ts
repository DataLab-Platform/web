import { expect, test } from "@playwright/test";

import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

interface MethodCase {
  plugin: string;
  recipe: string;
  title: string;
  example: string;
  created: number;
  output: string;
}

const CAMERA = "org.datalab.camera-characterization";
const PULSE = "org.datalab.pulse-characterization";

const METHODS: MethodCase[] = [
  {
    plugin: CAMERA,
    recipe: "photon-transfer",
    title: "Photon transfer curve",
    example: "photon-transfer",
    created: 5,
    output: "Photon transfer curve",
  },
  {
    plugin: CAMERA,
    recipe: "dark-current",
    title: "Dark current and hot pixels",
    example: "dark-ramp",
    created: 6,
    output: "Dark signal ramp",
  },
  {
    plugin: PULSE,
    recipe: "shot-stability",
    title: "Shot-to-shot stability",
    example: "stability-demo",
    created: 7,
    output: "Arrival time vs shot",
  },
  {
    plugin: PULSE,
    recipe: "step-response",
    title: "Step response",
    example: "step-response-demo",
    created: 3,
    output: "Aligned mean step",
  },
  {
    plugin: PULSE,
    recipe: "two-channel-delay",
    title: "Two-channel delay and jitter",
    example: "two-channel-demo",
    created: 4,
    output: "CFD delay vs shot",
  },
  {
    plugin: PULSE,
    recipe: "pulse-height-spectrum",
    title: "Pulse-height spectrum",
    example: "spectrum-demo",
    created: 4,
    output: "Pulse-height spectrum",
  },
];

for (const method of METHODS) {
  test(`${method.title} runs on its example through the Applications UI`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const recipeId = `${method.plugin}:${method.recipe}`;
    const link = new URLSearchParams({
      plugin: method.plugin,
      pluginVersion: "0.2.0",
      recipe: recipeId,
      recipeVersion: "1.0.0",
      example: method.example,
    });

    await disableQuickstartTemplate(page);
    await page.goto(`/?${link.toString()}`);
    await waitForRuntimeReady(page);

    const applications = page.getByRole("dialog", { name: "Applications" });
    await expect(page.locator(".toast-success")).toContainText(
      `Opened bundled example ${method.example}.`,
      { timeout: 120_000 },
    );
    const card = applications.locator(`[data-recipe-id="${recipeId}"]`);
    await expect(card.locator("[data-readiness]")).toHaveAttribute(
      "data-readiness",
      "ready",
      { timeout: 60_000 },
    );
    await card.getByRole("button", { name: "Run on selection…" }).click();
    const parameters = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: method.title }),
    });
    await expect(parameters).toBeVisible({ timeout: 60_000 });
    await parameters.getByRole("button", { name: "OK" }).click();

    await expect(page.locator(".applications-status")).toHaveText(
      `Created ${method.created} objects`,
      { timeout: 180_000 },
    );
    await expect(
      page.locator(".object-tree-item").filter({ hasText: method.output }),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
}

test("an example designed for several methods runs the chosen one", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const recipeId = `${CAMERA}:relative-dn-characterization`;

  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);
  await page.getByRole("menuitem", { name: "Applications…" }).click();
  const applications = page.getByRole("dialog", { name: "Applications" });
  await applications
    .getByRole("button")
    .filter({ hasText: "Camera & Detector Characterization" })
    .click();

  const card = applications.locator(`[data-recipe-id="${recipeId}"]`);
  await expect(card.locator("[data-readiness]")).toHaveAttribute(
    "data-readiness",
    "no_input",
    { timeout: 60_000 },
  );
  await card
    .locator('[data-example-id="photon-transfer"]')
    .getByRole("button", { name: "Try with this example" })
    .click();
  const parameters = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Relative Camera characterization",
    }),
  });
  await expect(parameters).toBeVisible({ timeout: 120_000 });
  await parameters.getByRole("button", { name: "OK" }).click();

  await expect(page.locator(".applications-status")).toHaveText(
    /^Created \d+ objects$/,
    { timeout: 180_000 },
  );
  await expect(
    page.locator(".object-tree-item").filter({ hasText: "Camera response" }),
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});
