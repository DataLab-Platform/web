import { expect, type Page } from "@playwright/test";

import { dismissAnyDialog, test } from "./fixtures-warm";

interface TitleRuntime {
  resetAll(): Promise<void>;
  addSignalFromArrays(params: {
    title: string;
    xdata: number[];
    ydata: number[];
  }): Promise<string>;
  getObjectMeta(oid: string): Promise<{ title: string }>;
}

async function bouncePanel(page: Page, target: "Signals" | "Images") {
  const other = target === "Signals" ? "Images" : "Signals";
  await page.getByRole("tab", { name: other }).click();
  await page.getByRole("tab", { name: target }).click();
}

function propertyInput(page: Page, label: string) {
  return page
    .locator(".dataset-form-row")
    .filter({
      has: page.locator(".dataset-form-label", { hasText: label }),
    })
    .first()
    .locator("input")
    .first();
}

async function expectPlotTitleReadOnly(page: Page, title: string) {
  const svgTitle = page.locator(".js-plotly-plot g.g-gtitle text").first();
  await expect(svgTitle).toHaveText(title);
  await expect(svgTitle).toBeVisible();
  const box = await svgTitle.boundingBox();
  if (!box) throw new Error("Plot title has no visible bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".js-plotly-plot .plugin-editable")).toHaveCount(0);
}

async function expectPersistedTitle(page: Page, oid: string, title: string) {
  await expect
    .poll(() =>
      page.evaluate(
        (objectId) =>
          (Reflect.get(window, "runtime") as TitleRuntime).getObjectMeta(
            objectId,
          ),
        oid,
      ),
    )
    .toMatchObject({ title });
  await expect(
    page.locator(".object-tree-item").filter({ hasText: title }),
  ).toBeVisible();
  await expect(
    page.locator(".js-plotly-plot g.g-gtitle text").first(),
  ).toHaveText(title);
}

test.describe.serial("Object title editing", () => {
  test.beforeEach(async ({ warmPage: page }) => {
    await dismissAnyDialog(page);
    await page.evaluate(async () => {
      const runtime = Reflect.get(window, "runtime") as TitleRuntime;
      await runtime.resetAll();
    });
    await bouncePanel(page, "Signals");
  });

  test("signal title is read-only on the plot and editable in Properties", async ({
    warmPage: page,
  }) => {
    const sourceId = await page.evaluate(async () => {
      const runtime = Reflect.get(window, "runtime") as TitleRuntime;
      return runtime.addSignalFromArrays({
        title: "signal-title-source",
        xdata: [0, 1, 2],
        ydata: [0, 1, 0],
      });
    });
    await bouncePanel(page, "Signals");

    await page
      .locator(".object-tree-item")
      .filter({ hasText: "signal-title-source" })
      .click();
    await expectPlotTitleReadOnly(page, "signal-title-source");

    await page.getByRole("tab", { name: "Properties" }).click();
    const input = propertyInput(page, "Signal title");
    await expect(input).toBeVisible();
    await input.fill("signal-title-renamed");
    await input.press("Control+Enter");

    await expectPersistedTitle(page, sourceId, "signal-title-renamed");
  });
});
