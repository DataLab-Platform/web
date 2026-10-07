/**
 * Regression spec for the invariant **"the side panel always mirrors
 * the currently selected object"**.
 *
 * Two bugs motivated this spec (both fixed in the same patch):
 *
 *  1. Editing a 2D ramp image's Width via the Creation tab and clicking
 *     Apply did not visually update the form (the backend was
 *     correctly resized, but the form kept showing the old value).
 *  2. Creating two signals (sin, gauss) and editing the first one's
 *     Size via the Creation tab caused the Creation forms of the two
 *     objects to display swapped values when switching between them.
 *
 * Both shared the same root cause: the inner ``EditableForm`` snapshots
 * its draft from the ``values`` prop at mount time only.  When
 * ``CreationPanel`` / ``PropertiesPanel`` re-rendered with a new
 * ``oid`` or ``refreshNonce`` *before* the ``useEffect`` cleared the
 * stale payload, ``EditableForm`` remounted with stale values and
 * persisted them as the new draft.
 *
 * The fix is the derived-state pattern in ``SidePanel.tsx``: clearing
 * the payload **synchronously** when ``oid`` or ``refreshNonce``
 * changes, so the form always remounts with up-to-date data.
 *
 * See ``doc/testing-strategy.md`` for why this E2E is permanent
 * rather than a throwaway probe.
 */
import { expect, Page } from "@playwright/test";
import { test, dismissAnyDialog } from "./fixtures-warm";

declare global {
  interface Window {
    runtime: {
      createImageTyped: (s: string) => Promise<string>;
      createSignalTyped: (s: string) => Promise<string>;
      getImageData: (id: string) => Promise<{ width: number; height: number }>;
      getCreationParamSchema: (
        id: string,
      ) => Promise<{ values: Record<string, unknown>; stype: string }>;
      createGroup: (kind: "signal", name: string) => Promise<string>;
      moveObject: (id: string, groupId: string) => Promise<void>;
      applyFeature: (
        featureId: string,
        sourceIds: string[],
      ) => Promise<string[]>;
    };
  }
}

function inputForLabel(page: Page, label: string | RegExp) {
  return page
    .locator(".dataset-form-row")
    .filter({ has: page.locator(".dataset-form-label", { hasText: label }) })
    .first()
    .locator("input")
    .first();
}

async function bouncePanel(page: Page, target: "Signals" | "Images") {
  // The tree only refreshes on panel switch when objects were created
  // via ``window.runtime.*`` directly (bypassing React state).
  const other = target === "Signals" ? "Images" : "Signals";
  await page.getByRole("tab", { name: other }).click();
  await page.waitForTimeout(150);
  await page.getByRole("tab", { name: target }).click();
  await page.waitForTimeout(300);
}

test.describe.serial("Side panel mirrors selection", () => {
  test.beforeEach(async ({ warmPage: page }) => {
    await dismissAnyDialog(page);
    await page.evaluate(async () => {
      await window.runtime.resetAll();
    });
    await page.getByRole("tab", { name: "Images" }).click();
    await page.getByRole("tab", { name: "Signals" }).click();
  });

  test("Image Creation form Apply updates both backend and visible form", async ({
    warmPage: page,
  }) => {
    await page.getByRole("tab", { name: "Images" }).click();
    const id = await page.evaluate(() =>
      window.runtime.createImageTyped("ramp"),
    );
    await bouncePanel(page, "Images");

    await page.locator(".object-tree-item").first().click();
    await page.getByRole("tab", { name: "Creation" }).click();

    const widthInput = inputForLabel(page, "Width");
    await expect(widthInput).toBeVisible({ timeout: 10000 });
    expect(await widthInput.inputValue()).toBe("1024");

    await widthInput.fill("256");
    await page.getByRole("button", { name: "Apply" }).click();

    // Backend is updated.
    await expect
      .poll(() => page.evaluate((i) => window.runtime.getImageData(i), id), {
        timeout: 10000,
      })
      .toMatchObject({ width: 256 });

    // Form mirrors the new state.
    await expect
      .poll(() => widthInput.inputValue(), { timeout: 5000 })
      .toBe("256");
  });

  test("Signal Creation form mirrors the selected object across edits and switches", async ({
    warmPage: page,
  }) => {
    const sinId = await page.evaluate(() =>
      window.runtime.createSignalTyped("sine"),
    );
    await page.evaluate(() => window.runtime.createSignalTyped("gauss"));
    await bouncePanel(page, "Signals");

    const items = page.locator(".object-tree-item");
    await expect
      .poll(() => items.count(), { timeout: 30000 })
      .toBeGreaterThanOrEqual(2);
    const sineItem = items.filter({ hasText: /sin/i }).first();
    const gaussItem = items.filter({ hasText: /gauss/i }).first();

    await sineItem.click();
    await page.getByRole("tab", { name: "Creation" }).click();

    const sizeInput = inputForLabel(page, /^Npoints$/);
    await expect(sizeInput).toBeVisible({ timeout: 10000 });
    expect(await sizeInput.inputValue()).toBe("500");

    // Edit the sine's Size and Apply — the form must reflect the new value
    // immediately (regression: it used to keep showing 500).
    await sizeInput.fill("200000");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect
      .poll(() => sizeInput.inputValue(), { timeout: 5000 })
      .toBe("200000");

    // Switch to gauss — the Creation form must show *gauss's* size, not
    // sine's stale draft (regression: it used to leak 200000 into gauss).
    await gaussItem.click();
    await page.getByRole("tab", { name: "Creation" }).click();
    await expect(sizeInput).toBeVisible({ timeout: 10000 });
    expect(await sizeInput.inputValue()).toBe("500");

    // Switch back to sine — the form must show 200000 (the value the user
    // actually applied), not gauss's 500.
    await sineItem.click();
    await page.getByRole("tab", { name: "Creation" }).click();
    await expect(sizeInput).toBeVisible({ timeout: 10000 });
    expect(await sizeInput.inputValue()).toBe("200000");

    // Sanity: backend agrees with the form.
    const backend = await page.evaluate(
      (i) => window.runtime.getCreationParamSchema(i),
      sinId,
    );
    expect(backend.values.size).toBe(200000);
  });

  test("Deleting a source group refreshes the selected result dependencies", async ({
    warmPage: page,
  }) => {
    const { resultId } = await page.evaluate(async () => {
      const sourceGroupId = await window.runtime.createGroup(
        "signal",
        "Source group",
      );
      const resultGroupId = await window.runtime.createGroup(
        "signal",
        "Result group",
      );
      const sourceId = await window.runtime.createSignalTyped(
        "sine",
        sourceGroupId,
      );
      const [resultId] = await window.runtime.applyFeature("normalize", [
        sourceId,
      ]);
      await window.runtime.moveObject(resultId, resultGroupId);
      return { resultId };
    });
    await bouncePanel(page, "Signals");

    const resultItem = page
      .locator(".object-tree-item")
      .filter({ hasText: `#${resultId}` });
    await expect(resultItem).toBeVisible();
    // The item centre may fall on the title's "Go to source" link.
    await resultItem.locator(".object-tree-meta").click();
    await page.getByRole("tab", { name: "Processing" }).click();
    await expect(page.locator(".processing-panel-title")).toBeVisible();

    const sourceGroup = page.locator(".object-tree-group").filter({
      has: page.locator(".object-tree-group-name", {
        hasText: "Source group",
      }),
    });
    await sourceGroup.getByTitle("Delete group").click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click();

    await expect(sourceGroup).toHaveCount(0);
    await expect(
      page.locator(".processing-panel .error", {
        hasText: "Source object(s) no longer exist",
      }),
    ).toBeVisible();
    await expect(
      page.locator(".processing-panel .editable-form-apply"),
    ).toBeDisabled();
  });

  test("Brightness and contrast preserves an extreme requested range", async ({
    warmPage: page,
  }) => {
    await page.getByRole("tab", { name: "Images" }).click();
    const resultId = await page.evaluate(async () => {
      const runtime = (window as any).runtime;
      const sourceId = await runtime.addImageFromArray({
        title: "Extreme range",
        data: [[-1e308, 0, 1e308]],
      });
      const featureId = "image:adjust_brightness_contrast";
      const payload = await runtime.getFeatureSchema(featureId, sourceId);
      const [resultId] = await runtime.applyFeature(
        featureId,
        [sourceId],
        null,
        {
          ...payload.values,
          minimum: -1e308,
          maximum: 1e308,
        },
      );
      return resultId as string;
    });
    await bouncePanel(page, "Images");

    const resultItem = page
      .locator(".object-tree-item")
      .filter({ hasText: `#${resultId}` });
    await resultItem.click();

    await page
      .locator("[role=menubar]")
      .getByText("Processing", { exact: true })
      .click();
    await page.getByRole("menuitem", { name: /^Exposure/ }).hover();
    const brightnessContrastAction = page.getByRole("menuitem", {
      name: "Brightness and contrast…",
    });
    await expect(
      brightnessContrastAction.locator("img.menu-icon-img"),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("tab", { name: "Processing" }).click();
    await expect(
      page.getByRole("img", {
        name: "Source histogram and transfer function",
      }),
    ).toBeVisible();

    const minimum = page.getByRole("spinbutton", { name: "Minimum" });
    const maximum = page.getByRole("spinbutton", { name: "Maximum" });
    const contrast = page.getByRole("slider", { name: "Contrast" });
    await contrast.fill("75");
    await expect(minimum).toHaveValue("-5e+307");
    await expect(maximum).toHaveValue("5e+307");
    await expect(page.getByText("● Unsaved changes")).toBeVisible();

    await page.locator(".processing-panel .editable-form-apply").click();
    await expect(page.getByText("All changes applied")).toBeVisible();
    await expect(minimum).toHaveValue("-5e+307");
    await expect(maximum).toHaveValue("5e+307");
  });
});
